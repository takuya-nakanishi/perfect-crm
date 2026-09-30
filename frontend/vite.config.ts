import { realpathSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, searchForWorkspaceRoot } from 'vite'

/**
 * 開発サーバが配ってよい場所。worktree(scripts/wt-new.sh)では node_modules が本体へのリンクなので、
 * リンク先も入れる(入れないと書体が 403 になり、E2E が「ブラウザのエラー」で落ちる。runbook §4)
 */
function servable(): string[] {
  const allow = [searchForWorkspaceRoot(process.cwd())]
  try {
    allow.push(realpathSync(fileURLToPath(new URL('./node_modules', import.meta.url))))
  } catch {
    // node_modules がまだ無い(npm ci の前)
  }
  return allow
}

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
    fs: { allow: servable() },
  },
})
