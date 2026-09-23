"""検索と、書式付きの文字の扱い。画面(`frontend/src/mocks/engine.ts`・`lib/richtext.ts`)と同じ規則。"""

import re
import unicodedata

HIRAGANA = re.compile(r"[ぁ-ゖ]")
SPACES = re.compile(r"\s+")
TAGS = re.compile(r"<[^>]*>")

# 検索の対象になる項目の型
TEXT_TYPES = frozenset({"text", "textarea", "richtext", "email", "phone", "url"})


def normalize_text(s: str) -> str:
    """全角半角・大文字小文字・ひらがなカタカナの違いを無視して比べるための形(モックの `normalizeText`)。"""
    s = unicodedata.normalize("NFKC", s).lower()
    s = HIRAGANA.sub(lambda m: chr(ord(m.group()) + 0x60), s)
    return SPACES.sub("", s)


def plain_text(html: str) -> str:
    """書式付きの文字から字だけを取り出す(検索と CSV 用)。"""
    text = TAGS.sub(" ", html)
    text = (
        text.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
        .replace("&#39;", "'")
    )
    return SPACES.sub(" ", text).strip()


def search_text_of(fields: list[dict], values: dict) -> str:
    """その行の検索用の 1 本。文字の列を正規化して繋ぐ(02 §4 の「検索用の列」)。"""
    parts = []
    for field in fields:
        if field["type"] not in TEXT_TYPES:
            continue
        value = values.get(field["key"])
        if not isinstance(value, str) or not value:
            continue
        parts.append(normalize_text(plain_text(value) if field["type"] == "richtext" else value))
    return " ".join(parts)
