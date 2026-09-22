// 画面の主要な操作が動くことを、実際のブラウザで確かめる(ログイン → 完了 → 追加 → 検索 → 編集 → カンバン → 作成 → ぱんくず → テーブルの追加と設定 → 活動 → 桁区切りとパネルの幅 → サイドバーの並べ替え → Google ドライブ)。
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

// 10. ぱんくず: 取引先 → 関連する取引先責任者 → 途中を押して戻る
await page.keyboard.press('g'); await page.keyboard.press('1'); await wait(400)
await page.getByText('株式会社アカツキ運輸').first().click(); await page.waitForSelector('aside')
await page.locator('aside section').filter({ hasText: '取引先責任者' }).locator('[role=button]').first().click(); await wait(400)
const trailOf = () => (new URL(page.url()).searchParams.get('peek') ?? '').split(',').filter(Boolean).map((p) => p.split(':')[0]).join(' > ')
ok(trailOf() === 'accounts > contacts', '関連リストから開くと、経路が URL に積まれる', trailOf())
ok(await page.locator('aside nav li[aria-current=page]').innerText() === '取引先責任者', 'ぱんくずの末尾が、いま開いているテーブル')
await page.locator('aside').getByRole('button', { name: /を開く$/ }).first().click(); await wait(400)
ok(trailOf() === 'accounts', '経路に既にあるレコードを開くと、そこまで戻る(堂々巡りにしない)', trailOf())
await page.goBack(); await wait(400)
ok(trailOf() === 'accounts > contacts', 'ブラウザの「戻る」で、進んだ先へ戻れる', trailOf())
await page.locator('aside nav').getByRole('button', { name: /株式会社アカツキ運輸/ }).click(); await wait(400)
ok(trailOf() === 'accounts', 'ぱんくずの途中を押すと、そのレコードへ戻る', trailOf())
await page.keyboard.press('Escape'); await wait(200)

// 11. テーブルを追加 → レコードを作成 → 設定で項目を足す → 元に戻す → テーブルを削除
await page.getByRole('heading', { name: 'テーブル', exact: true }).hover()
await page.getByRole('link', { name: 'テーブルを追加' }).click()
await page.waitForSelector('dialog[open] #table-label')
await page.keyboard.type('見積'); await page.keyboard.press('Enter')
await page.keyboard.press('Control+a'); await page.keyboard.type('見積番号'); await page.keyboard.press('Enter')
await page.keyboard.type('状況')
await page.getByRole('button', { name: '状況のデータ型' }).click(); await page.getByRole('option', { name: /選択肢/ }).click()
await page.getByLabel('選択肢 1').fill('下書き'); await page.getByLabel('選択肢 1').press('Enter'); await page.keyboard.type('提出済み')
await page.keyboard.press('Control+Enter'); await page.waitForURL(/\/o\/table_1/); await wait(400)
ok(await page.locator('nav[aria-label=メイン]').getByText('見積', { exact: true }).count() === 1, '追加したテーブルがサイドバーに出る')
ok(await page.getByRole('tab', { name: 'カンバン' }).count() === 1, '選択肢の項目があると、カンバンも付く')
await page.keyboard.press('n'); await page.waitForSelector('dialog[open]')
await page.keyboard.type('Q-2026-001'); await page.keyboard.press('Control+Enter'); await wait(900)
ok(await page.getByText('Q-2026-001').count() >= 1, '追加したテーブルにレコードを作れる')
ok(await page.getByText('見積を作成しました').count() === 1, '作成のトーストが出る(画面を閉じたあとでも)')
await page.getByRole('button', { name: '見積の設定' }).click(); await page.getByRole('menuitem', { name: 'テーブル設定' }).click()
await page.waitForSelector('dialog[open] #table-label')
ok(page.url().includes('/settings/tables'), '歯車の「テーブル設定」は環境設定へ飛び、そのテーブルの設定が開く')
await page.getByRole('button', { name: '項目を追加' }).click(); await page.keyboard.type('金額')
await page.getByRole('button', { name: '金額のデータ型' }).click(); await page.getByRole('option', { name: /金額/ }).click()
await page.keyboard.press('Control+Enter'); await wait(700)
// 画面の中で移動する(再読み込みするとトーストの「元に戻す」が消える)
await page.locator('nav[aria-label=メイン] a[href="/o/table_1"]').click(); await page.waitForSelector('[role=columnheader]'); await wait(300)
ok(await page.getByRole('columnheader', { name: '金額' }).count() === 1, '設定で足した項目が一覧の列に出る')
await page.getByRole('button', { name: '元に戻す' }).click(); await wait(700)
ok(await page.getByRole('columnheader', { name: '金額' }).count() === 0, '「元に戻す」で項目が外れる')
const [download] = await Promise.all([
  page.waitForEvent('download'),
  (async () => { await page.getByRole('button', { name: '見積の設定' }).click(); await page.getByRole('menuitem', { name: 'エクスポート' }).click() })(),
])
ok(/^見積_\d{4}-\d{2}-\d{2}\.csv$/.test(download.suggestedFilename()), 'エクスポートで CSV が落ちる', download.suggestedFilename())
await page.getByRole('button', { name: '見積の設定' }).click(); await page.getByRole('menuitem', { name: 'インポート' }).click()
await page.waitForSelector('dialog[open] input[type=file]', { state: 'attached' })
await page.locator('dialog[open] input[type=file]').setInputFiles({ name: 'quotes.csv', mimeType: 'text/csv', buffer: Buffer.from('見積番号,状況\nQ-2026-002,提出済み\nQ-2026-003,無い状況\n') })
await page.getByRole('button', { name: '1 件を取り込む' }).click(); await wait(900)
ok(await page.getByText('Q-2026-002').count() >= 1 && await page.getByText('Q-2026-003').count() === 0, 'インポートは、読める行だけを取り込む')
await page.getByRole('button', { name: '見積の設定' }).click(); await page.getByRole('menuitem', { name: 'テーブル設定' }).click()
await page.getByRole('button', { name: 'テーブルを削除' }).click(); await wait(700)
ok(await page.locator('nav[aria-label=メイン]').getByText('見積', { exact: true }).count() === 0 && await page.locator('dialog[open]').count() === 0, 'テーブルを削除すると、サイドバーから消える')

// 12. 活動: 記録する → 時系列に出る → タスクの完了が活動に残り、戻すと消える
await page.keyboard.press('g'); await page.keyboard.press('1'); await wait(400)
await page.locator('[role=row][data-row]').first().locator('[role=cell]').first().click(); await page.waitForSelector('aside')
await page.locator('aside').getByText('についての活動を記録する').click()
await page.waitForSelector('aside form input[aria-label=件名]')
await page.keyboard.type('E2E の電話')
await page.locator('aside .tiptap').click(); await page.keyboard.type('要点を '); await page.keyboard.press('Control+b'); await page.keyboard.type('太字'); await page.keyboard.press('Control+Enter'); await wait(800)
ok(await page.locator('aside section[aria-label=活動]').getByText('E2E の電話').count() === 1, '活動を記録すると、その場の時系列に出る')
ok(await page.locator('aside section[aria-label=活動] strong').filter({ hasText: '太字' }).count() === 1, '内容の書式(太字)が残る')
ok(await page.getByText('活動を記録しました').count() === 1, '記録のトーストが出る')
// 初めから完了していたタスクも時系列に出る(活動に複製せず、サーバが合成する)
ok(await page.locator('aside section[aria-label=活動]').getByText('契約更新の案内を送る').count() === 1, '完了済みのタスクが時系列に出る(種データのものも)')
// @ で言及 → 言及先の時系列にも出る
await page.locator('aside').getByText('についての活動を記録する').click(); await page.waitForSelector('aside form input[aria-label=件名]')
await page.keyboard.type('言及のテスト'); await page.locator('aside .tiptap').click(); await page.keyboard.type('担当は @北浜'); await wait(700)
await page.keyboard.press('Enter'); await wait(200); await page.keyboard.press('Control+Enter'); await wait(900)
const mention = page.locator('aside section[aria-label=活動] [data-type=mention]').first()
ok((await mention.innerText()) === '@北浜ロジスティクス株式会社', '@ に続けて打つとレコードを探して言及できる', await mention.innerText())
await mention.click(); await wait(700)
const mentionTrail = /peek=accounts:[^,]+,accounts:/.test(decodeURIComponent(page.url()))
ok(mentionTrail && await page.locator('aside section[aria-label=活動]').getByText('の活動で言及').count() === 1, '言及先の時系列に「〜の活動で言及」として残り、押すとその先が開く')
await page.keyboard.press('Escape'); await wait(200)
await page.keyboard.press('g'); await page.keyboard.press('4'); await wait(400)
const doneTitle = (await page.locator('[role=row][data-row]').first().locator('[role=cell]').first().innerText()).trim()
await page.locator('[role=row][data-row]').first().locator('[role=cell]').first().click(); await page.waitForSelector('aside'); await wait(300)
await page.locator('aside').getByRole('button', { name: /を開く$/ }).first().click(); await wait(500)
const relatedTimeline = page.locator('aside section[aria-label=活動]')
const doneBefore = await relatedTimeline.getByText(doneTitle, { exact: true }).count()
await page.keyboard.press('Backspace'); await wait(300)
await page.locator('aside .task-check').first().click(); await wait(800)
await page.locator('aside').getByRole('button', { name: /を開く$/ }).first().click(); await wait(600)
ok(await relatedTimeline.getByText(doneTitle, { exact: true }).count() === doneBefore + 1, 'タスクを完了にすると、関連先の時系列に「完了」として出る', `${doneBefore} → ${await relatedTimeline.getByText(doneTitle, { exact: true }).count()}`)
await page.keyboard.press('Backspace'); await wait(300)
await page.locator('aside .task-check').first().click(); await wait(800)
await page.locator('aside').getByRole('button', { name: /を開く$/ }).first().click(); await wait(600)
ok(await relatedTimeline.getByText(doneTitle, { exact: true }).count() === doneBefore, '完了を戻すと、時系列からも消える')
await page.keyboard.press('Escape'); await wait(300)

// 13. 数値の桁区切りと、パネルの幅
await page.keyboard.press('g'); await page.keyboard.press('3'); await wait(400)
await page.locator('[role=row][data-row]').first().locator('[role=cell]').first().click(); await page.waitForSelector('aside'); await wait(400)
const amount = page.locator('aside input[inputmode=numeric]').first()
ok(/^¥[\d,]+$/.test(await amount.inputValue()), 'パネルの金額は桁区切りで見える', await amount.inputValue())
await amount.focus()
ok(/^\d+$/.test(await amount.inputValue()), '触ると素の数字になる', await amount.inputValue())
await amount.blur()
const sep = page.getByRole('separator', { name: /パネルの幅/ })
const sb = await sep.boundingBox()
const w0 = (await page.locator('aside').boundingBox()).width
await page.mouse.move(sb.x + sb.width / 2, 400); await page.mouse.down(); await page.mouse.move(sb.x - 150, 400, { steps: 6 }); await page.mouse.up(); await wait(300)
const w1 = (await page.locator('aside').boundingBox()).width
ok(Math.abs(w1 - w0 - 150) <= 8, 'パネルの左端をつまむと幅が変わる', `${w0} → ${w1}`)
await page.reload(); await page.waitForSelector('aside'); await wait(400)
ok(Math.round((await page.locator('aside').boundingBox()).width) === Math.round(w1), '幅は再読み込みしても残る')
await sep.dblclick(); await wait(300)
ok(Math.round((await page.locator('aside').boundingBox()).width) === Math.round(w0), 'ダブルクリックで元の幅')
await page.keyboard.press('Escape'); await wait(200)
ok((await page.locator('[role=tablist]').evaluate((el) => el.offsetHeight - el.clientHeight)) === 0, 'ビューのタブの行にスクロールバーが出ない')

// 14. サイドバーの並べ替え(G → n も追随)、Google ドライブの項目
{
  const nav = page.locator('nav[aria-label=メイン]')
  const src = nav.locator('a[href="/o/opportunities"]'), dst = nav.locator('a[href="/o/accounts"]')
  const s = await src.boundingBox(), d = await dst.boundingBox()
  await page.mouse.move(s.x + 40, s.y + s.height / 2); await page.mouse.down(); await page.mouse.move(s.x + 40, s.y + 5, { steps: 3 }); await page.mouse.move(d.x + 40, d.y + 4, { steps: 10 }); await wait(150); await page.mouse.up(); await wait(600)
  // お気に入り(?view= 付き)は除き、テーブルの行だけを見る
  const order = await nav.locator('a[href^="/o/"]:not([href*="?"])').evaluateAll((els) => els.map((e) => e.getAttribute('href')))
  ok(order[0] === '/o/opportunities' && order[1] === '/o/accounts', 'サイドバーのテーブルをドラッグで並べ替えられる', order.join(' '))
  await page.keyboard.press('g'); await page.keyboard.press('1'); await wait(400)
  ok(page.url().includes('/o/opportunities'), 'G → 1 は並べ替え後の先頭へ')
  await page.reload(); await page.waitForSelector('nav[aria-label=メイン]'); await wait(300)
  ok((await nav.locator('a[href^="/o/"]:not([href*="?"])').first().getAttribute('href')) === '/o/opportunities', '並びは保存される')
}
await page.goto(BASE + '/o/tasks?view=x'); await page.waitForSelector('[role=row][data-row]')
await page.locator('[role=row][data-row]').first().locator('[role=cell]').first().click(); await page.waitForSelector('aside'); await wait(400)
await page.locator('aside').getByRole('button', { name: '新規' }).click(); await wait(900)
ok(await page.locator('aside a[href*="docs.google.com/document"]').count() === 1, '「新規」でレコード名の Google ドキュメントが付く')
await page.locator('aside').getByRole('button', { name: '参照' }).click(); await wait(500)
await page.getByRole('option', { name: /提案書テンプレート/ }).click(); await wait(300)
await page.getByRole('option', { name: /見積書テンプレート/ }).click(); await wait(300)
await page.keyboard.press('Escape'); await wait(300)
ok(await page.locator('aside a[target=_blank]').count() === 3, '「参照」で複数のファイルを付けられる')
await page.locator('aside').getByRole('button', { name: '「提案書テンプレート」を外す' }).click(); await wait(300)
await page.reload(); await page.waitForSelector('aside'); await wait(400)
ok(await page.locator('aside a[target=_blank]').count() === 2, '外したものは外れたまま残る(再読み込み後)')
await page.keyboard.press('Escape'); await wait(200)

// 15. ビューの追加・条件・並び替え・設定・お気に入り・削除(Notion の型)
await page.goto(BASE + '/o/accounts'); await page.waitForSelector('[role=row][data-row]')
await page.getByRole('button', { name: 'ビューを追加' }).click(); await page.getByRole('menuitem', { name: '一覧' }).click(); await wait(700)
ok(/view=/.test(page.url()) && (await page.locator('[role=tab]').count()) === 4, '「+」で一覧のビューが増え、そのビューが開く')
await page.locator('[role=tab][aria-selected=true]').click(); await page.getByRole('menuitem', { name: '名前を変更' }).click(); await wait(200)
await page.keyboard.press('Control+a'); await page.keyboard.type('医療機関'); await page.keyboard.press('Enter'); await wait(500)
ok((await page.locator('[role=tab][aria-selected=true]').innerText()).startsWith('医療機関'), 'タブのメニューから名前を変えられる')
await page.getByRole('button', { name: 'フィルター(条件を足す)' }).click(); await wait(300)
await page.getByRole('option', { name: '業種' }).click(); await wait(400)
await page.getByRole('button', { name: '値' }).click(); await wait(200)
await page.getByRole('option', { name: '医療・福祉' }).click(); await wait(600)
await page.keyboard.press('Escape'); await wait(300)
ok(await rows() === 1 && (await page.locator('[data-filter-chip]').innerText()).includes('医療・福祉'), '条件(業種 が 医療・福祉)がその場で効いて、チップに出る', `${await rows()} 件`)
await page.getByRole('button', { name: 'ビューの設定' }).click(); await wait(300)
await page.getByRole('switch', { name: '「電話」を隠す' }).click(); await wait(300)
await page.getByLabel('お気に入りに出す').check(); await wait(400)
await page.keyboard.press('Escape'); await wait(300)
ok((await page.locator('[role=columnheader]').allInnerTexts()).every((t) => t !== '電話'), '設定で列を隠せる')
ok(await page.locator('nav[aria-label=メイン]').getByText('医療機関').count() === 1, 'お気に入りに出すと、サイドバーに件数付きで並ぶ')
await page.reload(); await page.waitForSelector('[role=row][data-row]'); await wait(300)
ok(await rows() === 1 && (await page.locator('[role=tab][aria-selected=true]').innerText()).startsWith('医療機関'), 'ビューは保存されている(再読み込み後)')
await page.goto(BASE + '/o/tasks'); await page.waitForSelector('[role=tab]')
await page.getByRole('button', { name: 'ビューを追加' }).click(); await page.getByRole('menuitem', { name: 'カンバン' }).click(); await wait(800)
await page.getByRole('button', { name: 'ビューの設定' }).click(); await wait(300)
await page.getByLabel('分ける項目').selectOption('priority'); await wait(500)
await page.keyboard.press('Escape'); await wait(400)
ok((await page.locator('section[aria-label] > header').allInnerTexts()).some((t) => t.startsWith('P1')), 'カンバンの分け方を優先度に変えられる')
await page.locator('[role=tab][aria-selected=true]').click(); await page.getByRole('menuitem', { name: 'ビューを削除' }).click(); await wait(600)
const tabsAfterDelete = await page.locator('[role=tab]').count()
await page.getByRole('button', { name: '元に戻す' }).click(); await wait(600)
ok((await page.locator('[role=tab]').count()) === tabsAfterDelete + 1, 'ビューを削除して「元に戻す」で戻る')

// 16. 繰り返し(Todoist の型)と複数選択(ラベル)
await page.goto(BASE + '/o/tasks?view=x'); await page.waitForSelector('[role=row][data-row]')
await page.keyboard.press('q'); await page.waitForSelector('dialog[open] input[aria-label=件名]')
await page.keyboard.type('週報を書く 毎週 p2'); await wait(150)
ok(await page.getByText('毎週繰り返します').count() === 1, '件名の「毎週」を繰り返しとして読む')
await page.keyboard.press('Enter'); await wait(800)
await page.locator('[role=row][data-row]').filter({ hasText: '週報を書く' }).locator('.task-check').click(); await wait(900)
await page.goto(BASE + '/o/tasks'); await page.waitForSelector('[role=row][data-row]')
const weekly = page.locator('[role=row][data-row]').filter({ hasText: '週報を書く' })
ok(await weekly.count() === 1, '完了すると、次回のタスクが自動でできる(未完了の一覧に 1 件)')
await weekly.first().locator('[role=cell]').first().click(); await page.waitForSelector('aside'); await wait(500)
const nextDue = await page.locator('aside input[type=date]').first().inputValue()
ok(nextDue > new Date().toISOString().slice(0, 10) && await page.locator('aside').getByRole('button', { name: /「週報を書く」を開く/ }).count() === 1, '次回は 1 週間後で、「前回」に完了した回がつながる', nextDue)
await page.locator('aside').getByRole('button', { name: /「週報を書く」を開く/ }).click(); await wait(500)
await page.locator('aside .task-check').first().click(); await wait(800)
await page.keyboard.press('Escape'); await wait(300)
ok(await page.locator('[role=row][data-row]').filter({ hasText: '週報を書く' }).count() === 1, '完了を戻すと、自動で作った次回が消える(残るのは戻した 1 件)')
await page.locator('[role=row][data-row]').filter({ hasText: '週報を書く' }).first().locator('[role=cell]').first().click(); await page.waitForSelector('aside'); await wait(400)
await page.locator('aside').getByRole('button', { name: 'ラベル' }).click(); await wait(200)
await page.getByRole('option', { name: '営業' }).click(); await page.getByRole('option', { name: '要連絡' }).click(); await page.keyboard.press('Escape'); await wait(400)
ok((await page.locator('aside').getByRole('button', { name: 'ラベル' }).innerText()).includes('要連絡'), '複数選択で 2 つのラベルを付けられる')
await page.keyboard.press('Escape'); await wait(200)
await page.getByRole('button', { name: 'フィルター(条件を足す)' }).click(); await page.getByRole('option', { name: 'ラベル' }).click(); await wait(300)
await page.getByRole('button', { name: '値' }).click(); await page.getByRole('option', { name: '営業' }).click(); await page.keyboard.press('Escape'); await wait(500)
ok(await page.locator('[data-filter-chip]').filter({ hasText: 'ラベル' }).count() === 1 && await rows() >= 1 && await page.locator('[role=row][data-row]').filter({ hasText: '週報を書く' }).count() === 1, '条件「ラベル のどれかを含む 営業」で絞れる', `${await rows()} 件`)
await page.locator('[data-filter-chip]').filter({ hasText: 'ラベル' }).getByRole('button', { name: /を外す/ }).click(); await wait(400)

// 17. 環境設定: サイドバーに出す・出さない、MCP のトークン、Web フォーム、管理者でない人は入れない
await page.goto(BASE + '/settings/tables'); await page.waitForSelector('[role=switch]')
ok(await page.locator('nav[aria-label=メイン] a[href="/o/activities"]').count() === 0, '活動は初めからサイドバーに出ない')
await page.getByRole('switch', { name: '「活動」をサイドバーに出す' }).click(); await wait(500)
ok(await page.locator('nav[aria-label=メイン] a[href="/o/activities"]').count() === 1, 'スイッチで活動をサイドバーに出せる')
await page.getByRole('switch', { name: '「活動」をサイドバーに出す' }).click(); await wait(500)
await page.getByRole('link', { name: 'MCP' }).click(); await page.waitForURL(/mcp/)
await page.getByRole('button', { name: 'トークンを発行' }).click(); await page.waitForSelector('dialog[open]')
await page.keyboard.type('E2E'); await page.getByRole('radio', { name: 'Claude Code' }).click(); await page.getByRole('button', { name: '発行する' }).click(); await wait(600)
const secret = await page.locator('code').filter({ hasText: /^wks_/ }).first().innerText()
ok(/^wks_[a-z0-9]{40}$/.test(secret) && (await page.locator('pre').innerText()).includes(secret), 'トークンを発行すると全文が 1 回見えて、繋ぎ方の設定に入る', secret.slice(0, 8))
await page.getByRole('button', { name: '「E2E」を失効' }).click(); await wait(500)
ok(await page.getByText('E2E', { exact: true }).count() === 0, 'トークンを失効できる')
await page.getByRole('link', { name: 'Web フォーム' }).click(); await page.waitForURL(/forms/)
await page.getByRole('button', { name: 'フォームを作る' }).first().click(); await page.waitForSelector('dialog[open]')
await page.keyboard.type('セミナー申し込み'); await page.getByLabel('テーブル', { exact: true }).selectOption('accounts')
await page.getByRole('switch', { name: '取引先名' }).click(); await page.getByRole('switch', { name: '電話' }).click()
await page.locator('dialog[open]').getByRole('button', { name: 'フォームを作る' }).click(); await wait(700)
const formCard = page.locator('article').filter({ hasText: 'セミナー申し込み' })
ok((await formCard.count()) === 1 && (await formCard.locator('pre').innerText()).includes('CF-Access-Client-Id'), 'フォームを作ると、受け口と、Access のサービストークン付きで送る例が出る')
await formCard.getByRole('tab', { name: 'ブラウザから直接送る HTML' }).click(); await wait(200)
ok((await formCard.locator('pre').innerText()).includes('name="phone"'), '埋め込み用の HTML も出る')
await formCard.getByRole('button', { name: 'テスト送信' }).click(); await wait(800)
ok(await page.getByText('取引先にレコードができました').count() === 1, 'テスト送信で、受け口からレコードができる')
await page.getByRole('button', { name: /Sanei Clover/ }).click(); await page.getByRole('button', { name: 'ログアウト' }).click(); await page.waitForURL(/\/login/)
await page.fill('#email', 'misaki@example.jp'); await page.fill('#password', 'x'); await page.click('button[type=submit]'); await page.waitForSelector('[role=table]')
await page.goto(BASE + '/settings/mcp'); await wait(600)
ok(!page.url().includes('/settings') && await page.locator('nav[aria-label=メイン]').getByText('環境設定').count() === 0, '管理者でない人は環境設定に入れない(サイドバーにも出ない)')

// 18. ログアウト
await page.getByRole('button', { name: /Sanei Clover/ }).click()
await page.getByRole('button', { name: 'ログアウト' }).click()
await page.waitForURL(/\/login/)
ok(true, 'ログアウトでログイン画面へ戻る')

if (errors.length) { console.log('\nブラウザのエラー:\n' + errors.join('\n')); failed++ }
console.log(failed ? `\n${failed} 件の失敗` : '\nすべて通過')
await browser.close()
process.exit(failed ? 1 : 0)
