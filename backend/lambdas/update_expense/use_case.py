"""Use case (application layer): changes a renovation cost.
Returns the house's page (application.house_view), so the screen redraws without another request.
Depends only on the core's domain and ports, never on AWS."""
from __future__ import annotations

from typing import Any, Mapping

from houses_core.application import check_expense_area, get_expense, get_house, house_view
from houses_core.domain.models import Expense
from houses_core.ports import Dependencies


def update_expense(deps: Dependencies, owner: str, house_id: str, id: str,
                   payload: Mapping[str, Any]) -> dict[str, Any]:
    get_expense(deps.repo, owner, house_id, id)
    house = get_house(deps.repo, owner, house_id)
    expense = Expense.from_input(payload, house_id, id)
    check_expense_area(house, expense)
    deps.repo.save_expense(owner, expense)
    return house_view(deps.repo, owner, house)
