"""Use case (application layer): deletes a moment of the timeline and its photos. Any partner can. Answers the
house's page (application.house_view).
Depends only on the core's domain and ports, never on AWS."""
from __future__ import annotations

from typing import Any

from houses_core.application import delete_photos, house_access, house_view
from houses_core.domain.errors import NotFound
from houses_core.ports import Dependencies


def delete_timeline_entry(deps: Dependencies, user: str, house_id: str, id: str) -> dict[str, Any]:
    access = house_access(deps.repo, user, house_id)
    entry = deps.repo.get_timeline_entry(access.owner, house_id, id)
    if entry is None:
        raise NotFound("registro não encontrado")
    deps.repo.delete_timeline_entry(access.owner, house_id, id)
    delete_photos(deps, access, entry.photos)
    return house_view(deps, access)
