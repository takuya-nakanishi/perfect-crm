import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * L1(lib の純関数)と L2(モックのエンジン = サーバの振る舞いの正)の単体テスト。
 * 置き場は対象ファイルの隣の *.test.ts(docs/tests/README.md §3)。DOM を使う lib(richtext)と
 * localStorage を使うモックのために happy-dom で動かす。
 */
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
    restoreMocks: true,
  },
})
