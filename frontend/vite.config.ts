import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    // /api をバックエンドへ流す(VITE_API_MODE=http のとき使う)。宛先は WORKS_API_TARGET で変えられる(scripts/e2e-http.sh)
    proxy: { '/api': { target: process.env.WORKS_API_TARGET ?? 'http://127.0.0.1:8000', changeOrigin: true } },
  },
})
