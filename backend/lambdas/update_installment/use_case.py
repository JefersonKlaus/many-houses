"""Use case (application layer): changes an installment: due date, amount, when it was paid (empty = not paid yet)
and by whom (by default: who paid it before, or the user when it is being marked as paid).
The user is the house's owner or one of its partners (application.house_access). In a deal of several houses its due date and payment are the deal's (the same month of every house changes
together, who paid it being the same person in each) and `total_cents`, the whole installment, is split again among them. Answers the house's page (application.house_view).
Depends only on the core's domain and ports, never on AWS."""
from __future__ import annotations

from dataclasses import replace
from typing import Any, Mapping

from houses_core.application import check_member, get_installment, group_siblings, house_access, house_view, same_member
from houses_core.domain.models import Installment
from houses_core.ports import Dependencies


def update_installment(deps: Dependencies, user: str, house_id: str, id: str,
                       payload: Mapping[str, Any]) -> dict[str, Any]:
    access = house_access(deps.repo, user, house_id)
    before = get_installment(deps.repo, access, id)
    installment = Installment.from_input(payload, house_id, id)
    if installment.paid and not installment.paid_by:
        installment = replace(installment, paid_by=before.paid_by if before.paid else access.member_id)
    check_member(access.house, installment.paid_by)
    if before.group_id:
        installments = [i if i.house_id == house_id or not i.paid_by else replace(
            i, paid_by=same_member(access.house, i.paid_by, deps.repo.get_house(access.owner, i.house_id)))
            for i in Installment.edit_group(group_siblings(deps.repo, access.owner, before), installment, payload)]
    else:
        installments = [installment]
    deps.repo.save_installments(access.owner, installments)
    return house_view(deps, access)
