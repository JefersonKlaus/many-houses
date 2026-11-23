"""Use case (application layer): adds a moment to the house's timeline: a date, what it shows and its photos
(already sent, by id). Any partner can. Answers the house's page (application.house_view).
Depends only on the core's domain and ports, never on AWS."""
from __future__ import annotations

from typing import Any, Mapping

from houses_core.application import house_access, house_view
from houses_core.domain.models import TimelineEntry
from houses_core.ports import Dependencies


def create_timeline_entry(deps: Dependencies, user: str, house_id: str, payload: Mapping[str, Any]) -> dict[str, Any]:
    access = house_access(deps.repo, user, house_id)
    deps.repo.save_timeline_entry(access.owner, TimelineEntry.from_input(payload, house_id))
    return house_view(deps, access)
