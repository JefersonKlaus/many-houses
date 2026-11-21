"""Use case (application layer): one house: its data, its renovation costs (newest first), its installments and its totals.
Depends only on the core's domain and ports, never on AWS."""
from __future__ import annotations

from typing import Any

from houses_core import application
from houses_core.application import house_view
from houses_core.ports import Dependencies


def get_house(deps: Dependencies, owner: str, id: str) -> dict[str, Any]:
    return house_view(deps.repo, owner, application.get_house(deps.repo, owner, id))
