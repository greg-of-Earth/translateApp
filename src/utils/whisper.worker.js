import { pipeline } from '@xenova/transformers'
import { MessageTypes } from './presets'

const globalScope = typeof window !== 'undefined' ? window : self;

const originalFetch = globalScope.fetch;
globalScope.fetch = async function(input, init) {
    const res = await originalFetch(input, init);
    const contentType = res.headers.get("Content-Type");
    console.log('[FETCH]', input, '→', res.status, contentType);
    const text = await res.clone().text();
    if (text.startsWith('<!DOCTYPE')) {
        console.error('[FETCH ERROR] HTML instead of JSON:', input);
    }
    return new Response(text, res);
};

console.log('[WORKER] Whisper worker initialized');


class MyTranscriptionPipeline {
    static task = 'automatic-speech-recognition';
    static model = 'Xenova/whisper-tiny.en';
    static instance = null;
  
    static async getInstance(progress_callback = null) {
      
  
    //   if (!this.instance || this.model !== model_name) {
    //     this.model = model_name;
    //     console.log('[getInstance] loading pipeline with model:', model_name);
  
        try {
            console.log('[getInstance] called');
            this.instance = await pipeline(this.task, this.model, {
                progress_callback,
                use_browser_cache: false,
                cache_dir: 'indexeddb',
                modelBaseURL: 'https://huggingface.co/Xenova/whisper-tiny.en/raw/main/',

                environment: {
                    fetch: async (input, init) => {
                        if (typeof input === 'string' && !input.startsWith('http')) {
                          input = 'https://huggingface.co/Xenova/whisper-tiny.en/raw/main/' + input;
                        }
                        console.log('[FETCH REQUEST]', input);
                        const res = await fetch(input, { ...init, redirect: 'follow' });
                        console.log('[FETCH RESPONSE]', input, res.status, res.headers.get('Content-Type'));
                        const text = await res.clone().text();
                        if (text.startsWith('<!DOCTYPE') || text.startsWith('<!doctype')) {
                          console.error('[FETCH ERROR] HTML instead of JSON:', input);
                        }
                        return new Response(text, res);
                      }
                      
                      
                      
                }
              });
               
              
        } catch (err) {
          console.error('[pipeline FAILED]', err.message || err);
          throw err;
        }
      }
  
    //   console.log('[getInstance] pipeline loaded:', this.instance);
    //   return this.instance;
    // }
  }
  

self.addEventListener('message', async (event) => {
    const { type, audio} = event.data
    if (type === MessageTypes.INFERENCE_REQUEST) {
        await transcribe(audio)
    }
})

async function transcribe(audio) {
    sendLoadingMessage('loading')

    let pipeline

    try {
        pipeline = await MyTranscriptionPipeline.getInstance( load_model_callback)
    } catch (err) {
        console.log("failed to load model", err?.message || String(err))
        return { 
            success: false, 
            stage: 'loading_model',
            error: err?.message || "Unknown error loading model." };
    }


    sendLoadingMessage('success')

    const stride_length_s = 5

    const generationTracker = new GenerationTracker(pipeline, stride_length_s)
    try {
        await pipeline(audio, {
            top_k: 0,
            do_sample: false,
            chunk_length: 30,
            stride_length_s,
            return_timestamps: true,
            callback_function: generationTracker.callbackFunction.bind(generationTracker),
            chunk_callback: generationTracker.chunkCallback.bind(generationTracker)
        })
        generationTracker.sendFinalResult()

        return {
            success: true,
            trnascript: generationTracker.getTranscript?.() || null
        }
    } catch (err) {
        console.error("transcription error:", err?.message || String(err))
        sendLoadingMessage('error_transcribing')
        return {
            success: false,
            stage: 'transcription',
            error: err?.message || 'unknown error during transcription'
        }
    }

}

async function load_model_callback(data) {
    const { status } = data
    if (status === 'progress') {
        const { file, progress, loaded, total } = data
        sendDownloadingMessage(file, progress, loaded, total)
    }
}

function sendLoadingMessage(status) {
    self.postMessage({
        type: MessageTypes.LOADING,
        status
    })
}

async function sendDownloadingMessage(file, progress, loaded, total) {
    self.postMessage({
        type: MessageTypes.DOWNLOADING,
        file,
        progress,
        loaded,
        total
    })
}

class GenerationTracker {
    constructor(pipeline, stride_length_s) {
        this.pipeline = pipeline
        this.stride_length_s = stride_length_s
        this.chunks = []
        this.time_precision = pipeline?.processor.feature_extractor.config.chunk_length / pipeline.model.config.max_source_positions
        this.processed_chunks = []
        this.callbackFunctionCounter = 0
    }

    sendFinalResult() {
        self.postMessage({ type: MessageTypes.INFERENCE_DONE })
    }

    callbackFunction(beams) {
        this.callbackFunctionCounter += 1
        if (this.callbackFunctionCounter % 10 !== 0) {
            return
        }

        const bestBeam = beams[0]
        let text = this.pipeline.tokenizer.decode(bestBeam.output_token_ids, {
            skip_special_tokens: true
        })

        const result = {
            text,
            start: this.getLastChunkTimestamp(),
            end: undefined
        }

        createPartialResultMessage(result)
    }

    chunkCallback(data) {
        this.chunks.push(data)
        const [text, { chunks }] = this.pipeline.tokenizer._decode_asr(
            this.chunks,
            {
                time_precision: this.time_precision,
                return_timestamps: true,
                force_full_sequence: false
            }
        )

        this.processed_chunks = chunks.map((chunk, index) => {
            return this.processChunk(chunk, index)
        })


        createResultMessage(
            this.processed_chunks, false, this.getLastChunkTimestamp()
        )
    }

    getLastChunkTimestamp() {
        if (this.processed_chunks.length === 0) {
            return 0
        }
    }

    processChunk(chunk, index) {
        const { text, timestamp } = chunk
        const [start, end] = timestamp

        return {
            index,
            text: `${text.trim()}`,
            start: Math.round(start),
            end: Math.round(end) || Math.round(start + 0.9 * this.stride_length_s)
        }

    }
}

function createResultMessage(results, isDone, completedUntilTimestamp) {
    self.postMessage({
        type: MessageTypes.RESULT,
        results,
        isDone,
        completedUntilTimestamp
    })
}

function createPartialResultMessage(result) {
    self.postMessage({
        type: MessageTypes.RESULT_PARTIAL,
        result
    })
}