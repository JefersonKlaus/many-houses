"""Use case (application layer): changes an installment: due date, amount, when it was paid (empty = not paid yet)
and by whom (by default: who paid it before, or the user when it is being marked as paid).
The user is the house's owner or one of its partners (application.house_access). Answers the house's page (application.house_view).
Depends only on the core's domain and ports, never on AWS."""
from __future__ import annotations

from dataclasses import replace
from typing import Any, Mapping

from houses_core.application import check_member, get_installment, house_access, house_view
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
    deps.repo.save_installments(access.owner, [installment])
    return house_view(deps.repo, access)
