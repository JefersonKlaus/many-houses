"""Use case (application layer): registers a house that was bought: name, address, date, price, the costs of buying it,
the profit wanted, its areas and how it was paid. Bought in installments, the same request brings the
entrada and the plan (`installments`: count, amount_cents, first_due_date), created with the house.
The user is its owner. Answers the house's page (application.house_view).
Depends only on the core's domain and ports, never on AWS."""
from __future__ import annotations

from dataclasses import replace
from typing import Any, Mapping

from houses_core.application import Access, check_house_limit, house_view
from houses_core.domain.errors import ValidationError
from houses_core.domain.models import OWNER_MEMBER_ID, House, Installment
from houses_core.ports import Dependencies


def create_house(deps: Dependencies, user: str, payload: Mapping[str, Any], phone: str = "") -> dict[str, Any]:
    house = replace(House.from_input(payload), owner_phone=phone)
    installments = []
    if house.payment_type == "installments":
        plan = payload.get("installments")
        if not isinstance(plan, Mapping):
            raise ValidationError("parcelado: informe quantas parcelas, o valor e a data da primeira")
        installments = Installment.plan(plan, house.id)        # validated before anything is saved
    check_house_limit(deps.repo, user)
    deps.repo.save_house(user, house)
    deps.repo.save_installments(user, installments)
    return house_view(deps.repo, Access(user, house, OWNER_MEMBER_ID))
