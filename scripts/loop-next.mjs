#!/usr/bin/env node
// テストケース表(docs/tests/*.md)を読み、ループが次に取る 1 件を選ぶ。
// 設計は docs/runbook/02-loop.md。キューの定義は loops/<キュー名>/README.md。
//
//   node scripts/loop-next.mjs            次の 1 件を JSON で出す(無ければ {"id":null} と理由)
//   node scripts/loop-next.mjs --list     ループが取れる行・取れない行の内訳
//   node scripts/loop-next.mjs --prompt   次の 1 件について、エージェントへ渡す依頼文を出す
//   node scripts/loop-next.mjs --check    表と実在するテストの対応を検査する(verify.sh から回る。両方のキューを見る)
//   node scripts/loop-next.mjs --labels   E2E(frontend/e2e/smoke.mjs)の検査ラベルを一覧にする(表の「対応する資産」に書く文字)
//
// キューは --queue で選ぶ(既定は tests)。
//   tests … 表の 1 行に Vitest を書く(L1・L2)。資産の列は「対応する資産」
//   api   … 表の L2 の 1 行を**本物の HTTP API に向けて**確かめ、落ちたら backend を実装する。資産の列は「API の資産」
//
// 依存なし(node 標準だけ)。worktree の中でも本体でも、置かれたリポジトリのルートを基準に動く。
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// 本体のルート。worktree(.claude/worktrees/<名前>)から呼ばれても、着手中の判定は本体側の一覧で行う
const MAIN_ROOT = ROOT.includes(`${path.sep}.claude${path.sep}worktrees${path.sep}`)
  ? ROOT.slice(0, ROOT.indexOf(`${path.sep}.claude${path.sep}worktrees${path.sep}`))
  : ROOT

// 壊れたときの損失で決めた順(docs/tests/README.md §1)。ループもこの順に取る
const AREAS = ['meta', 'io', 'tasks', 'activities', 'records', 'settings']
const NONE = '—'
const E2E_FILE = 'frontend/e2e/smoke.mjs'

// キューの定義(loops/<名前>/README.md と同じ内容を、機械が読む形で)
const QUEUES = {
  // 無人で確かめられる行だけを取る。L1(lib の純関数)・L2(モックのエンジン)は Vitest で閉じる。
  // L3(実ブラウザの E2E)・L4(DB)・L5(公開 URL・実機)は開発サーバや Access が要るので、人と対話セッションの担当
  tests: { dir: 'loops/tests', asset: (r) => r.asset, canTake: (r) => r.layer === 'L1' || r.layer === 'L2', prefix: 'loop-' },
  // バックエンドを実装するキュー。L2(モックのエンジン = サーバの振る舞いの正)を HTTP に向けて流す
  api: { dir: 'loops/api', asset: (r) => r.apiAsset, canTake: (r) => r.layer === 'L2', prefix: 'loop-api-' },
}

function splitRow(line) {
  const cells = []
  let cur = ''
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\' && line[i + 1] === '|') {
      cur += '|'
      i++
      continue
    }
    if (line[i] === '|') {
      cells.push(cur.trim())
      cur = ''
      continue
    }
    cur += line[i]
  }
  cells.push(cur.trim())
  return cells.slice(1, -1)
}

function readRows() {
  const rows = []
  for (const area of AREAS) {
    const file = path.join(ROOT, 'docs/tests', `${area}.md`)
    if (!existsSync(file)) continue
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!/^\| [A-Z]+-\d+ \|/.test(line)) continue
      const c = splitRow(line)
      if (c.length < 7) continue
      rows.push({ id: c[0], area, viewpoint: c[1], stage: c[2], property: c[3], layer: c[4], case: c[5], asset: c[6], apiAsset: c[7] ?? NONE, table: `docs/tests/${area}.md` })
    }
  }
  return rows
}

/** loops/<キュー>/<ID>.md の「状態:」行。ファイルが無ければ未着手 */
function itemState(id, queue) {
  const file = path.join(ROOT, queue.dir, `${id}.md`)
  if (!existsSync(file)) return { state: '未着手', file: null, text: '' }
  const text = readFileSync(file, 'utf8')
  const m = text.match(/^- 状態:\s*(\S+?)(?:[(（:：]|\s|$)/m)
  return { state: m ? m[1] : '未着手', file: `${queue.dir}/${id}.md`, text }
}

/** 着手中 = その ID の worktree が本体に残っている(検証待ち・着地待ちを含む) */
function claimed(id, queue) {
  return existsSync(path.join(MAIN_ROOT, '.claude/worktrees', `${queue.prefix}${id.toLowerCase()}`))
}

function classify(rows, queue) {
  const out = { ready: [], claimed: [], held: [], outOfScope: [], done: 0 }
  for (const r of rows) {
    if (queue.asset(r) !== NONE) {
      out.done++
      continue
    }
    if (!queue.canTake(r)) {
      out.outOfScope.push(r)
      continue
    }
    const st = itemState(r.id, queue)
    if (st.state === '保留' || st.state === '取り下げ') {
      out.held.push({ ...r, note: st.state })
      continue
    }
    if (claimed(r.id, queue)) {
      out.claimed.push(r)
      continue
    }
    out.ready.push({ ...r, stateFile: st.file, history: st.text })
  }
  return out
}

function walk(dir, hit, acc = []) {
  if (!existsSync(dir)) return acc
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) walk(p, hit, acc)
    else if (hit(name)) acc.push(p)
  }
  return acc
}

/**
 * E2E の検査ラベル。smoke.mjs の ok(条件, 'ラベル', …) の 2 つめの引数を、引用符と括弧を数えて取り出す
 * (条件の中に引用符や括弧があっても壊れない)
 */
export function e2eLabels(source) {
  const labels = []
  let i = 0
  while ((i = source.indexOf('ok(', i)) !== -1) {
    // 直前が識別子の文字なら別の関数(例: notOk()
    if (i > 0 && /[\w$]/.test(source[i - 1])) {
      i += 3
      continue
    }
    let j = i + 3
    let depth = 0
    let quote = null
    let argIndex = 0
    let label = null
    while (j < source.length) {
      const ch = source[j]
      if (quote) {
        if (ch === '\\') j++
        else if (ch === quote) {
          quote = null
          if (argIndex === 1 && label === null) label = source.slice(labelStart, j)
        }
        j++
        continue
      }
      if (ch === "'" || ch === '"' || ch === '`') {
        quote = ch
        if (argIndex === 1 && label === null) var labelStart = j + 1
        j++
        continue
      }
      if (ch === '(' || ch === '[' || ch === '{') depth++
      else if (ch === ')' || ch === ']' || ch === '}') {
        if (depth === 0) break
        depth--
      } else if (ch === ',' && depth === 0) argIndex++
      j++
    }
    if (label !== null) labels.push(label)
    i = j
  }
  return labels
}

/** 「対応する資産」の中の smoke.mjs「…」。ラベルの中に「」が入れ子でもよい(対応する括弧を数える) */
export function assetLabels(asset) {
  const out = []
  let i = 0
  while ((i = asset.indexOf('smoke.mjs「', i)) !== -1) {
    let j = i + 'smoke.mjs「'.length
    let depth = 1
    while (j < asset.length && depth > 0) {
      if (asset[j] === '「') depth++
      else if (asset[j] === '」') depth--
      if (depth > 0) j++
    }
    out.push(asset.slice(i + 'smoke.mjs「'.length, j))
    i = j + 1
  }
  return out
}

function check(rows) {
  const errors = []
  const warnings = []
  const ids = new Map()
  for (const r of rows) {
    if (ids.has(r.id)) errors.push(`${r.id}: ID が重複している(${ids.get(r.id)} と ${r.table})`)
    ids.set(r.id, r.table)
  }

  // 単体テスト: 表が名指しする *.test.ts が実在するか。逆に、テストの中の ID が表に無ければ NG
  const testFiles = walk(path.join(ROOT, 'frontend/src'), (n) => /\.test\.tsx?$/.test(n))
  const testNames = new Set(testFiles.map((p) => path.basename(p)))
  // ファイルごとの「有効な it の ID」(it.skip / it.todo / xit は数えない)
  const idsIn = new Map(testFiles.map((f) => [path.basename(f), new Set([...readFileSync(f, 'utf8').matchAll(/(?<![\w.])(?:it|test)\(\s*['"`]([A-Z]+-\d+)\b/g)].map((m) => m[1]))]))
  for (const r of rows) {
    for (const m of r.asset.matchAll(/([\w.-]+\.test\.tsx?)/g)) {
      if (!testNames.has(m[1])) errors.push(`${r.id}: 表は ${m[1]} を指すが、frontend/src/ 配下に無い`)
      else if (!idsIn.get(m[1])?.has(r.id)) errors.push(`${r.id}: 表は ${m[1]} を指すが、その中に it('${r.id} …') が無い(skip / todo は数えない)`)
    }
  }
  for (const f of testFiles) {
    const text = readFileSync(f, 'utf8')
    for (const m of text.matchAll(/(?<![\w.])(?:it|test)\(\s*['"`]([A-Z]+-\d+)\b/g)) {
      const row = rows.find((r) => r.id === m[1])
      if (!row) errors.push(`${path.relative(ROOT, f)}: ${m[1]} の行が docs/tests に無い`)
      else if (!row.asset.includes(path.basename(f))) errors.push(`${m[1]}: ${path.basename(f)} にテストがあるのに、表の「対応する資産」に書かれていない(${row.table})`)
    }
  }

  // E2E: 表が名指しするラベルが smoke.mjs にあるか
  const e2e = existsSync(path.join(ROOT, E2E_FILE)) ? e2eLabels(readFileSync(path.join(ROOT, E2E_FILE), 'utf8')) : []
  for (const r of rows) {
    for (const label of assetLabels(r.asset)) {
      if (!e2e.includes(label)) errors.push(`${r.id}: 表は smoke.mjs「${label}」を指すが、そのラベルの検査が無い`)
    }
  }
  const referenced = new Set(rows.flatMap((r) => assetLabels(r.asset)))
  for (const label of e2e) if (!referenced.has(label)) warnings.push(`smoke.mjs「${label}」はどの行にも対応していない`)

  // API の資産: 表が名指しする pytest が実在し、その中に対応する関数(test_<ID>…)があるか
  const pyFiles = walk(path.join(ROOT, 'backend/tests'), (n) => /^test_.*\.py$/.test(n))
  const pyNames = new Set(pyFiles.map((p) => path.basename(p)))
  const pyIds = new Map(
    pyFiles.map((f) => [
      path.basename(f),
      new Set([...readFileSync(f, 'utf8').matchAll(/def\s+test_([A-Z]+)_(\d+)_/g)].map((m) => `${m[1]}-${m[2]}`)),
    ]),
  )
  for (const r of rows) {
    for (const m of r.apiAsset.matchAll(/([\w.-]+\.py)/g)) {
      if (!pyNames.has(m[1])) errors.push(`${r.id}: 表は ${m[1]} を指すが、backend/tests/ 配下に無い`)
      else if (!pyIds.get(m[1])?.has(r.id)) errors.push(`${r.id}: 表は ${m[1]} を指すが、その中に def test_${r.id.replace('-', '_')}_… が無い`)
    }
  }
  for (const f of pyFiles) {
    for (const m of readFileSync(f, 'utf8').matchAll(/def\s+test_([A-Z]+)_(\d+)_/g)) {
      const id = `${m[1]}-${m[2]}`
      const row = rows.find((r) => r.id === id)
      if (!row) errors.push(`${path.relative(ROOT, f)}: ${id} の行が docs/tests に無い`)
      else if (!row.apiAsset.includes(path.basename(f))) errors.push(`${id}: ${path.basename(f)} に検査があるのに、表の「API の資産」に書かれていない(${row.table})`)
    }
  }

  // 状態ファイル: 完了と書いてあるのに表が — のまま、を検出する(キューごとに)
  for (const queue of Object.values(QUEUES)) {
    const stDir = path.join(ROOT, queue.dir)
    if (!existsSync(stDir)) continue
    for (const f of readdirSync(stDir).filter((n) => /^[A-Z]+-\d+\.md$/.test(n))) {
      const id = f.replace(/\.md$/, '')
      const row = rows.find((r) => r.id === id)
      if (!row) {
        errors.push(`${queue.dir}/${f}: 対応する行が docs/tests に無い`)
        continue
      }
      if (itemState(id, queue).state === '完了' && queue.asset(row) === NONE) {
        errors.push(`${id}: ${queue.dir} の状態は完了だが、表の資産の列が — のまま`)
      }
    }
  }

  for (const w of warnings) console.log(`WARN ${w}`)
  for (const e of errors) console.log(`NG   ${e}`)
  console.log(`rows=${rows.length} unit-tests=${testFiles.length} api-tests=${pyFiles.length} e2e-labels=${e2e.length} warn=${warnings.length} ng=${errors.length}`)
  process.exit(errors.length ? 1 : 0)
}

function prompt(item, queue) {
  const history = item.history ? `\n## これまでの試行(同じ失敗を繰り返さないこと)\n\n${item.history.trim()}\n` : ''
  if (queue === QUEUES.api) return apiPrompt(item, history)
  return `あなたは無人ループの「書く役」です。次のテストケース 1 件だけを実装してください。
手順は docs/runbook/02-loop.md §4「書く役への指示」、キューの定義は loops/tests/README.md、
テストの書き方は docs/tests/README.md §3 にあります。見本は frontend/src/lib/filter.test.ts。

## 対象

- ID: ${item.id}(索引: ${item.table})
- 視点: ${item.viewpoint} / 段階: ${item.stage} / 性質: ${item.property} / 層: ${item.layer}
- ケース: ${item.case}
- テストの置き場: 対象ファイルの隣の *.test.ts(Vitest。frontend/ で \`npm test\`)。it の名前は「${item.id} …」で始める
${history}
## 変更してよいファイル

次の 3 つだけです。これ以外を変更すると不合格になります。

1. テストのファイル(frontend/src/**/*.test.ts)
2. ${item.table} の、この ID の行
3. loops/tests/${item.id}.md(記録)

製品のコード(テスト以外の frontend/src)は変更しないでください。

## 保留にする場合

次のどれかに当たるときは、テストを書かずに loops/tests/${item.id}.md の状態を「保留」にし、理由を書いてください。

- テストを通すには製品のコードを直す必要がある(製品の不具合です。直さないでください)
- ケースの文が曖昧、または定義(docs/design/)と食い違う
- この層では確かめられない

## 終わり方

索引の行の「対応する資産」にテストのファイル名(例 \`filter.test.ts\`)を入れ、loops/tests/${item.id}.md の状態を「完了(日付)」にして、
1 コミットにまとめてください(メッセージは \`test: ${item.id} …\`)。
push と着地はしないでください。検証と着地は呼び出し側が行います。
`
}

function apiPrompt(item, history) {
  return `あなたは無人ループの「書く役」です。次のテストケース 1 件を、**本物の HTTP API** に向けて確かめてください。
キューの定義は loops/api/README.md、契約は docs/design/04、バックエンドの地図は backend/README.md にあります。

## 対象

- ID: ${item.id}(索引: ${item.table})
- 視点: ${item.viewpoint} / 段階: ${item.stage} / 性質: ${item.property} / 層: ${item.layer}
- ケース: ${item.case}
- 検査の置き場: backend/tests/ の pytest。関数の名前は \`test_${item.id.replace('-', '_')}_…\`(表の ID で始める)
${history}
## 期待値の出どころ(食い違ったらこの順で正しい)

1. 上の「ケース」の文
2. 同じ ID の Vitest(frontend/src/mocks/*.test.ts。モックの振る舞いがサーバの正 — docs/design/03 §3)
3. 契約(docs/design/04、frontend/src/api/types.ts)

## 変更してよいファイル

次の 3 つだけです。これ以外を変更すると不合格になります。

1. backend/**(pytest と、それを通すための実装)
2. ${item.table} の、この ID の行(「API の資産」の列)
3. loops/api/${item.id}.md(記録)

**frontend/** と docs/design/** は変更しないでください**(契約を書き換えて通すのを防ぐため)。

## 進め方

1. pytest を 1 件書き、\`cd backend && uv run pytest -q\` で回す
2. 落ちたら backend/app/** を直す。**既存の検査が 1 件でも落ちたら不合格**です
3. 期待値をわざと変えて落ちることを見てから戻す(守りになっているか)
4. \`scripts/verify.sh\` が green になることを確かめる

## 保留にする場合

次のどれかに当たるときは、書かずに loops/api/${item.id}.md の状態を「保留」にし、理由を書いてください。

- その API がまだ無い(Google ドライブ = J-035 など)
- ケースの文が曖昧、または上の 3 つの出どころが食い違う
- 通すには契約(frontend/ や docs/design/)を直す必要がある

## 終わり方

索引の行の「API の資産」に pytest のファイル名(例 \`test_records_query.py\`)を入れ、
loops/api/${item.id}.md の状態を「完了(日付)」にして、1 コミットにまとめてください(メッセージは \`test: ${item.id} …\`)。
push と着地はしないでください。
`
}

const args = process.argv.slice(2)
const queueName = (() => {
  const i = args.indexOf('--queue')
  return i >= 0 ? args[i + 1] : 'tests'
})()
const queue = QUEUES[queueName]
if (!queue) {
  console.error(`知らないキューです: ${queueName}(${Object.keys(QUEUES).join(' / ')})`)
  process.exit(2)
}
const mode = args.find((a) => a.startsWith('--') && a !== '--queue' && !Object.keys(QUEUES).includes(a)) ?? ''
if (mode === '--labels') {
  for (const l of e2eLabels(readFileSync(path.join(ROOT, E2E_FILE), 'utf8'))) console.log(l)
  process.exit(0)
}
const rows = readRows()
if (mode === '--check') check(rows)

const c = classify(rows, queue)
if (mode === '--list') {
  const by = (list) =>
    Object.entries(list.reduce((a, r) => ((a[`${r.area}:${r.layer}`] = (a[`${r.area}:${r.layer}`] ?? 0) + 1), a), {}))
      .map(([k, v]) => `${k}=${v}`)
      .join(' ')
  console.log(`対応済み        ${c.done}`)
  console.log(`ループが取れる  ${c.ready.length}  ${by(c.ready)}`)
  console.log(`着手中          ${c.claimed.length}  ${c.claimed.map((r) => r.id).join(' ')}`)
  console.log(`保留・取り下げ  ${c.held.length}  ${c.held.map((r) => `${r.id}(${r.note})`).join(' ')}`)
  console.log(`ループの対象外  ${c.outOfScope.length}  ${by(c.outOfScope)}`)
  process.exit(0)
}

const next = c.ready[0] ?? null
if (mode === '--prompt') {
  if (!next) {
    console.error('取れる行がありません')
    process.exit(3)
  }
  process.stdout.write(prompt(next, queue))
  process.exit(0)
}
if (!next) {
  console.log(JSON.stringify({ id: null, reason: 'ループが取れる行が無い', held: c.held.map((r) => r.id), claimed: c.claimed.map((r) => r.id) }))
  process.exit(0)
}
const { history: _h, ...pub } = next
console.log(JSON.stringify(pub))
