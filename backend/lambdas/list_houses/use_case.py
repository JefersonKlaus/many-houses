"""Use case (application layer): every house of the user, theirs and the ones they are a partner in, by name, each with
what it cost (purchase, renovation, total), how its payment is going and the user's role in it.
Depends only on the core's domain and ports, never on AWS."""
from __future__ import annotations

from collections import defaultdict
from typing import Any

from houses_core.application import public_house, sorted_houses, totals
from houses_core.domain.models import House
from houses_core.ports import Dependencies


def list_houses(deps: Dependencies, user: str) -> list[dict[str, Any]]:
    costs, installments = defaultdict(list), defaultdict(list)
    for expense in deps.repo.list_expenses(user):           # every own house's costs in one query
        costs[expense.house_id].append(expense)
    for installment in deps.repo.list_installments(user):   # and every installment in another
        installments[installment.house_id].append(installment)
    role: dict[str, str] = {}
    houses: list[House] = []
    for house in deps.repo.list_houses(user):
        houses.append(house)
        role[house.id] = "owner"
    for owner, house_id in deps.repo.list_links(user):      # the houses the user is a partner in
        house = deps.repo.get_house(owner, house_id)
        if house is None or not any(p.user == user for p in house.partners):
            continue
        houses.append(house)
        role[house.id] = "partner"
        costs[house.id] = deps.repo.list_expenses(owner, house_id)
        installments[house.id] = deps.repo.list_installments(owner, house_id)
    return [{**public_house(house), "role": role[house.id],
             "totals": totals(house, costs[house.id], installments[house.id])}
            for house in sorted_houses(houses)]
