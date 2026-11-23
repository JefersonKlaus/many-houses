"""Use case (application layer): changes a moment of the timeline (date, text, photos); the photos taken out of it
are deleted. Any partner can. Answers the house's page (application.house_view).
Depends only on the core's domain and ports, never on AWS."""
from __future__ import annotations

from typing import Any, Mapping

from houses_core.application import delete_photos, house_access, house_view
from houses_core.domain.errors import NotFound
from houses_core.domain.models import TimelineEntry
from houses_core.ports import Dependencies


def update_timeline_entry(deps: Dependencies, user: str, house_id: str, id: str,
                          payload: Mapping[str, Any]) -> dict[str, Any]:
    access = house_access(deps.repo, user, house_id)
    before = deps.repo.get_timeline_entry(access.owner, house_id, id)
    if before is None:
        raise NotFound("registro não encontrado")
    entry = TimelineEntry.from_input(payload, house_id, id)
    deps.repo.save_timeline_entry(access.owner, entry)
    delete_photos(deps, access, set(before.photos) - set(entry.photos))
    return house_view(deps, access)
