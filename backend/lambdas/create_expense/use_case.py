"""Use case (application layer): adds a renovation cost to a house, paid by one of its members (by default, the
user). The user is the house's owner or one of its partners (application.house_access). Answers the house's page (application.house_view).
Depends only on the core's domain and ports, never on AWS."""
from __future__ import annotations

from dataclasses import replace
from typing import Any, Mapping

from houses_core.application import (check_expense_area, check_expense_limit, check_member, house_access,
                                     house_view)
from houses_core.domain.models import Expense
from houses_core.ports import Dependencies


def create_expense(deps: Dependencies, user: str, house_id: str, payload: Mapping[str, Any]) -> dict[str, Any]:
    access = house_access(deps.repo, user, house_id)
    expense = Expense.from_input(payload, house_id)
    if not expense.paid_by:
        expense = replace(expense, paid_by=access.member_id)
    check_expense_area(access.house, expense)
    check_member(access.house, expense.paid_by)
    check_expense_limit(deps.repo, access.owner, house_id)
    deps.repo.save_expense(access.owner, expense)
    return house_view(deps, access)
