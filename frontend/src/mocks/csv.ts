/**
 * CSV の書き出しと取り込み。どちらも「サーバがやるはずの処理」: 見出しと項目の対応付け、
 * 文字から値への変換(選択肢はラベル、参照は表示名から引く)、検証は画面に持たせない。
 */
import type { FieldMeta, ImportParams, ImportResponse, ListParams, ObjectMeta, Row, Scalar } from '@/api/types'
import { parseDriveFiles } from '@/lib/drive'
import { plainText } from '@/lib/richtext'
import { displayValue, insert, normalizeText, objectMeta, query, refOf, table, users } from './engine'

// --- CSV の読み書き ------------------------------------------------------------

/** RFC 4180 相当。引用符の中の改行と "" を扱う。区切りはカンマ(タブ区切りの貼り付けも受ける) */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const delimiter = !src.split('\n', 1)[0].includes(',') && src.includes('\t') ? '\t' : ','
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"' && cell === '') quoted = true
    else if (ch === delimiter) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

function toCsv(rows: string[][]): string {
  const escape = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  return rows.map((r) => r.map(escape).join(',')).join('\r\n') + '\r\n'
}

// --- 書き出し -----------------------------------------------------------------

function exportValue(meta: ObjectMeta, field: FieldMeta, row: Row): string {
  if (field.type === 'polymorphic' && field.columns) {
    const object = row[field.columns.object]
    const id = row[field.columns.id]
    return typeof object === 'string' && typeof id === 'string' ? (refOf(object, id)?.name ?? '') : ''
  }
  if (field.type === 'checkbox') return row[field.key] ? 'はい' : ''
  if (field.type === 'richtext') return typeof row[field.key] === 'string' ? plainText(String(row[field.key])) : ''
  if (field.type === 'drive_files') return parseDriveFiles(row[field.key]).map((f) => `${f.name} ${f.url}`).join('\n')
  return displayValue(meta, row, field.key) ?? ''
}

export function exportCsv(object: string, params: ListParams, me: string | null): Blob {
  const meta = objectMeta(object)
  const { records } = query(object, { ...params, limit: undefined, offset: undefined }, me)
  const lines = [meta.fields.map((f) => f.label), ...records.map((row) => meta.fields.map((f) => exportValue(meta, f, row)))]
  // 先頭の BOM は、Excel が UTF-8 として開くための印
  return new Blob(['﻿' + toCsv(lines)], { type: 'text/csv;charset=utf-8' })
}

// --- 取り込み -----------------------------------------------------------------

const importable = (meta: ObjectMeta) => meta.fields.filter((f) => !f.readonly && f.type !== 'polymorphic' && f.type !== 'drive_files')

function guessField(meta: ObjectMeta, header: string): string | null {
  const h = normalizeText(header)
  return importable(meta).find((f) => normalizeText(f.label) === h || f.key === header.trim().toLowerCase())?.key ?? null
}

const TRUE_WORDS = new Set(['true', '1', 'yes', 'y', 'はい', '○', '〇', '✓', 'on'])

/** 文字を項目の型の値にする。直せなければ理由を投げる。取り込みと Web フォーム(form-urlencoded)の両方が使う */
export function coerce(field: FieldMeta, raw: string): Scalar {
  const text = raw.trim()
  if (text === '') return null
  switch (field.type) {
    case 'number':
    case 'currency':
    case 'percent': {
      const n = Number(text.normalize('NFKC').replace(/[¥,\s%円]/g, ''))
      if (!Number.isFinite(n)) throw new Error(`${field.label}「${text}」は数値ではありません`)
      return n
    }
    case 'date':
    case 'datetime': {
      const m = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(.*)$/.exec(text.normalize('NFKC'))
      if (!m) throw new Error(`${field.label}「${text}」は日付として読めません`)
      const date = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
      if (field.type === 'date') return date
      const at = new Date(`${date}T${/\d{1,2}:\d{2}/.exec(m[4])?.[0].padStart(5, '0') ?? '00:00'}:00`)
      return Number.isNaN(at.getTime()) ? null : at.toISOString()
    }
    case 'checkbox':
      return TRUE_WORDS.has(text.toLowerCase())
    case 'multi_select': {
      // 「営業、事務」のように区切って書く
      const values = text.split(/[、,;/]/).map((t) => t.trim()).filter(Boolean).map((t) => {
        const option = field.options?.find((o) => o.label === t || o.value === t)
        if (!option) throw new Error(`${field.label}に「${t}」という選択肢はありません`)
        return option.value
      })
      return values.length ? JSON.stringify([...new Set(values)]) : null
    }
    case 'select': {
      const option = field.options?.find((o) => o.label === text || o.value === text)
      if (!option) throw new Error(`${field.label}に「${text}」という選択肢はありません`)
      return option.value
    }
    case 'user': {
      const user = users.find((u) => u.name === text || u.email === text.toLowerCase())
      if (!user) throw new Error(`${field.label}「${text}」という利用者はいません`)
      return user.id
    }
    case 'relation': {
      if (!field.target) return null
      const target = objectMeta(field.target)
      // UUID ならそのまま(移行や再実行で、名前でなく ID で指せる)
      if (/^[0-9a-f-]{36}$/.test(text) && table(field.target).some((r) => r.id === text)) return text
      const needle = normalizeText(text)
      const hits = table(field.target).filter((r) => normalizeText(String(r[target.name_field] ?? '')) === needle)
      if (hits.length === 0) throw new Error(`${target.label}「${text}」が見つかりません`)
      // 同名が複数なら黙って選ばない(同姓同名の責任者を誤って結ぶより、行を止めて ID で指してもらう)
      if (hits.length > 1) throw new Error(`${target.label}「${text}」が ${hits.length} 件あります。ID で指定してください`)
      return hits[0].id
    }
    case 'richtext':
      // 素の文字を段落にする(改行は段落の区切り)
      return text
        .split(/\r?\n/)
        .map((line) => `<p>${line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`)
        .join('')
    default:
      return text
  }
}

export function importCsv(object: string, params: ImportParams, me: string | null): ImportResponse {
  const meta = objectMeta(object)
  const [headers = [], ...lines] = parseCsv(params.csv)
  const fields = importable(meta)
  const mapping: Record<string, string | null> = {}
  for (const header of headers) {
    const chosen = params.mapping && header in params.mapping ? params.mapping[header] : guessField(meta, header)
    // 同じ項目へ 2 つの列を当てない(先に出た列が勝つ)
    mapping[header] = chosen && fields.some((f) => f.key === chosen) && !Object.values(mapping).includes(chosen) ? chosen : null
  }

  const errors: ImportResponse['errors'] = []
  const accepted: Record<string, Scalar>[] = []
  lines.forEach((cells, i) => {
    try {
      const values: Record<string, Scalar> = {}
      headers.forEach((header, col) => {
        const field = fields.find((f) => f.key === mapping[header])
        if (field) values[field.key] = coerce(field, cells[col] ?? '')
      })
      for (const f of fields) {
        const empty = values[f.key] === null || values[f.key] === undefined
        // 必須の選択肢と担当は、作成時にサーバが既定値を入れるので空でよい
        if (f.required && empty && f.type !== 'select' && f.type !== 'checkbox') throw new Error(`${f.label}が空です`)
        if (f.max_length && typeof values[f.key] === 'string' && [...String(values[f.key])].length > f.max_length) {
          throw new Error(`${f.label}が ${f.max_length} 文字を超えています`)
        }
      }
      for (const key of Object.keys(values)) if (values[key] === null) delete values[key]
      accepted.push(values)
    } catch (e) {
      errors.push({ line: i + 2, message: e instanceof Error ? e.message : String(e) })
    }
  })

  const created_ids: string[] = []
  if (!params.dry_run) {
    // 一覧の並び(新しいものが上)が CSV の並びと揃うよう、後ろから入れる
    for (const values of [...accepted].reverse()) created_ids.unshift(insert(object, values, me).record.id)
  }
  return { headers, mapping, total: lines.length, valid: accepted.length, errors: errors.slice(0, 20), sample: lines.slice(0, 5), created_ids }
}
