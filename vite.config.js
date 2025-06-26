import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // server: {
  //   proxy: {
  //     // Proxy all /Xenova requests to the raw model files on HF
  //     '/Xenova': {
  //       target: 'https://huggingface.co',
  //       changeOrigin: true,
  //       rewrite: (path) => path.replace(/^\/Xenova/, '/Xenova'),
  //     },
  //     // If you use openai models too
  //     '/openai': {
  //       target: 'https://huggingface.co',
  //       changeOrigin: true,
  //       rewrite: (path) => path.replace(/^\/models\/openai/, '/openai/whisper-tiny.en'),
  //     }
  //   }
  // }
})


