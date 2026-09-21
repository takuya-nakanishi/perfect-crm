// 画面の主要な操作が動くことを、実際のブラウザで確かめる(ログイン → 完了 → 追加 → 検索 → 編集 → カンバン → 作成)。
//
//   npm run e2e                                  開発サーバ(http://127.0.0.1:5173)に対して
//   npm run e2e -- http://127.0.0.1:8610         コンテナの本番ビルドに対して
//   python3 ../scripts/cloudflare-access-check.py works.sanei-clover.com --exec 'npm --prefix frontend run e2e -- https://works.sanei-clover.com'
//                                                Cloudflare Access 越しの公開 URL に対して
//
// ブラウザは Playwright が入れた Chromium を使う(CHROMIUM_PATH で指定。無ければ ~/.cache/ms-playwright から探す)。
// モックのデータはブラウザごとに初期化されるので、何度走らせても同じ結果になる。
import { readdirSync } from 'node:fs'
import { chromium } from 'playwright-core'

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH
  const root = `${process.env.HOME}/.cache/ms-playwright`
  const dir = readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().at(-1)
  if (!dir) throw new Error('Chromium が無い。npx playwright install chromium を実行するか CHROMIUM_PATH を指定する')
  return `${root}/${dir}/chrome-linux64/chrome`
}

const BASE = process.argv[2] || 'http://127.0.0.1:5173'
// Cloudflare Access の内側を試すときは、サービストークンを全リクエストに付ける
const accessHeaders = process.env.CF_ACCESS_CLIENT_ID
  ? { 'CF-Access-Client-Id': process.env.CF_ACCESS_CLIENT_ID, 'CF-Access-Client-Secret': process.env.CF_ACCESS_CLIENT_SECRET ?? '' }
  : undefined
const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] })
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: 'ja-JP',
  timezoneId: 'Asia/Tokyo',
  extraHTTPHeaders: accessHeaders,
})
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })

let failed = 0
const ok = (cond, label, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  — ' + extra : ''}`); if (!cond) failed++ }
const rows = () => page.locator('[role=table] [role=row][data-row]').count()
const wait = (ms) => page.waitForTimeout(ms)

// 1. 未ログインならログイン画面へ。ログイン後は今日のタスクへ
await page.goto(BASE + '/o/accounts')
await page.waitForURL(/\/login/)
ok(page.url().includes('next='), '未ログインで /login へ送られ、戻り先を持っている')
await page.fill('#email', 'takuya@example.jp'); await page.fill('#password', 'x'); await page.click('button[type=submit]')
await page.waitForSelector('[role=table]')
ok(page.url().includes('/o/accounts'), 'ログイン後、元の画面へ戻る')

await page.goto(BASE + '/')
await page.waitForSelector('[role=row][data-row]')
ok(/\/o\/tasks\?view=/.test(page.url()), 'ホームは「今日」のビュー', page.url())

// 2. キーボードで完了 → すぐ消える → 元に戻す
const before = await rows()
await page.keyboard.press('j'); await wait(50)
ok(await page.locator('[role=row][aria-selected=true]').count() === 1, 'J で行を選べる')
await page.keyboard.press('e'); await wait(900)
ok(await rows() === before - 1, 'E で完了にすると一覧から消える', `${before} → ${await rows()}`)
ok(await page.getByText('完了にしました').count() === 1, '完了のトーストが出る')
await page.getByRole('button', { name: '元に戻す' }).click(); await wait(700)
ok(await rows() === before, '「元に戻す」で一覧に戻る', `${await rows()}`)

// 3. チェックのクリックで完了
await page.locator('[role=row][data-row] .task-check').first().click(); await wait(900)
ok(await rows() === before - 1, 'チェックを押すと一覧から消える')

// 4. Q でタスク追加(自然文の期限・優先度)
await page.keyboard.press('q')
await page.waitForSelector('dialog[open] input[aria-label=件名]')
await page.keyboard.type('E2E のタスク 今日 p2'); await wait(100)
ok(await page.getByText('期限を今日にします').count() === 1, '件名から期限を読み取る')
await page.keyboard.press('Enter'); await wait(800)
ok(await page.locator('dialog[open]').count() === 0, 'Enter で追加して閉じる')
ok(await page.getByText('E2E のタスク', { exact: true }).count() >= 1, '追加したタスクが「今日」に出る')

// 5. / で検索 → レコードを開く
await page.keyboard.press('/')
await page.waitForSelector('dialog[open] input[aria-label=検索]')
await page.keyboard.type('あおば'); await wait(500)
await page.keyboard.press('Enter'); await wait(500)
ok(/peek=accounts/.test(page.url()), '検索から取引先のパネルが開く', decodeURIComponent(page.url().split('?')[1] || ''))
ok(await page.locator('aside input').first().inputValue() === '株式会社アオバ精機', 'パネルの題名が取引先名')

// 6. パネルで編集 → 再読み込みしても残る
const phone = page.locator('aside input[type=tel]').first()
await phone.fill('045-0000-9999'); await phone.press('Enter'); await wait(500)
await page.reload(); await page.waitForSelector('aside input[type=tel]')
ok(await page.locator('aside input[type=tel]').first().inputValue() === '045-0000-9999', '編集した値が再読み込み後も残る')

// 6b. パネルを開いたまま Q → 関連先が入っている
await page.keyboard.press('q')
await page.waitForSelector('dialog[open]')
ok(await page.locator('dialog[open]').getByText('株式会社アオバ精機').count() === 1, 'パネルを開いて Q を押すと関連先が入る')
await page.keyboard.press('Escape'); await wait(200)
ok(await page.locator('dialog[open]').count() === 0 && /peek=/.test(page.url()), 'Esc はモーダルだけを閉じ、パネルは残る')
await page.keyboard.press('Escape'); await wait(200)
ok(!/peek=/.test(page.url()), '次の Esc でパネルが閉じる')

// 7. G→3 で商談へ、2 でカンバンへ、ドラッグでフェーズ変更
await page.keyboard.press('g'); await page.keyboard.press('3'); await wait(400)
ok(page.url().includes('/o/opportunities'), 'G → 3 で商談へ移動')
await page.keyboard.press('2'); await wait(500)
const colCount = async (label) => Number(await page.locator(`section[aria-label="${label}"] header span.tabular-nums`).first().innerText())
const a0 = await colCount('見込み'), b0 = await colCount('ヒアリング')
const card = page.locator('section[aria-label="見込み"] [role=button]').first()
const target = page.locator('section[aria-label="ヒアリング"]')
const cb = await card.boundingBox(), tb = await target.boundingBox()
await page.mouse.move(cb.x + cb.width / 2, cb.y + 20); await page.mouse.down()
await page.mouse.move(cb.x + cb.width / 2 + 30, cb.y + 40, { steps: 5 })
await page.mouse.move(tb.x + tb.width / 2, tb.y + 200, { steps: 12 }); await wait(150)
await page.mouse.up(); await wait(800)
ok(await colCount('見込み') === a0 - 1 && await colCount('ヒアリング') === b0 + 1, 'カードをドラッグするとフェーズが変わる', `見込み ${a0}→${await colCount('見込み')} / ヒアリング ${b0}→${await colCount('ヒアリング')}`)
await page.keyboard.press('3'); await wait(600)
ok(await page.getByText('フェーズごとの金額').count() === 1, '3 でレポートへ切り替わる')

// 8. N で新規作成
await page.keyboard.press('g'); await page.keyboard.press('1'); await wait(400)
await page.keyboard.press('n')
await page.waitForSelector('dialog[open]')
await page.keyboard.type('株式会社イーツーイー商会')
await page.keyboard.press('Control+Enter'); await wait(900)
ok(await page.locator('dialog[open]').count() === 0, 'Ctrl+Enter で作成して閉じる')
ok(await page.getByText('株式会社イーツーイー商会').count() >= 1, '作成した取引先が一覧に出る')

// 8b. 必須が空なら作成しない
await page.keyboard.press('n'); await page.waitForSelector('dialog[open]')
await page.locator('dialog[open] button[type=submit]').click(); await wait(200)
ok(await page.getByText('取引先名を入力してください').count() === 1, '必須が空なら、その場で伝える')
await page.keyboard.press('Escape'); await wait(200)

// 9. F で絞り込み、M でサイドバー、? でヘルプ
await page.keyboard.press('f'); await page.keyboard.type('かささぎ'); await wait(500)
ok(await rows() === 1, 'F で絞り込める(ひらがなでも当たる)', `${await rows()} 件 / 入力値「${await page.inputValue('#table-filter')}」 / active=${await page.evaluate(() => document.activeElement?.tagName + '#' + document.activeElement?.id)}`)
await page.keyboard.press('Escape'); await wait(400)
await page.keyboard.press('m'); await wait(200)
ok(await page.locator('nav[aria-label=メイン]').isVisible() === false, 'M でサイドバーを畳める')
await page.keyboard.press('m'); await wait(200)
await page.keyboard.press('?'); await wait(300)
ok(await page.locator('dialog[open]').getByText('ショートカット').count() >= 1, '? でショートカット一覧')
await page.keyboard.press('Escape'); await wait(200)

// 10. ログアウト
await page.getByRole('button', { name: /Sanei Clover/ }).click()
await page.getByRole('button', { name: 'ログアウト' }).click()
await page.waitForURL(/\/login/)
ok(true, 'ログアウトでログイン画面へ戻る')

if (errors.length) { console.log('\nブラウザのエラー:\n' + errors.join('\n')); failed++ }
console.log(failed ? `\n${failed} 件の失敗` : '\nすべて通過')
await browser.close()
process.exit(failed ? 1 : 0)
