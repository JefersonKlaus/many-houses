"""Use case (application layer): every house, by name, each with what it cost (purchase, renovation, total).
Depends only on the core's domain and ports, never on AWS."""
from __future__ import annotations

from collections import defaultdict
from typing import Any

from houses_core.application import sorted_houses, totals
from houses_core.ports import Dependencies


def list_houses(deps: Dependencies, owner: str) -> list[dict[str, Any]]:
    costs = defaultdict(list)
    for expense in deps.repo.list_expenses(owner):          # every house's costs in one query
        costs[expense.house_id].append(expense)
    return [{**house.to_dict(), "totals": totals(house, costs[house.id])}
            for house in sorted_houses(deps.repo.list_houses(owner))]
