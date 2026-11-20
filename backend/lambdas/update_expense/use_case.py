"""Use case (application layer): changes a renovation cost of a house.
Depends only on the core's domain and ports, never on AWS."""
from __future__ import annotations

from typing import Any, Mapping

from houses_core.application import get_expense
from houses_core.domain.models import Expense
from houses_core.ports import Dependencies


def update_expense(deps: Dependencies, owner: str, house_id: str, id: str, payload: Mapping[str, Any]) -> Expense:
    get_expense(deps.repo, owner, house_id, id)
    expense = Expense.from_input(payload, house_id, id)
    deps.repo.save_expense(owner, expense)
    return expense
