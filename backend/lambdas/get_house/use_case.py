"""Use case (application layer): one house: its data, its renovation costs (newest first) and its totals.
Depends only on the core's domain and ports, never on AWS."""
from __future__ import annotations

from typing import Any

from houses_core import application
from houses_core.application import sorted_expenses, totals
from houses_core.ports import Dependencies


def get_house(deps: Dependencies, owner: str, id: str) -> dict[str, Any]:
    house = application.get_house(deps.repo, owner, id)
    expenses = sorted_expenses(deps.repo.list_expenses(owner, house.id))
    return {"house": house.to_dict(), "expenses": [e.to_dict() for e in expenses],
            "totals": totals(house, expenses)}
