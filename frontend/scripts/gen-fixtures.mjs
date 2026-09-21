#!/usr/bin/env node
/**
 * モック用のレコード(DB の行と同じ形の JSON)を生成する。
 *   node scripts/gen-fixtures.mjs
 * 出力先は src/mocks/fixtures/。登場する会社・人物はすべて架空。
 * 日付は BASE_DATE を基準に作り、モック側が読み込み時に「今日」へずらす(mocks/engine.ts)。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../src/mocks/fixtures')
const BASE_DATE = '2026-09-21'

// --- 小道具 -----------------------------------------------------------------
const uuid = (ns, n) => `${ns}000000-0000-7000-8000-${String(n).padStart(12, '0')}`
const base = new Date(`${BASE_DATE}T00:00:00+09:00`)
const pad = (n) => String(n).padStart(2, '0')
const day = (offset) => {
  const d = new Date(base.getTime() + offset * 86400000)
  // JST の日付として出す
  const j = new Date(d.getTime() + 9 * 3600000)
  return `${j.getUTCFullYear()}-${pad(j.getUTCMonth() + 1)}-${pad(j.getUTCDate())}`
}
const at = (offset, hour, minute) => new Date(base.getTime() + offset * 86400000 + hour * 3600000 + minute * 60000).toISOString()
let seed = 20260921
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296)
const between = (a, b) => a + Math.floor(rnd() * (b - a + 1))

const U1 = uuid('09', 1)
const U2 = uuid('09', 2)

// --- ユーザーとワークスペース ---------------------------------------------------
const users = [
  { id: U1, name: 'Takuya', email: 'takuya@example.jp', avatar_color: 'green' },
  { id: U2, name: 'Misaki', email: 'misaki@example.jp', avatar_color: 'violet' },
]
const workspace = { id: uuid('08', 1), name: 'Sanei Clover' }

// --- 取引先 -----------------------------------------------------------------
// [名前, フリガナ, 種別, 業種, 都道府県, 住所, 市外局番, 従業員数, ドメイン, 担当, 作成からの日数, メモ]
const A = [
  ['株式会社アオバ精機', 'アオバセイキ', 'customer', 'manufacturing', '神奈川県', '横浜市港北区新横浜 0-0-0', '045', 320, 'aoba-seiki', U1, 410, '検査装置の保守契約あり。年次更新は 3 月。'],
  ['北浜ロジスティクス株式会社', 'キタハマロジスティクス', 'customer', 'logistics', '大阪府', '大阪市中央区北浜 0-0-0', '06', 540, 'kitahama-logi', U1, 380, '配車と倉庫の 2 系統で取引。情シスの大西課長が推進役。'],
  ['みなと総合設計株式会社', 'ミナトソウゴウセッケイ', 'prospect', 'construction', '東京都', '港区芝 0-0-0', '03', 85, 'minato-sekkei', U1, 34, null],
  ['株式会社ハルカゼソフト', 'ハルカゼソフト', 'partner', 'it', '東京都', '渋谷区神南 0-0-0', '03', 42, 'harukaze-soft', U1, 290, '開発の協業先。予約系に強い。'],
  ['つばめ食品株式会社', 'ツバメショクヒン', 'customer', 'manufacturing', '新潟県', '燕市吉田 0-0-0', '0256', 210, 'tsubame-foods', U1, 520, null],
  ['医療法人社団あさぎ会', 'アサギカイ', 'prospect', 'medical', '埼玉県', 'さいたま市浦和区 0-0-0', '048', 460, 'asagikai', U2, 21, '展示会で名刺交換。訪問看護の記録が紙のまま。'],
  ['学校法人こもれび学園', 'コモレビガクエン', 'customer', 'education', '千葉県', '柏市若葉 0-0-0', '04', 130, 'komorebi-gakuen', U1, 610, null],
  ['株式会社ミドリノ不動産', 'ミドリノフドウサン', 'prospect', 'construction', '東京都', '世田谷区三軒茶屋 0-0-0', '03', 38, 'midorino-re', U1, 48, null],
  ['東雲フィナンシャル株式会社', 'シノノメフィナンシャル', 'prospect', 'finance', '東京都', '千代田区大手町 0-0-0', '03', 1200, 'shinonome-fin', U1, 19, 'デジタル推進室が窓口。稟議に時間がかかる。'],
  ['株式会社ナナホシ堂', 'ナナホシドウ', 'customer', 'retail', '愛知県', '名古屋市中区栄 0-0-0', '052', 95, 'nanahoshido', U1, 450, null],
  ['合同会社ひだまりワークス', 'ヒダマリワークス', 'partner', 'service', '福岡県', '福岡市中央区大名 0-0-0', '092', 6, 'hidamari-works', U1, 330, 'デザインの外注先。'],
  ['株式会社ソラマメ企画', 'ソラマメキカク', 'customer', 'service', '東京都', '目黒区中目黒 0-0-0', '03', 24, 'soramame-kikaku', U2, 200, null],
  ['白波マリンサービス株式会社', 'シラナミマリンサービス', 'prospect', 'logistics', '兵庫県', '神戸市中央区海岸通 0-0-0', '078', 160, 'shiranami-marine', U1, 6, null],
  ['株式会社カササギ電機', 'カササギデンキ', 'customer', 'manufacturing', '大阪府', '東大阪市高井田 0-0-0', '06', 680, 'kasasagi-denki', U1, 700, '最大の取引先。情シス・購買・製造の 3 部門と接点。'],
  ['一般社団法人みらい地域振興会', 'ミライチイキシンコウカイ', 'other', 'public', '長野県', '松本市大手 0-0-0', '0263', 18, 'mirai-chiiki', U2, 480, null],
  ['株式会社トキワ印刷', 'トキワインサツ', 'customer', 'manufacturing', '東京都', '板橋区志村 0-0-0', '03', 74, 'tokiwa-print', U1, 260, null],
  ['やまぶき税理士法人', 'ヤマブキゼイリシホウジン', 'partner', 'service', '東京都', '新宿区西新宿 0-0-0', '03', 30, 'yamabuki-tax', U1, 540, '顧問税理士。顧客の紹介元でもある。'],
  ['株式会社コトノハ出版', 'コトノハシュッパン', 'prospect', 'retail', '京都府', '京都市中京区烏丸 0-0-0', '075', 28, 'kotonoha-pub', U2, 27, null],
  ['株式会社リンドウシステムズ', 'リンドウシステムズ', 'partner', 'it', '神奈川県', '川崎市幸区 0-0-0', '044', 55, 'rindou-sys', U1, 310, null],
  ['有限会社さざなみ工房', 'サザナミコウボウ', 'other', 'manufacturing', '静岡県', '浜松市中央区 0-0-0', '053', 9, 'sazanami-kobo', U1, 650, null],
  ['株式会社アカツキ運輸', 'アカツキウンユ', 'prospect', 'logistics', '埼玉県', '川口市領家 0-0-0', '048', 240, 'akatsuki-unyu', U1, 40, 'やまぶき税理士法人からの紹介。'],
  ['株式会社ツキノワフーズ', 'ツキノワフーズ', 'customer', 'retail', '北海道', '札幌市中央区大通 0-0-0', '011', 150, 'tsukinowa-foods', U2, 230, null],
  ['花笠観光株式会社', 'ハナガサカンコウ', 'prospect', 'service', '山形県', '山形市七日町 0-0-0', '023', 66, 'hanagasa-kanko', U2, 30, null],
  ['株式会社シロツメ情報サービス', 'シロツメジョウホウサービス', 'customer', 'it', '東京都', '品川区大崎 0-0-0', '03', 110, 'shirotsume-info', U1, 150, '自治体案件の共同提案を進行中。'],
]

const accounts = A.map(([name, kana, type, industry, prefecture, address, area, employees, domain, owner, created, description], i) => ({
  id: uuid('01', i + 1),
  name,
  name_kana: kana,
  type,
  industry,
  phone: `${area}-0000-${String(1200 + i * 7).padStart(4, '0')}`,
  website: `https://${domain}.example.jp`,
  prefecture,
  address: `${prefecture}${address}`,
  employees,
  owner_id: owner,
  description,
  created_at: at(-created, between(9, 18), between(0, 59)),
  updated_at: at(-between(0, Math.min(created, 45)), between(9, 19), between(0, 59)),
}))
const accountDomain = (i) => A[i][8]

// --- 取引先責任者 --------------------------------------------------------------
// [氏名, フリガナ, 取引先の番号(1 始まり。null は所属なし), 部署, 役職, 役割, 関係, 最終接触からの日数, メールのローカル部]
const C = [
  ['佐伯 誠一', 'サエキ セイイチ', 1, '生産技術部', '部長', 'decision_maker', 'active', 3, 's.saeki'],
  ['三浦 彩花', 'ミウラ アヤカ', 1, '生産技術部', '主任', 'liaison', 'active', 1, 'a.miura'],
  ['大西 浩二', 'オオニシ コウジ', 2, '情報システム部', '課長', 'champion', 'active', 6, 'k.onishi'],
  ['堀 真由美', 'ホリ マユミ', 2, '経理部', '係長', 'accounting', 'nurturing', 40, 'm.hori'],
  ['岡本 直樹', 'オカモト ナオキ', 3, '設計部', '取締役 設計部長', 'decision_maker', 'new', 12, 'n.okamoto'],
  ['早川 翔', 'ハヤカワ ショウ', 4, null, '代表取締役', 'decision_maker', 'active', 8, 's.hayakawa'],
  ['西村 千尋', 'ニシムラ チヒロ', 4, '開発部', 'エンジニア', 'technical', 'active', 8, 'c.nishimura'],
  ['長谷川 稔', 'ハセガワ ミノル', 5, '総務部', '部長', 'decision_maker', 'nurturing', 35, 'm.hasegawa'],
  ['小池 里奈', 'コイケ リナ', 5, '総務部', null, 'liaison', 'active', 5, 'r.koike'],
  ['藤井 康弘', 'フジイ ヤスヒロ', 6, '事務局', '事務長', 'decision_maker', 'new', 15, 'y.fujii'],
  ['野口 あかね', 'ノグチ アカネ', 6, '医療情報課', '主任', 'technical', 'new', 15, 'a.noguchi'],
  ['村上 由紀子', 'ムラカミ ユキコ', 7, '法人本部', '事務局長', 'decision_maker', 'active', 10, 'y.murakami'],
  ['緑川 大輔', 'ミドリカワ ダイスケ', 8, '営業企画部', 'マネージャー', 'champion', 'active', 2, 'd.midorikawa'],
  ['東 雅人', 'アズマ マサト', 9, 'デジタル推進室', '室長', 'decision_maker', 'new', 20, 'm.azuma'],
  ['片山 瑞希', 'カタヤマ ミズキ', 9, 'デジタル推進室', null, 'liaison', 'active', 4, 'm.katayama'],
  ['星野 七海', 'ホシノ ナナミ', 10, 'EC 事業部', '部長', 'champion', 'active', 7, 'n.hoshino'],
  ['日向 陽介', 'ヒナタ ヨウスケ', 11, null, '代表', 'decision_maker', 'nurturing', 50, 'y.hinata'],
  ['空閑 真理', 'クガ マリ', 12, '制作部', 'ディレクター', 'liaison', 'active', 9, 'm.kuga'],
  ['波多野 剛', 'ハタノ ツヨシ', 13, '運航管理部', '部長', 'decision_maker', 'new', null, 't.hatano'],
  ['鵜飼 達也', 'ウカイ タツヤ', 14, '情報システム部', '部長', 'decision_maker', 'active', 11, 't.ukai'],
  ['柴田 絵美', 'シバタ エミ', 14, '情報システム部', null, 'technical', 'active', 11, 'e.shibata'],
  ['金子 正', 'カネコ タダシ', 14, '購買部', '課長', 'accounting', 'nurturing', 64, 't.kaneko'],
  ['百瀬 和也', 'モモセ カズヤ', 15, '事務局', '事務局長', 'liaison', 'dormant', 180, 'k.momose'],
  ['常盤 信也', 'トキワ シンヤ', 16, null, '専務取締役', 'decision_maker', 'active', 14, 's.tokiwa'],
  ['山吹 静香', 'ヤマブキ シズカ', 17, null, '代表社員 税理士', 'other', 'nurturing', 28, 's.yamabuki'],
  ['桐山 葉子', 'キリヤマ ヨウコ', 18, '編集部', '編集長', 'champion', 'new', 18, 'y.kiriyama'],
  ['近藤 竜也', 'コンドウ タツヤ', 19, '営業部', '部長', 'liaison', 'active', 5, 't.kondo'],
  ['浜田 渚', 'ハマダ ナギサ', 20, null, '代表', 'decision_maker', 'dormant', 210, 'n.hamada'],
  ['赤木 勝', 'アカギ マサル', 21, '管理部', '部長', 'decision_maker', 'new', 22, 'm.akagi'],
  ['関 美穂', 'セキ ミホ', 21, '管理部', '主任', 'liaison', 'active', 6, 'm.seki'],
  ['熊谷 拓海', 'クマガイ タクミ', 22, '店舗運営部', 'マネージャー', 'champion', 'active', 13, 't.kumagai'],
  ['笠原 美和', 'カサハラ ミワ', 23, '企画課', '課長', 'liaison', 'new', 25, 'm.kasahara'],
  ['白石 健吾', 'シライシ ケンゴ', 24, 'ソリューション部', '部長', 'decision_maker', 'active', 2, 'k.shiraishi'],
  ['津田 沙織', 'ツダ サオリ', 24, 'ソリューション部', 'リーダー', 'technical', 'active', 2, 's.tsuda'],
  ['恩田 修', 'オンダ オサム', null, null, null, 'other', 'nurturing', 45, null],
]

const contacts = C.map(([name, kana, acc, department, title, role, status, last, local], i) => {
  const created = acc ? Math.max(5, Math.round(A[acc - 1][10] * (0.4 + rnd() * 0.5))) : 400
  return {
    id: uuid('02', i + 1),
    name,
    name_kana: kana,
    account_id: acc ? uuid('01', acc) : null,
    department,
    title,
    email: local && acc ? `${local}@${accountDomain(acc - 1)}.example.jp` : null,
    phone: `090-0000-${String(3100 + i * 13).padStart(4, '0')}`,
    role,
    status,
    last_contacted_on: last === null ? null : day(-last),
    owner_id: acc ? A[acc - 1][9] : U1,
    description: acc ? null : '前職の上司。年に数回、相談に乗ってもらう。',
    created_at: at(-created, between(9, 18), between(0, 59)),
    updated_at: at(-(last ?? between(1, 30)), between(9, 19), between(0, 59)),
  }
})
const contactByName = (name) => {
  const i = C.findIndex((c) => c[0] === name)
  if (i < 0) throw new Error(`取引先責任者が無い: ${name}`)
  return uuid('02', i + 1)
}

// --- 商談 -------------------------------------------------------------------
const STAGE_PROB = { lead: 10, hearing: 25, proposal: 50, quote: 70, negotiation: 85, won: 100, lost: 0 }
// [商談名, 取引先の番号, 取引先責任者, フェーズ, 金額, 完了予定日(今日からの日数), 種別, きっかけ, 次の一手, 作成からの日数]
const O = [
  ['検査データ収集システム 第 2 期', 1, '佐伯 誠一', 'proposal', 8400000, 45, 'expansion', 'existing', '9 月末に概算見積を提示', 38],
  ['保守契約 2027 年度更新', 1, '三浦 彩花', 'lead', 1800000, 150, 'renewal', 'existing', null, 12],
  ['配車管理のクラウド移行', 2, '大西 浩二', 'negotiation', 12500000, 20, 'expansion', 'existing', '契約書ドラフトの法務確認待ち', 95],
  ['倉庫ハンディ端末アプリ', 2, '大西 浩二', 'won', 4200000, -12, 'expansion', 'existing', null, 140],
  ['図面管理システム導入', 3, '岡本 直樹', 'hearing', 6000000, 75, 'new', 'web', '現行の運用フローをヒアリング', 30],
  ['共同開発: 予約管理 SaaS', 4, '早川 翔', 'proposal', 3500000, 60, 'new', 'referral', '契約形態を相談', 52],
  ['受発注 EDI 連携', 5, '小池 里奈', 'quote', 5600000, 30, 'expansion', 'existing', '見積 3 案を送付済み。返答待ち', 66],
  ['工場 Wi-Fi 更改', 5, '長谷川 稔', 'lost', 2300000, -40, 'expansion', 'existing', null, 120],
  ['訪問看護の記録アプリ', 6, '藤井 康弘', 'hearing', 9800000, 110, 'new', 'event', '現場見学の日程を決める', 20],
  ['出欠・連絡アプリ 追加開発', 7, '村上 由紀子', 'quote', 2900000, 25, 'expansion', 'existing', '理事会の承認待ち', 44],
  ['校務サーバー保守', 7, '村上 由紀子', 'won', 1200000, -5, 'renewal', 'existing', null, 60],
  ['物件管理と内見予約のシステム化', 8, '緑川 大輔', 'proposal', 7200000, 50, 'new', 'referral', 'デモ環境を用意して 10 月第 1 週に再訪', 45],
  ['営業支援ダッシュボード PoC', 9, '片山 瑞希', 'hearing', 4500000, 90, 'new', 'event', 'PoC の成功条件を決める', 18],
  ['社内問い合わせ AI ボット', 9, '東 雅人', 'lead', 15000000, 140, 'new', 'event', null, 9],
  ['EC サイトリニューアル', 10, '星野 七海', 'negotiation', 6800000, 14, 'expansion', 'existing', '最終見積の値引き幅を相談中', 88],
  ['会員アプリ保守', 10, '星野 七海', 'won', 960000, -20, 'renewal', 'existing', null, 70],
  ['案件管理ツールのカスタマイズ', 12, '空閑 真理', 'won', 1500000, -3, 'expansion', 'existing', null, 55],
  ['運航スケジュール管理', 13, '波多野 剛', 'lead', 5000000, 120, 'new', 'web', '初回の打ち合わせを設定', 6],
  ['生産実績の見える化', 14, '鵜飼 達也', 'quote', 18000000, 40, 'expansion', 'existing', '役員会の承認が 10 月中旬', 110],
  ['購買ワークフロー改修', 14, '金子 正', 'proposal', 3200000, 65, 'expansion', 'existing', null, 35],
  ['基幹連携バッチの刷新', 14, '柴田 絵美', 'lost', 7500000, -70, 'expansion', 'existing', null, 190],
  ['Web 入稿システム', 16, '常盤 信也', 'hearing', 4000000, 80, 'new', 'referral', '競合サービスを調べて比較表にする', 25],
  ['書誌データベース整備', 18, '桐山 葉子', 'lead', 2400000, 100, 'new', 'web', null, 22],
  ['点呼・日報のデジタル化', 21, '赤木 勝', 'proposal', 5400000, 55, 'new', 'referral', 'デモ動画を送る', 33],
  ['店舗シフト管理アプリ', 22, '熊谷 拓海', 'quote', 3800000, 18, 'expansion', 'existing', '見積の根拠をまとめて再提示', 58],
  ['ツアー予約サイト刷新', 23, '笠原 美和', 'hearing', 6500000, 95, 'new', 'web', '現行サイトのアクセス解析をもらう', 26],
  ['共同提案: 自治体向けポータル', 24, '白石 健吾', 'negotiation', 22000000, 35, 'new', 'referral', '役割分担と粗利配分を詰める', 75],
  ['運用監視の委託', 24, '津田 沙織', 'won', 2400000, -35, 'expansion', 'existing', null, 130],
]

const opportunities = O.map(([name, acc, contact, stage, amount, close, type, source, next, created], i) => ({
  id: uuid('03', i + 1),
  name,
  account_id: uuid('01', acc),
  primary_contact_id: contactByName(contact),
  stage,
  amount,
  probability: STAGE_PROB[stage],
  close_date: day(close),
  type,
  lead_source: source,
  next_step: next,
  owner_id: A[acc - 1][9],
  description: null,
  created_at: at(-created, between(9, 18), between(0, 59)),
  updated_at: at(-between(0, Math.min(created, 14)), between(9, 19), between(0, 59)),
}))
const oppByName = (name) => {
  const i = O.findIndex((o) => o[0] === name)
  if (i < 0) throw new Error(`商談が無い: ${name}`)
  return uuid('03', i + 1)
}
const accByName = (name) => {
  const i = A.findIndex((a) => a[0].includes(name))
  if (i < 0) throw new Error(`取引先が無い: ${name}`)
  return uuid('01', i + 1)
}

// --- タスク ------------------------------------------------------------------
// [件名, 状況, 優先度, 期限(今日からの日数。null は期限なし), 関連先 ['o'|'a', 名前] | null, 取引先責任者 | null, 詳細, 完了からの日数(done のみ)]
const T = [
  // 期限切れ
  ['見積 3 案への返答を催促する', 'open', 'p1', -2, ['o', '受発注 EDI 連携'], '小池 里奈', '9/12 に送付済み。今週中に方向性だけでも聞く。'],
  ['契約書ドラフトを法務に回す', 'in_progress', 'p1', -1, ['o', '配車管理のクラウド移行'], '大西 浩二', null],
  ['名刺のお礼メールを送る', 'open', 'p3', -3, ['a', '白波マリン'], '波多野 剛', null],
  ['請求書の送付先を確認する', 'waiting', 'p2', -4, ['a', 'ナナホシ堂'], '星野 七海', '経理の担当が替わったとのこと。'],
  // 今日
  ['概算見積を作る', 'in_progress', 'p1', 0, ['o', '検査データ収集システム 第 2 期'], '佐伯 誠一', '第 1 期の実績工数をもとに 3 段階で。'],
  ['デモ環境にサンプル物件を入れる', 'open', 'p2', 0, ['o', '物件管理と内見予約のシステム化'], null, null],
  ['役割分担のたたき台を送る', 'open', 'p1', 0, ['o', '共同提案: 自治体向けポータル'], '白石 健吾', null],
  ['月次の経費精算', 'open', 'p3', 0, null, null, null],
  ['歯医者の予約を取る', 'open', 'p4', 0, null, null, null],
  // 今後 7 日間
  ['10 月第 1 週の再訪日程を調整する', 'open', 'p2', 1, ['o', '物件管理と内見予約のシステム化'], '緑川 大輔', null],
  ['最終見積の値引き案を 2 パターン用意する', 'open', 'p1', 2, ['o', 'EC サイトリニューアル'], '星野 七海', null],
  ['ヒアリング項目のリストを送る', 'open', 'p2', 2, ['o', '図面管理システム導入'], '岡本 直樹', null],
  ['役員会向け資料をレビューする', 'open', 'p2', 3, ['o', '生産実績の見える化'], '鵜飼 達也', null],
  ['展示会で会った方へフォローの電話', 'open', 'p3', 3, ['a', '東雲フィナンシャル'], '片山 瑞希', null],
  ['税理士との打ち合わせ準備', 'open', 'p2', 4, ['a', 'やまぶき税理士法人'], '山吹 静香', '上期の数字と、来期の設備投資の相談。'],
  ['保守契約の更新条件を整理する', 'open', 'p3', 5, ['o', '保守契約 2027 年度更新'], null, null],
  ['四半期の振り返りを書く', 'open', 'p3', 6, null, null, null],
  ['シフト管理アプリの見積根拠をまとめる', 'in_progress', 'p2', 7, ['o', '店舗シフト管理アプリ'], '熊谷 拓海', null],
  // その先
  ['点呼アプリのデモ動画を撮る', 'open', 'p2', 9, ['o', '点呼・日報のデジタル化'], '関 美穂', null],
  ['PoC の成功条件を文書にする', 'open', 'p2', 10, ['o', '営業支援ダッシュボード PoC'], '片山 瑞希', null],
  ['現行サイトのアクセス解析をもらう', 'waiting', 'p3', 11, ['o', 'ツアー予約サイト刷新'], '笠原 美和', null],
  ['現場見学の候補日をもらう', 'waiting', 'p3', 12, ['o', '訪問看護の記録アプリ'], '野口 あかね', null],
  ['Web 入稿の競合サービスを調べる', 'open', 'p3', 14, ['o', 'Web 入稿システム'], null, null],
  ['書誌データのサンプルを受け取る', 'waiting', 'p3', 15, ['o', '書誌データベース整備'], '桐山 葉子', null],
  ['共同開発の契約形態を相談する', 'open', 'p2', 16, ['o', '共同開発: 予約管理 SaaS'], '早川 翔', null],
  ['事例記事の掲載許可をもらう', 'open', 'p3', 20, ['a', '北浜ロジスティクス'], '大西 浩二', null],
  ['年賀状リストを更新する', 'open', 'p4', 60, null, null, null],
  // 期限なし
  ['サービス紹介資料を刷新する', 'open', 'p3', null, null, null, null],
  ['協業メニューの案を考える', 'open', 'p4', null, ['a', 'ひだまりワークス'], '日向 陽介', null],
  ['読みたい本のリストを整理する', 'open', 'p4', null, null, null, null],
  // 完了済み(直近 14 日)
  ['キックオフの議事録を送る', 'done', 'p2', 0, ['o', '案件管理ツールのカスタマイズ'], '空閑 真理', null, 0],
  ['検収書を受け取る', 'done', 'p2', -1, ['o', '校務サーバー保守'], '村上 由紀子', null, 1],
  ['受注を社内に共有する', 'done', 'p3', -1, ['o', '校務サーバー保守'], null, null, 1],
  ['初回ヒアリング', 'done', 'p1', -2, ['o', '図面管理システム導入'], '岡本 直樹', null, 2],
  ['PC のバックアップを取る', 'done', 'p4', -2, null, null, null, 2],
  ['NDA を締結する', 'done', 'p1', -3, ['o', '共同提案: 自治体向けポータル'], '白石 健吾', null, 3],
  ['提案書 v2 を提出する', 'done', 'p1', -4, ['o', '検査データ収集システム 第 2 期'], '佐伯 誠一', null, 3],
  ['展示会の名刺を登録する', 'done', 'p3', -4, null, null, null, 4],
  ['見積 3 案を送る', 'done', 'p1', -9, ['o', '受発注 EDI 連携'], '小池 里奈', null, 5],
  ['デモを実施する', 'done', 'p1', -6, ['o', '物件管理と内見予約のシステム化'], '緑川 大輔', null, 6],
  ['セミナーに申し込む', 'done', 'p4', -6, null, null, null, 6],
  ['請求書を発行する', 'done', 'p2', -7, ['o', '会員アプリ保守'], null, null, 7],
  ['運用監視の引き継ぎ会', 'done', 'p2', -8, ['o', '運用監視の委託'], '津田 沙織', null, 8],
  ['要件定義書をレビューする', 'done', 'p2', -9, ['o', '配車管理のクラウド移行'], '大西 浩二', null, 9],
  ['ヒアリングの日程を調整する', 'done', 'p3', -10, ['o', '営業支援ダッシュボード PoC'], '片山 瑞希', null, 10],
  ['契約更新の案内を送る', 'done', 'p3', -11, ['a', 'アオバ精機'], '三浦 彩花', null, 11],
  ['確定見積を提出する', 'done', 'p1', -13, ['o', '倉庫ハンディ端末アプリ'], '大西 浩二', null, 12],
  ['倉庫の現地調査', 'done', 'p2', -13, ['o', '倉庫ハンディ端末アプリ'], null, null, 13],
]

const tasks = T.map(([title, status, priority, due, related, contact, description, doneAgo], i) => {
  const created = status === 'done' ? doneAgo + between(2, 9) : between(1, 20)
  return {
    id: uuid('04', i + 1),
    title,
    status,
    priority,
    due_date: due === null ? null : day(due),
    related_object: related ? (related[0] === 'o' ? 'opportunities' : 'accounts') : null,
    related_id: related ? (related[0] === 'o' ? oppByName(related[1]) : accByName(related[1])) : null,
    contact_id: contact ? contactByName(contact) : null,
    assignee_id: U1,
    description,
    completed_at: status === 'done' ? at(-doneAgo, between(9, 18), between(0, 59)) : null,
    created_at: at(-created, between(8, 18), between(0, 59)),
    updated_at: status === 'done' ? at(-doneAgo, between(9, 18), between(0, 59)) : at(-between(0, Math.min(created, 5)), between(9, 19), between(0, 59)),
  }
})

// --- 書き出し ----------------------------------------------------------------
mkdirSync(OUT, { recursive: true })
const write = (name, data) => {
  writeFileSync(join(OUT, name), JSON.stringify(data, null, 2) + '\n')
  console.log(`${name}: ${Array.isArray(data) ? data.length + ' 件' : 'ok'}`)
}
write('workspace.json', { base_date: BASE_DATE, workspace })
write('users.json', users)
write('accounts.json', accounts)
write('contacts.json', contacts)
write('opportunities.json', opportunities)
write('tasks.json', tasks)
