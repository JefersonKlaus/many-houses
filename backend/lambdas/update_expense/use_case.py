"""Use case (application layer): changes a renovation cost (without `paid_by`, it keeps who paid it).
The user is the house's owner or one of its partners (application.house_access). Answers the house's page (application.house_view).
Depends only on the core's domain and ports, never on AWS."""
from __future__ import annotations

from dataclasses import replace
from typing import Any, Mapping

from houses_core.application import check_expense_area, check_member, get_expense, house_access, house_view
from houses_core.domain.models import Expense
from houses_core.ports import Dependencies


def update_expense(deps: Dependencies, user: str, house_id: str, id: str,
                   payload: Mapping[str, Any]) -> dict[str, Any]:
    access = house_access(deps.repo, user, house_id)
    before = get_expense(deps.repo, access, id)
    expense = Expense.from_input(payload, house_id, id)
    if not expense.paid_by:
        expense = replace(expense, paid_by=before.paid_by)
    check_expense_area(access.house, expense)
    check_member(access.house, expense.paid_by)
    deps.repo.save_expense(access.owner, expense)
    return house_view(deps.repo, access)
