#!/usr/bin/env node
// テストケース表(docs/tests/*.md)を読み、ループが次に書くテストを 1 件選ぶ。
// 設計は docs/runbook/02-loop.md。キューの定義は loops/tests/README.md。
//
//   node scripts/loop-next.mjs            次の 1 件を JSON で出す(無ければ {"id":null} と理由)
//   node scripts/loop-next.mjs --list     ループが取れる行・取れない行の内訳
//   node scripts/loop-next.mjs --prompt   次の 1 件について、エージェントへ渡す依頼文を出す
//   node scripts/loop-next.mjs --check    表と実在するテスト(Vitest の *.test.ts、E2E の検査ラベル)の対応を検査する(verify.sh から回る)
//   node scripts/loop-next.mjs --labels   E2E(frontend/e2e/smoke.mjs)の検査ラベルを一覧にする(表の「対応する資産」に書く文字)
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
// 無人で確かめられる行だけを取る。L1(lib の純関数)・L2(モックのエンジン)は Vitest で閉じる。
// L3(実ブラウザの E2E)・L4(DB)・L5(公開 URL・実機)は開発サーバや Access が要るので、人と対話セッションの担当
const loopCanTake = (r) => r.layer === 'L1' || r.layer === 'L2'
const NONE = '—'
const E2E_FILE = 'frontend/e2e/smoke.mjs'

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
      rows.push({ id: c[0], area, viewpoint: c[1], stage: c[2], property: c[3], layer: c[4], case: c[5], asset: c[6], table: `docs/tests/${area}.md` })
    }
  }
  return rows
}

/** loops/tests/<ID>.md の「状態:」行。ファイルが無ければ未着手 */
function itemState(id) {
  const file = path.join(ROOT, 'loops/tests', `${id}.md`)
  if (!existsSync(file)) return { state: '未着手', file: null, text: '' }
  const text = readFileSync(file, 'utf8')
  const m = text.match(/^- 状態:\s*(\S+?)(?:[(（:：]|\s|$)/m)
  return { state: m ? m[1] : '未着手', file: `loops/tests/${id}.md`, text }
}

/** 着手中 = その ID の worktree が本体に残っている(検証待ち・着地待ちを含む) */
function claimed(id) {
  return existsSync(path.join(MAIN_ROOT, '.claude/worktrees', `loop-${id.toLowerCase()}`))
}

function classify(rows) {
  const out = { ready: [], claimed: [], held: [], outOfScope: [], done: 0 }
  for (const r of rows) {
    if (r.asset !== NONE) {
      out.done++
      continue
    }
    if (!loopCanTake(r)) {
      out.outOfScope.push(r)
      continue
    }
    const st = itemState(r.id)
    if (st.state === '保留' || st.state === '取り下げ') {
      out.held.push({ ...r, note: st.state })
      continue
    }
    if (claimed(r.id)) {
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

  // 状態ファイル: 完了と書いてあるのに表が — のまま、を検出する
  const stDir = path.join(ROOT, 'loops/tests')
  if (existsSync(stDir)) {
    for (const f of readdirSync(stDir).filter((n) => /^[A-Z]+-\d+\.md$/.test(n))) {
      const id = f.replace(/\.md$/, '')
      const row = rows.find((r) => r.id === id)
      if (!row) {
        errors.push(`loops/tests/${f}: 対応する行が docs/tests に無い`)
        continue
      }
      if (itemState(id).state === '完了' && row.asset === NONE) errors.push(`${id}: 状態は完了だが、表の「対応する資産」が — のまま`)
    }
  }

  for (const w of warnings) console.log(`WARN ${w}`)
  for (const e of errors) console.log(`NG   ${e}`)
  console.log(`rows=${rows.length} unit-tests=${testFiles.length} e2e-labels=${e2e.length} warn=${warnings.length} ng=${errors.length}`)
  process.exit(errors.length ? 1 : 0)
}

function prompt(item) {
  const history = item.history ? `\n## これまでの試行(同じ失敗を繰り返さないこと)\n\n${item.history.trim()}\n` : ''
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

const mode = process.argv[2] ?? ''
if (mode === '--labels') {
  for (const l of e2eLabels(readFileSync(path.join(ROOT, E2E_FILE), 'utf8'))) console.log(l)
  process.exit(0)
}
const rows = readRows()
if (mode === '--check') check(rows)

const c = classify(rows)
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
  process.stdout.write(prompt(next))
  process.exit(0)
}
if (!next) {
  console.log(JSON.stringify({ id: null, reason: 'ループが取れる行が無い', held: c.held.map((r) => r.id), claimed: c.claimed.map((r) => r.id) }))
  process.exit(0)
}
const { history: _h, ...pub } = next
console.log(JSON.stringify(pub))
