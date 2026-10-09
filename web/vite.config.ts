import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // En desarrollo con `npm run dev`, la API de n8n se sirve a través de este proxy.
  // La demo importa la librería del backend (../src/lib.js) para ejecutarla en el navegador.
  // En la demo no hay backend: la API se atiende en el navegador.
  server: { proxy: process.env.VITE_DEMO === '1' ? {} : { '/webhook': 'http://localhost:5680' }, fs: { allow: ['..'] } },
  build: { chunkSizeWarningLimit: 1500 },
})
