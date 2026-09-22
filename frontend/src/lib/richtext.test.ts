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
})
