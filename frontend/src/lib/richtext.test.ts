import { describe, expect, it } from 'vitest'
import { sanitizeHtml } from './richtext'

// テストケース表: docs/tests/io.md。1 つの it が表の 1 行(ID をラベルに入れる)
describe('書式付きの文字の洗浄(lib/richtext.ts)', () => {
  it('IO-082 script・onclick・img を落とし、div/span は中身だけ残し、javascript: の href を落として https: に target と rel を付ける', () => {
    // <script> は要素が消える(中の文字は実行されない素の文字として残る)
    expect(sanitizeHtml('<p>前</p><script>alert(1)</script><p>後</p>')).toBe('<p>前</p>alert(1)<p>後</p>')
    // onclick などの属性は落ちる
    expect(sanitizeHtml('<p onclick="alert(1)">押す</p>')).toBe('<p>押す</p>')
    // <img> は落ちる(onerror も一緒に消える)
    expect(sanitizeHtml('<p>画像<img src="x" onerror="alert(1)"></p>')).toBe('<p>画像</p>')
    // 許さない要素は中身だけを残す
    expect(sanitizeHtml('<div><span>中身</span><p>段落</p></div>')).toBe('中身<p>段落</p>')
    // javascript: の href は落とす(要素 a は残るが属性は無い)
    expect(sanitizeHtml('<a href="javascript:alert(1)">危険</a>')).toBe('<a>危険</a>')
    expect(sanitizeHtml('<a href=" JavaScript:alert(1)">危険</a>')).toBe('<a>危険</a>')
    // https: は新しいタブで開き、参照元を渡さない
    expect(sanitizeHtml('<a href="https://example.com/" onclick="x()">安全</a>')).toBe(
      '<a href="https://example.com/" target="_blank" rel="noreferrer">安全</a>',
    )
  })
  it('IO-083 言及の span は role=link 付きで残し、data-id が規則外なら中身の文字だけ残す', () => {
    const uuid = '0b6f5c1e-3d2a-4e8b-9c7f-1a2b3c4d5e6f'
    // 規則どおりの言及は、決まった属性と role=link(キーで辿れるよう tabindex=0)を付けて残す。ほかの属性は落ちる
    expect(
      sanitizeHtml(
        `<p>担当 <span data-type="mention" data-id="accounts:${uuid}" data-label="架空商事" class="x" onclick="alert(1)">@架空商事</span> へ</p>`,
      ),
    ).toBe(
      `<p>担当 <span data-type="mention" data-id="accounts:${uuid}" data-label="架空商事" role="link" tabindex="0">@架空商事</span> へ</p>`,
    )
    // 言及の中の要素は平らにして文字だけにする
    expect(
      sanitizeHtml(`<span data-type="mention" data-id="accounts:${uuid}" data-label="架空商事"><b>@</b><img src="x">架空商事</span>`),
    ).toBe(`<span data-type="mention" data-id="accounts:${uuid}" data-label="架空商事" role="link" tabindex="0">@架空商事</span>`)
    // data-id が規則外(ID が UUID でない・テーブル名が大文字・UUID が大文字・区切りが無い・後ろに余分な文字・属性が無い)なら中身の文字だけ
    for (const bad of [
      'data-id="accounts:123"',
      `data-id="Accounts:${uuid}"`,
      `data-id="accounts:${uuid.toUpperCase()}"`,
      `data-id="${uuid}"`,
      `data-id="accounts:${uuid}x"`,
      '',
    ]) {
      expect(sanitizeHtml(`<p><span data-type="mention" ${bad} data-label="架空商事" role="link">@架空商事</span></p>`)).toBe(
        '<p>@架空商事</p>',
      )
    }
  })
})
