"""Drive API v3 の呼び出し(04 §8)。値の形は画面の `DriveFile`(id・name・mime_type・url)。"""

from typing import Any

from app.google import http

FILES_URL = "https://www.googleapis.com/drive/v3/files"
FOLDER_MIME = "application/vnd.google-apps.folder"
DOCUMENT_MIME = "application/vnd.google-apps.document"
FIELDS = "id,name,mimeType,webViewLink"
# 画面の「参照」に出す件数(04 §8)
SEARCH_LIMIT = 20
# レコード名の頭に付けるフォルダ。マイドライブ / CRM / テーブルの表示名 / …
ROOT_FOLDER = "CRM"


def _escape(value: str) -> str:
    """Drive の検索式の中の文字列リテラル。`\\` と `'` を逃がす(逆順にすると二重に逃げる)。"""
    return value.replace("\\", "\\\\").replace("'", "\\'")


def _file(raw: dict[str, Any]) -> dict[str, str]:
    file_id = str(raw.get("id", ""))
    mime = str(raw.get("mimeType", ""))
    return {
        "id": file_id,
        "name": str(raw.get("name", "")),
        "mime_type": mime,
        "url": str(raw.get("webViewLink") or f"https://drive.google.com/file/d/{file_id}/view"),
    }


def search(token: str, q: str) -> list[dict[str, str]]:
    """マイドライブを名前の部分一致で探す。空なら最近触ったものから。フォルダとゴミ箱は出さない。"""
    terms = [f"mimeType != '{FOLDER_MIME}'", "trashed = false"]
    if q.strip():
        terms.append(f"name contains '{_escape(q.strip())}'")
    body = http.call(
        "GET",
        FILES_URL,
        headers={"Authorization": f"Bearer {token}"},
        params={
            "q": " and ".join(terms),
            "pageSize": SEARCH_LIMIT,
            "fields": f"files({FIELDS})",
            "orderBy": "modifiedTime desc",
            "spaces": "drive",
            # 共有ドライブのファイルも探せるようにする(マイドライブだけなら corpora=user)
            "includeItemsFromAllDrives": "true",
            "supportsAllDrives": "true",
        },
    )
    files = body.get("files")
    return [_file(raw) for raw in files][:SEARCH_LIMIT] if isinstance(files, list) else []


def _find_child(token: str, name: str, parent: str) -> str | None:
    folder = f"mimeType = '{FOLDER_MIME}' and name = '{_escape(name)}'"
    body = http.call(
        "GET",
        FILES_URL,
        headers={"Authorization": f"Bearer {token}"},
        params={
            "q": f"{folder} and '{parent}' in parents and trashed = false",
            "pageSize": 1,
            "fields": "files(id)",
            "spaces": "drive",
        },
    )
    files = body.get("files")
    return str(files[0]["id"]) if isinstance(files, list) and files else None


def ensure_folder(token: str, name: str, parent: str) -> str:
    """同じ名前のフォルダがあればその ID、無ければ作る。**人が作ったフォルダも見つける**(だから readonly が要る)。"""
    found = _find_child(token, name, parent)
    if found:
        return found
    body = http.call(
        "POST",
        FILES_URL,
        headers={"Authorization": f"Bearer {token}"},
        params={"fields": "id"},
        json={"name": name, "mimeType": FOLDER_MIME, "parents": [parent]},
    )
    return str(body.get("id", ""))


def create_document(token: str, *, object_label: str, name: str) -> dict[str, str]:
    """「マイドライブ / CRM / テーブルの表示名」の中に、レコード名の Google ドキュメントを作る。"""
    folder = ensure_folder(token, object_label, ensure_folder(token, ROOT_FOLDER, "root"))
    body = http.call(
        "POST",
        FILES_URL,
        headers={"Authorization": f"Bearer {token}"},
        params={"fields": FIELDS},
        json={"name": name, "mimeType": DOCUMENT_MIME, "parents": [folder]},
    )
    return _file(body)
