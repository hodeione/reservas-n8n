import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // En desarrollo con `npm run dev`, la API de n8n se sirve a través de este proxy.
  server: { proxy: { '/webhook': 'http://localhost:5680' } },
  build: { chunkSizeWarningLimit: 1500 },
})
