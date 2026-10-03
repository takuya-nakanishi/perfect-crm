#!/usr/bin/env node
// Android アプリの画面の絵(見た目の正。docs/design/09-android.md §4.7・A-23)を作る。
//
//   node scripts/android-mockups.mjs          → docs/design/android/<画面>-<light|dark>.png(2 倍の解像度)
//   node scripts/android-mockups.mjs --sheet  → 見比べ用の一覧 /tmp/android-mockups/sheet-<light|dark>.png も作る(リポジトリには入れない)
//
// 色は Web のトークン(frontend/src/styles/index.css の :root と [data-theme='dark'])をその場で読む。値を写さない。
// 文字は Figtree(欧文と数字。アプリに同梱する)と Noto Sans CJK JP(和文。Android の標準)。太さは 400 と 700 だけ。
// アイコンは Web と同じ lucide。データはモックの架空の会社・人物(frontend/src/mocks/fixtures)。画面の大きさは 448×997dp(本人の端末)。
// 要るもの: frontend の node_modules(npm ci。playwright-core・lucide-react・Figtree)と Playwright の Chromium(~/.cache/ms-playwright)。
import { mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FRONTEND = join(ROOT, 'frontend')
const OUT = join(ROOT, 'docs/design/android')
const SHEET_OUT = '/tmp/android-mockups'
const W = 448
const H = 997

const require = createRequire(join(FRONTEND, 'package.json'))
const { chromium } = require('playwright-core')

// --- 材料 ---------------------------------------------------------------------------------------

const css = readFileSync(join(FRONTEND, 'src/styles/index.css'), 'utf8')
const block = (selector) => {
  const start = css.indexOf(`${selector} {`)
  return css.slice(start, css.indexOf('\n}', start) + 2)
}
const tokens = `${block(':root')}\n${block("[data-theme='dark']")}`

const figtree = readFileSync(join(FRONTEND, 'node_modules/@fontsource-variable/figtree/files/figtree-latin-wght-normal.woff2')).toString('base64')

const ICON_DIR = join(FRONTEND, 'node_modules/lucide-react/dist/esm/icons')
const iconNames = ['house', 'star', 'search', 'layout-grid', 'ellipsis-vertical', 'plus', 'x', 'check', 'lock', 'server', 'building-complex', 'handshake', 'calendar', 'repeat', 'circle-alert', 'wifi', 'signal', 'battery-full']
const icons = {}
for (const name of iconNames) {
  const { __iconData } = await import(pathToFileURL(join(ICON_DIR, `${name}.mjs`)).href)
  icons[name] = __iconData.node.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).filter(([k]) => k !== 'key').map(([k, v]) => `${k}="${v}"`).join(' ')}/>`).join('')
}
const icon = (name, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`

// 四つ葉の印(frontend/src/components/shell/CloverMark.tsx と同じ形)
const clover = (size) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">
  <circle cx="8" cy="8" r="5.6" fill="var(--accent)"/><circle cx="16" cy="8" r="5.6" fill="color-mix(in oklab, var(--accent) 78%, var(--paper))"/>
  <circle cx="16" cy="16" r="5.6" fill="var(--accent)"/><circle cx="8" cy="16" r="5.6" fill="color-mix(in oklab, var(--accent) 78%, var(--paper))"/></svg>`

// --- 部品 ---------------------------------------------------------------------------------------

const statusBar = `<div class="status"><span>9:30</span><span class="sys">${icon('signal')}${icon('wifi')}${icon('battery-full', 'bat')}</span></div>`
const gesture = (onChrome = false) => `<div class="gesture${onChrome ? ' on-chrome' : ''}"><i></i></div>`

/** 下のナビ。1 つ目はお気に入りの先頭のビュー(ラベルはメタデータの pin.label) */
const tabs = (active) => `<nav class="tabs">${[
  ['house', '今日'],
  ['star', 'お気に入り'],
  ['search', '検索'],
  ['layout-grid', 'テーブル'],
].map(([i, label], n) => `<div class="tab${n === active ? ' on' : ''}"><span class="pill">${icon(i)}</span>${label}</div>`).join('')}</nav>`

// 今日のビュー(モックの「今日」: 未完了・期限が今日以前、優先度 → 期限の順)。今日は 2026-10-04(日)
const today = [
  { title: '見積 3 案への返答を催促する', p: 'red', due: '10月2日(金)', late: true, rel: ['handshake', '受発注 EDI 連携'] },
  { title: '契約書ドラフトを法務に回す', p: 'red', due: '昨日', late: true, rel: ['handshake', '配車管理のクラウド移行'] },
  { title: '概算見積を作る', p: 'red', due: '今日', rel: ['handshake', '検査データ収集システム 第 2 期'] },
  { title: '役割分担のたたき台を送る', p: 'red', due: '今日', rel: ['handshake', '共同提案: 自治体向けポータル'] },
  { title: '請求書の送付先を確認する', p: 'orange', due: '9月30日(水)', late: true, rel: ['building-complex', '株式会社ナナホシ堂'] },
  { title: 'デモ環境にサンプル物件を入れる', p: 'orange', due: '今日', rel: ['handshake', '物件管理と内見予約のシステム化'] },
  { title: '名刺のお礼メールを送る', p: 'blue', due: '10月1日(木)', late: true, rel: ['building-complex', '白波マリンサービス株式会社'] },
  { title: '月次の経費精算', p: 'blue', due: '今日', repeat: true },
  { title: '歯医者の予約を取る', p: 'gray', due: '今日' },
]

const taskRow = (t, state = '') => `<div class="row ${state}">
  <span class="check${state === 'done' ? ' on' : ''}" style="--c:${t.p === 'gray' ? 'var(--ink-3)' : `var(--tag-${t.p}-ink)`}">${icon('check')}</span>
  <div class="rmain"><div class="rtitle">${t.title}</div>
    <div class="meta"><span class="${t.late ? 'late' : t.due === '今日' ? 'today' : ''}">${icon('calendar')}${t.due}${t.repeat ? icon('repeat', 'rep') : ''}</span>${t.rel ? `<span class="rel">${icon(t.rel[0])}<b>${t.rel[1]}</b></span>` : ''}</div>
  </div></div>`

// --- 画面 ---------------------------------------------------------------------------------------

const screens = {
  /** 初めて開いたとき: サーバの URL(09 §6.1) */
  connect: () => `${statusBar}<main class="body auth">
    <div class="brand">${clover(34)}Works</div>
    <h1>Works のアドレス</h1>
    <p class="lead">パソコンで Works を開くときの URL を入れてください。</p>
    <label class="label">URL</label>
    <div class="field"><span class="pre">https://</span>works.example.com<i class="caret"></i></div>
    <p class="hint">https:// は付けなくてもかまいません</p>
    <div class="spacer"></div>
    <div class="btn">次へ</div>
  </main>${gesture()}`,

  /** Works のサーバだと確かめたあと: ログイン(09 §6.2) */
  login: () => `${statusBar}<main class="body auth">
    <div class="brand">${clover(34)}Works</div>
    <h1>ログイン</h1>
    <p class="lead">Chrome でログインの画面が開きます。入り終わると、このアプリに戻ります。</p>
    <div class="server"><span class="sv">${icon('server')}</span><span class="sname"><b>works.example.com</b><small>Works のサーバです</small></span><span class="link">変更</span></div>
    <div class="spacer"></div>
    <div class="btn">ログイン</div>
  </main>${gesture()}`,

  /** Auth Tab の中の Web の画面: 許可のカード(09 §6.2・05 §15。作るのは J-071) */
  consent: () => `${statusBar}<div class="ctab">${icon('x')}<span class="ctitle"><b>Works</b><small>${icon('lock')}works.example.com</small></span>${icon('ellipsis-vertical')}</div>
  <main class="body auth web">
    <div class="brand small">${clover(28)}Works</div>
    <h1>アプリに許可しますか</h1>
    <p class="lead">「Works · Android」が、あなたのアカウントで Works を使おうとしています。</p>
    <div class="warnbox">${icon('circle-alert')}<p>このスマホで、自分で入れた Works のアプリからログインしましたか。心当たりが無ければ、許可しないでください。</p></div>
    <p class="note">許可すると、このアプリは takuya@example.jp として Works のデータを読み書きできます。アカウントの画面から、いつでも切れます。</p>
    <div class="spacer"></div>
    <div class="btn">許可する</div>
    <div class="btn sub">許可しない</div>
  </main>${gesture()}`,

  /** ホーム = お気に入りの先頭のビュー(今日)。09 §4.1・§4.2 */
  today: () => `${statusBar}<main class="body">
    <header class="head"><div><h2>今日</h2><p class="count">9 件</p></div><span class="iconbtn">${icon('ellipsis-vertical')}</span></header>
    <div class="rows">${today.map((t) => taskRow(t)).join('')}</div>
    <div class="fab">${icon('plus')}</div>
  </main>${tabs(0)}${gesture(true)}`,

  /** ○ を押した直後: 行が抜け、「元に戻す」が出る(09 §4.2) */
  'today-undo': () => `${statusBar}<main class="body">
    <header class="head"><div><h2>今日</h2><p class="count">8 件</p></div><span class="iconbtn">${icon('ellipsis-vertical')}</span></header>
    <div class="rows">${today.map((t, i) => taskRow(t, i === 2 ? 'done' : '')).join('')}</div>
    <div class="fab up">${icon('plus')}</div>
    <div class="snack"><span>「概算見積を作る」を完了しました</span><b>元に戻す</b></div>
  </main>${tabs(0)}${gesture(true)}`,
}

const captions = {
  connect: 'サーバの URL',
  login: 'ログイン',
  consent: '許可のカード(Chrome の中)',
  today: '今日',
  'today-undo': '完了 → 元に戻す',
}

// --- 見た目 -------------------------------------------------------------------------------------

const style = `
@font-face { font-family: 'Figtree'; font-weight: 300 900; src: url(data:font/woff2;base64,${figtree}) format('woff2'); }
${tokens}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Figtree', 'Noto Sans CJK JP', sans-serif; -webkit-font-smoothing: antialiased; background: transparent; }
.phone { width: ${W}px; height: ${H}px; display: flex; flex-direction: column; position: relative; overflow: hidden;
  background: var(--paper); color: var(--ink); font-size: 16px; line-height: 1.5; }
svg.i { width: 24px; height: 24px; flex: none; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
b { font-weight: 700; }

.status { height: 40px; flex: none; display: flex; align-items: center; justify-content: space-between; padding: 0 22px 0 28px; font-size: 14px; font-weight: 700; }
.status .sys { display: flex; align-items: center; gap: 6px; }
.status svg.i { width: 17px; height: 17px; stroke-width: 2.2; }
.status svg.bat { width: 20px; height: 20px; }
.gesture { height: 24px; flex: none; display: grid; place-items: center; }
.gesture.on-chrome { background: var(--chrome); }
.gesture i { width: 112px; height: 4px; border-radius: 2px; background: var(--ink); opacity: 0.85; }
.body { flex: 1; min-height: 0; position: relative; overflow: hidden; }

/* ログインまで */
.auth { display: flex; flex-direction: column; padding: 0 28px; }
.brand { display: flex; align-items: center; gap: 12px; margin-top: 76px; font-size: 24px; font-weight: 700; letter-spacing: 0.01em; }
.brand.small { margin-top: 36px; font-size: 20px; gap: 10px; }
.auth h1 { font-size: 30px; line-height: 40px; font-weight: 700; margin-top: 40px; }
.web h1 { font-size: 26px; line-height: 36px; margin-top: 28px; }
.lead { font-size: 15px; line-height: 25px; color: var(--ink-2); margin-top: 10px; }
.label { display: block; font-size: 14px; color: var(--ink-2); margin: 34px 0 8px; }
.field { height: 56px; display: flex; align-items: center; padding: 0 16px; border-radius: 12px; border: 2px solid var(--accent); font-size: 18px; }
.field .pre { color: var(--ink-3); }
.caret { width: 2px; height: 24px; margin-left: 2px; background: var(--accent); }
.hint { font-size: 13px; color: var(--ink-3); margin-top: 10px; }
.spacer { flex: 1; }
.btn { height: 56px; flex: none; display: grid; place-items: center; border-radius: 12px; background: var(--accent); color: var(--on-accent); font-size: 17px; font-weight: 700; margin-bottom: 24px; }
.btn + .btn { margin-top: -12px; }
.btn.sub { background: transparent; color: var(--ink); box-shadow: inset 0 0 0 1.5px var(--line-strong); }
.server { display: flex; align-items: center; gap: 14px; margin-top: 32px; padding: 14px 16px; border-radius: 12px; box-shadow: inset 0 0 0 1px var(--line-strong); }
.server .sv { width: 40px; height: 40px; display: grid; place-items: center; border-radius: 20px; background: var(--accent-wash); color: var(--accent-ink); }
.server .sv svg.i { width: 20px; height: 20px; }
.sname { flex: 1; display: flex; flex-direction: column; font-size: 17px; line-height: 24px; }
.sname small { font-size: 13px; line-height: 18px; color: var(--ink-2); }
.link { color: var(--accent); font-size: 15px; font-weight: 700; padding: 8px 4px; }

/* Auth Tab(Chrome)の枠 */
.ctab { height: 60px; flex: none; display: flex; align-items: center; gap: 18px; padding: 0 14px 0 18px; background: var(--chrome); box-shadow: inset 0 -1px 0 var(--line); color: var(--ink-2); }
.ctitle { flex: 1; display: flex; flex-direction: column; color: var(--ink); font-size: 15px; line-height: 20px; }
.ctitle small { display: flex; align-items: center; gap: 4px; font-size: 13px; line-height: 18px; color: var(--ink-2); }
.ctitle small svg.i { width: 12px; height: 12px; stroke-width: 2.5; }
.warnbox { display: flex; gap: 12px; margin-top: 24px; padding: 14px 16px; border-radius: 12px; background: var(--warn-wash); color: var(--ink); font-size: 15px; line-height: 24px; }
.warnbox svg.i { width: 20px; height: 20px; margin-top: 2px; color: var(--warn); }
.note { margin-top: 18px; font-size: 14px; line-height: 23px; color: var(--ink-2); }

/* 一覧 */
.head { display: flex; align-items: flex-start; justify-content: space-between; padding: 18px 20px 8px; }
.head h2 { font-size: 28px; line-height: 36px; font-weight: 700; letter-spacing: 0.01em; }
.count { font-size: 14px; line-height: 20px; color: var(--ink-3); margin-top: 2px; }
.iconbtn { width: 44px; height: 44px; display: grid; place-items: center; margin: -4px -10px 0 0; color: var(--ink-2); }
.row { display: grid; grid-template-columns: 24px 1fr; column-gap: 16px; padding: 13px 20px; position: relative; }
.row + .row::before { content: ''; position: absolute; top: 0; left: 60px; right: 0; height: 1px; background: var(--line); }
.check { width: 22px; height: 22px; margin-top: 1px; display: grid; place-items: center; border-radius: 50%;
  border: 1.75px solid var(--c); background: color-mix(in oklab, var(--c) 8%, transparent); color: transparent; }
.check svg.i { width: 13px; height: 13px; stroke-width: 3; }
.check.on { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.rmain { min-width: 0; }
.rtitle { font-size: 16px; line-height: 24px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.meta { display: flex; gap: 14px; margin-top: 2px; font-size: 13px; line-height: 18px; color: var(--ink-2); min-width: 0; }
.meta span { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
.meta svg.i { width: 14px; height: 14px; }
.meta svg.rep { width: 13px; height: 13px; margin-left: 2px; }
.meta .late { color: var(--danger); }
.meta .today { color: var(--accent); }
.meta .rel { min-width: 0; overflow: hidden; }
.meta .rel b { font-weight: 400; overflow: hidden; text-overflow: ellipsis; }
.row.done { opacity: 0.5; transform: translateX(10px); }
.row.done .rtitle { color: var(--ink-3); }
.fab { position: absolute; right: 20px; bottom: 20px; width: 60px; height: 60px; display: grid; place-items: center; border-radius: 30px;
  background: var(--accent); color: var(--on-accent); box-shadow: var(--elev-pop); }
.fab svg.i { width: 28px; height: 28px; stroke-width: 2.5; }
.fab.up { bottom: 84px; }
.snack { position: absolute; left: 12px; right: 12px; bottom: 12px; height: 56px; display: flex; align-items: center; gap: 12px; padding: 0 8px 0 18px;
  border-radius: 12px; background: #1d2620; color: #f0f4f1; font-size: 15px; box-shadow: var(--elev-pop); }
[data-theme='dark'] .snack { background: #2b332d; }
.snack span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.snack b { color: #86dcad; padding: 8px 10px; }
.tabs { height: 76px; flex: none; display: grid; grid-template-columns: repeat(4, 1fr); padding-top: 10px; background: var(--chrome); box-shadow: inset 0 1px 0 var(--line); }
.tab { display: flex; flex-direction: column; align-items: center; gap: 4px; font-size: 12px; line-height: 16px; color: var(--ink-2); }
.tab .pill { width: 60px; height: 32px; display: grid; place-items: center; border-radius: 16px; }
.tab.on { color: var(--ink); font-weight: 700; }
.tab.on .pill { background: var(--accent-wash); color: var(--accent-ink); }

/* 見比べ用の一覧 */
.sheet { display: flex; gap: 40px; padding: 40px; background: var(--chrome); width: max-content; }
.sheet figure { display: flex; flex-direction: column; gap: 14px; }
.sheet .phone { border-radius: 28px; box-shadow: 0 0 0 1px var(--line-strong), var(--elev-pop); }
.sheet figcaption { font-size: 16px; font-weight: 700; color: var(--ink-2); text-align: center; }
`

const page = (theme, body) => `<!doctype html><html lang="ja" data-theme="${theme}"><head><meta charset="utf-8"><style>${style}</style></head><body>${body}</body></html>`

// --- 撮る ---------------------------------------------------------------------------------------

const base = `${process.env.HOME}/.cache/ms-playwright`
const dir = readdirSync(base).find((d) => d.startsWith('chromium-'))
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? `${base}/${dir}/chrome-linux64/chrome` })
mkdirSync(OUT, { recursive: true })
const sheet = process.argv.includes('--sheet')
if (sheet) mkdirSync(SHEET_OUT, { recursive: true })

for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, colorScheme: theme })
  const p = await ctx.newPage()
  for (const [name, render] of Object.entries(screens)) {
    await p.setContent(page(theme, `<div class="phone">${render()}</div>`))
    await p.evaluate(() => document.fonts.ready)
    await p.locator('.phone').screenshot({ path: join(OUT, `${name}-${theme}.png`) })
  }
  if (sheet) {
    const figs = Object.entries(screens).map(([name, render]) => `<figure><div class="phone">${render()}</div><figcaption>${captions[name]}</figcaption></figure>`).join('')
    await p.setViewportSize({ width: 40 + Object.keys(screens).length * (W + 40), height: H + 120 })
    await p.setContent(page(theme, `<div class="sheet">${figs}</div>`))
    await p.evaluate(() => document.fonts.ready)
    await p.locator('.sheet').screenshot({ path: join(SHEET_OUT, `sheet-${theme}.png`) })
  }
  await ctx.close()
}
await browser.close()
console.log(`書きました: ${OUT}${sheet ? `、${SHEET_OUT}` : ''}`)
