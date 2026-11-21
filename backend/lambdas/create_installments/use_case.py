"""Use case (application layer): adds `count` monthly installments (prestações) to a house, the first one due
on `first_due_date`. The user is the house's owner or one of its partners (application.house_access). Answers the house's page (application.house_view).
Depends only on the core's domain and ports, never on AWS."""
from __future__ import annotations

from typing import Any, Mapping

from houses_core.application import check_bought_in_installments, check_installment_limit, house_access, house_view
from houses_core.domain.models import Installment
from houses_core.ports import Dependencies


def create_installments(deps: Dependencies, user: str, house_id: str,
                        payload: Mapping[str, Any]) -> dict[str, Any]:
    access = house_access(deps.repo, user, house_id)
    check_bought_in_installments(access.house)
    installments = Installment.plan(payload, house_id)
    check_installment_limit(deps.repo, access.owner, house_id, len(installments))
    deps.repo.save_installments(access.owner, installments)
    return house_view(deps.repo, access)
