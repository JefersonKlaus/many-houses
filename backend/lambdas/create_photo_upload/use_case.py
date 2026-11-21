"""Use case (application layer): gives a form to send one photo of a house (a cost's or the timeline's) straight to
the photo storage: {id, upload: {url, fields}}. The id then goes in the cost or in the
timeline entry. Any partner can.
Depends only on the core's domain and ports, never on AWS."""
from __future__ import annotations

from typing import Any

from houses_core.application import house_access
from houses_core.domain.errors import ValidationError
from houses_core.domain.models import new_id, photo_key
from houses_core.ports import Dependencies


def create_photo_upload(deps: Dependencies, user: str, house_id: str) -> dict[str, Any]:
    access = house_access(deps.repo, user, house_id)
    if deps.photos is None:
        raise ValidationError("fotos indisponíveis")
    photo_id = new_id()
    return {"id": photo_id, "upload": deps.photos.upload_form(photo_key(access.owner, house_id, photo_id))}
