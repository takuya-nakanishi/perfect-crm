"""書式付きの文字(`richtext`)の洗浄と、`@` の言及の取り出し。

規則は画面の `frontend/src/lib/richtext.ts` と同じ。**保存前に洗い、その結果から言及を取る**(この順。04 §1)。
洗浄そのものは `nh3` に任せる(自前で書かない。`bleach` は非推奨なので使わない)。
"""

import json
import re
from html.parser import HTMLParser
from typing import Any

import nh3

ALLOWED_TAGS = {
    "p", "br", "strong", "b", "em", "i", "u", "s", "ul", "ol", "li",
    "h1", "h2", "h3", "blockquote", "code", "pre", "a", "span",
}  # fmt: skip
ALLOWED_ATTRIBUTES = {
    "a": {"href"},
    # 言及だけが span を使う(mention でない span は下の _strip_plain_spans が剥がす)
    "span": {"data-type", "data-id", "data-label", "role", "tabindex"},
}
URL_SCHEMES = {"http", "https", "mailto", "tel"}
MENTION_ID = re.compile(r"^([a-z][a-z0-9_]*):([0-9a-f-]{36})$")

VOID_TAGS = {"br"}


def parse_mention_id(raw: str | None) -> tuple[str, str] | None:
    matched = MENTION_ID.match(raw) if raw else None
    return (matched.group(1), matched.group(2)) if matched else None


class _StripPlainSpans(HTMLParser):
    """言及でない `<span>` を、中身だけ残して剥がす(モックの `clean` と同じ)。"""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self.stripped: list[bool] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if tag == "span" and not (values.get("data-type") == "mention" and parse_mention_id(values.get("data-id"))):
            if tag not in VOID_TAGS:
                self.stripped.append(True)
            return
        if tag not in VOID_TAGS:
            self.stripped.append(False)
        rendered = "".join(f' {name}="{_escape(value or "")}"' for name, value in attrs)
        self.out.append(f"<{tag}{rendered}>")

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        rendered = "".join(f' {name}="{_escape(value or "")}"' for name, value in attrs)
        self.out.append(f"<{tag}{rendered}>")

    def handle_endtag(self, tag: str) -> None:
        if tag in VOID_TAGS:
            return
        if self.stripped and self.stripped.pop():
            return
        self.out.append(f"</{tag}>")

    def handle_data(self, data: str) -> None:
        self.out.append(_escape(data, quote=False))


def _escape(value: str, quote: bool = True) -> str:
    out = value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return out.replace('"', "&quot;") if quote else out


def sanitize_html(html: str) -> str:
    """許した要素と属性だけを残す。許さない要素は**中身だけ**残す。"""
    cleaned = nh3.clean(
        html,
        tags=ALLOWED_TAGS,
        attributes=ALLOWED_ATTRIBUTES,
        url_schemes=URL_SCHEMES,
        link_rel="noreferrer",
        set_tag_attribute_values={"a": {"target": "_blank"}, "span": {"role": "link", "tabindex": "0"}},
    )
    parser = _StripPlainSpans()
    parser.feed(cleaned)
    parser.close()
    return "".join(parser.out)


class _Mentions(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.found: list[dict[str, str]] = []
        self.seen: set[str] = set()

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != "span":
            return
        values = dict(attrs)
        if values.get("data-type") != "mention":
            return
        raw = values.get("data-id")
        parsed = parse_mention_id(raw)
        if not parsed or raw in self.seen:
            return
        self.seen.add(str(raw))
        self.found.append({"object": parsed[0], "id": parsed[1], "label": values.get("data-label") or ""})


def extract_mentions(html: str | None) -> list[dict[str, str]]:
    """内容から言及を拾う。同じレコードは 1 回。**洗浄したあとの HTML に対して行う**(04 §1)。"""
    if not html:
        return []
    parser = _Mentions()
    parser.feed(html)
    parser.close()
    return parser.found


def mentions_value(html: str | None) -> str | None:
    """レコードに載せる形(`テーブル名:ID` の JSON)。正は `body` で、これは捨てて作り直せる導出値。"""
    ids = [f"{m['object']}:{m['id']}" for m in extract_mentions(html)]
    return json.dumps(ids, ensure_ascii=False, separators=(",", ":")) if ids else None


def body_field(obj: dict[str, Any]) -> str | None:
    timeline = obj.get("timeline")
    return timeline["body"] if timeline else None
