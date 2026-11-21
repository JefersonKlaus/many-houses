"""Use case (application layer): adds `count` monthly installments (prestações) to a house, the first one due
on `first_due_date`. Returns the house's page (application.house_view), so the screen redraws without another request.
Depends only on the core's domain and ports, never on AWS."""
from __future__ import annotations

from typing import Any, Mapping

from houses_core.application import check_bought_in_installments, check_installment_limit, get_house, house_view
from houses_core.domain.models import Installment
from houses_core.ports import Dependencies


def create_installments(deps: Dependencies, owner: str, house_id: str,
                        payload: Mapping[str, Any]) -> dict[str, Any]:
    house = get_house(deps.repo, owner, house_id)
    check_bought_in_installments(house)
    installments = Installment.plan(payload, house.id)
    check_installment_limit(deps.repo, owner, house.id, len(installments))
    deps.repo.save_installments(owner, installments)
    return house_view(deps.repo, owner, house)
