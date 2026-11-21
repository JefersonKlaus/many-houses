"""Use case (application layer): one house: its data, its members, its renovation costs (newest first), its installments and
its totals. The user is the house's owner or one of its partners (application.house_access).
Depends only on the core's domain and ports, never on AWS."""
from __future__ import annotations

from typing import Any

from houses_core.application import house_access, house_view
from houses_core.ports import Dependencies


def get_house(deps: Dependencies, user: str, id: str) -> dict[str, Any]:
    return house_view(deps, house_access(deps.repo, user, id))
