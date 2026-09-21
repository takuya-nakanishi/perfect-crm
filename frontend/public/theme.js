// 描画の前に明暗を決める(読み込み直後のちらつきを防ぐ)。src/state/ui.ts の applyTheme と同じ判定。
// index.html に直接書かないのは、インラインのスクリプトを CSP で禁じているため(frontend/Caddyfile)
;(function () {
  var t = localStorage.getItem('works.theme')
  var dark = t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
})()
