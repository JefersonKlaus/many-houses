"""The photos in S3: a private bucket. The browser posts each photo straight to S3 with a form signed
here (only a JPEG, only up to MAX_BYTES, only at that key), and sees it through presigned links."""
from __future__ import annotations

from typing import Any

MAX_BYTES = 8 * 1024 * 1024         # the screens send photos already reduced (1600 px): far below this
UPLOAD_SECONDS = 10 * 60
VIEW_SECONDS = 60 * 60


class S3Photos:
    def __init__(self, client: Any, bucket: str) -> None:
        self.client, self.bucket = client, bucket

    def upload_form(self, key: str) -> dict[str, Any]:
        form = self.client.generate_presigned_post(
            self.bucket, key, Fields={"Content-Type": "image/jpeg"},
            Conditions=[{"Content-Type": "image/jpeg"}, ["content-length-range", 1, MAX_BYTES]],
            ExpiresIn=UPLOAD_SECONDS)
        return {"url": form["url"], "fields": form["fields"]}

    def view_url(self, key: str) -> str:
        return self.client.generate_presigned_url("get_object", Params={"Bucket": self.bucket, "Key": key},
                                                  ExpiresIn=VIEW_SECONDS)

    def delete(self, keys: list[str]) -> None:
        for start in range(0, len(keys), 1000):         # the most delete_objects takes at once
            chunk = keys[start:start + 1000]
            if chunk:
                self.client.delete_objects(Bucket=self.bucket, Delete={"Objects": [{"Key": k} for k in chunk],
                                                                      "Quiet": True})

    def delete_prefix(self, prefix: str) -> None:
        keys, token = [], None
        while True:
            request = {"Bucket": self.bucket, "Prefix": prefix, **({"ContinuationToken": token} if token else {})}
            response = self.client.list_objects_v2(**request)
            keys += [o["Key"] for o in response.get("Contents", [])]
            token = response.get("NextContinuationToken")
            if not token:
                break
        self.delete(keys)
