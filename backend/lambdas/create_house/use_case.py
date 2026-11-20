"""Use case (application layer): registers a house that was bought: name, address, date, price and the costs of buying it.
Depends only on the core's domain and ports, never on AWS."""
from __future__ import annotations

from typing import Any, Mapping

from houses_core.application import check_house_limit
from houses_core.domain.models import House
from houses_core.ports import Dependencies


def create_house(deps: Dependencies, owner: str, payload: Mapping[str, Any]) -> House:
    house = House.from_input(payload)
    check_house_limit(deps.repo, owner)
    deps.repo.save_house(owner, house)
    return house
