"""Use case (application layer): adds `count` monthly installments (prestações) to a house, the first one due
on `first_due_date`. For a house bought in one deal with others, `amount_cents` is the whole installment (of all
the houses) and each house gets its part, in proportion to its price. The user is the house's owner or one of its partners (application.house_access). Answers the house's page (application.house_view).
Depends only on the core's domain and ports, never on AWS."""
from __future__ import annotations

from typing import Any, Mapping

from houses_core.application import (bundle_houses, check_bought_in_installments, check_installment_limit,
                                     house_access, house_view)
from houses_core.domain.models import Installment
from houses_core.ports import Dependencies


def create_installments(deps: Dependencies, user: str, house_id: str,
                        payload: Mapping[str, Any]) -> dict[str, Any]:
    access = house_access(deps.repo, user, house_id)
    check_bought_in_installments(access.house)
    deal = bundle_houses(deps.repo, access.owner, access.house)
    if len(deal) > 1:
        installments = Installment.plan_group(payload, deal)
        for house in deal:
            check_bought_in_installments(house)
            check_installment_limit(deps.repo, access.owner, house.id, len(installments) // len(deal))
    else:
        installments = Installment.plan(payload, house_id)
        check_installment_limit(deps.repo, access.owner, house_id, len(installments))
    deps.repo.save_installments(access.owner, installments)
    return house_view(deps, access)
