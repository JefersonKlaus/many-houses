"""Use case (application layer): changes a house's data (its renovation costs stay).
Depends only on the core's domain and ports, never on AWS."""
from __future__ import annotations

from typing import Any, Mapping

from houses_core.application import get_house
from houses_core.domain.models import House
from houses_core.ports import Dependencies


def update_house(deps: Dependencies, owner: str, id: str, payload: Mapping[str, Any]) -> House:
    get_house(deps.repo, owner, id)
    house = House.from_input(payload, id)
    deps.repo.save_house(owner, house)
    return house
