"""The photos in memory, for the local server and the tests: the same as S3Photos, without AWS. The
"upload form" posts to the local server (/local-photos/upload), which keeps the bytes here."""
from __future__ import annotations

import threading
from typing import Any

UPLOAD_URL = "/local-photos/upload"


class MemoryPhotos:
    def __init__(self) -> None:
        self.files: dict[str, tuple[str, bytes]] = {}           # key -> (content type, bytes)
        self._lock = threading.Lock()

    def upload_form(self, key: str) -> dict[str, Any]:
        return {"url": UPLOAD_URL, "fields": {"key": key, "Content-Type": "image/jpeg"}}

    def view_url(self, key: str) -> str:
        return f"/local-photos/{key}"

    def put(self, key: str, content_type: str, data: bytes) -> None:
        with self._lock:
            self.files[key] = (content_type, data)

    def delete(self, keys: list[str]) -> None:
        with self._lock:
            for key in keys:
                self.files.pop(key, None)

    def delete_prefix(self, prefix: str) -> None:
        self.delete([k for k in list(self.files) if k.startswith(prefix)])
