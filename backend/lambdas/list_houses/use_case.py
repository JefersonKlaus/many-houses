"""Use case (application layer): every house, by name, each with what it cost (purchase, renovation, total) and how its
payment is going.
Depends only on the core's domain and ports, never on AWS."""
from __future__ import annotations

from collections import defaultdict
from typing import Any

from houses_core.application import sorted_houses, totals
from houses_core.ports import Dependencies


def list_houses(deps: Dependencies, owner: str) -> list[dict[str, Any]]:
    costs, installments = defaultdict(list), defaultdict(list)
    for expense in deps.repo.list_expenses(owner):          # every house's costs in one query
        costs[expense.house_id].append(expense)
    for installment in deps.repo.list_installments(owner):  # and every installment in another
        installments[installment.house_id].append(installment)
    return [{**house.to_dict(), "totals": totals(house, costs[house.id], installments[house.id])}
            for house in sorted_houses(deps.repo.list_houses(owner))]
