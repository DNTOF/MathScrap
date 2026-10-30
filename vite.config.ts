import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 47321,
  },
  preview: {
    host: '0.0.0.0',
    port: 47322,
  },
  build: {
    // Plotly (~4.6 MB) is its own lazily imported chunk, loaded only when a plot opens.
    chunkSizeWarningLimit: 5000,
  },
})
