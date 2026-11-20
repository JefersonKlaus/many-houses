"""Use case (application layer): adds a renovation cost to a house.
Depends only on the core's domain and ports, never on AWS."""
from __future__ import annotations

from typing import Any, Mapping

from houses_core.application import check_expense_limit, get_house
from houses_core.domain.models import Expense
from houses_core.ports import Dependencies


def create_expense(deps: Dependencies, owner: str, house_id: str, payload: Mapping[str, Any]) -> Expense:
    house = get_house(deps.repo, owner, house_id)
    expense = Expense.from_input(payload, house.id)
    check_expense_limit(deps.repo, owner, house.id)
    deps.repo.save_expense(owner, expense)
    return expense
