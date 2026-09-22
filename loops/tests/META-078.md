# META-078

- 状態: 完了(2026-09-22)

## 試行の記録

- [2026-09-22] 完了: `frontend/src/mocks/engine.test.ts` に追記。テーブル(`trial`)を作り、そのレコードを関連先にした活動を 1 件入れてから `trial` を `deleteObject` する。`GET /meta` の活動の関連先(`related`)の `targets` から `trial` だけが消え(ほかの関連先は元の順で残る)、活動の行の `related_object`・`related_id` はそのまま残ることを確かめる。`restoreObject('trial')` で `targets` にも戻る
  - 期待値の確認: `schema.ts` の `liveObjects` で polymorphic の `targets` を `isLive` で絞るのをやめると落ちる(`expected [ 'accounts', 'contacts', …(3) ] to deeply equal [ 'accounts', 'contacts', …(2) ]`)ことを確認して戻した
