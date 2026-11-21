"""Use case (application layer): registers a house that was bought: name, address, date, price, the
costs of buying it, the profit wanted and how it was paid. Bought in installments, the same request
brings the entrada and the plan (`installments`: count, amount_cents, first_due_date), and the
installments are created with the house. Returns the house's page (application.house_view).
Depends only on the core's domain and ports, never on AWS."""
from __future__ import annotations

from typing import Any, Mapping

from houses_core.application import check_house_limit, house_view
from houses_core.domain.errors import ValidationError
from houses_core.domain.models import House, Installment
from houses_core.ports import Dependencies


def create_house(deps: Dependencies, owner: str, payload: Mapping[str, Any]) -> dict[str, Any]:
    house = House.from_input(payload)
    installments = []
    if house.payment_type == "installments":
        plan = payload.get("installments")
        if not isinstance(plan, Mapping):
            raise ValidationError("parcelado: informe quantas parcelas, o valor e a data da primeira")
        installments = Installment.plan(plan, house.id)        # validated before anything is saved
    check_house_limit(deps.repo, owner)
    deps.repo.save_house(owner, house)
    deps.repo.save_installments(owner, installments)
    return house_view(deps.repo, owner, house)
