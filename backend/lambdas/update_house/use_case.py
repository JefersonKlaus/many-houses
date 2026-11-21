"""Use case (application layer): changes a house's data (its installments are changed on their own routes).
A house with installments can't become "cash" until they are deleted.
Returns the house's page (application.house_view), so the screen redraws without another request.
Depends only on the core's domain and ports, never on AWS."""
from __future__ import annotations

from typing import Any, Mapping

from houses_core.application import get_house, house_view
from houses_core.domain.errors import ValidationError
from houses_core.domain.models import House
from houses_core.ports import Dependencies


def update_house(deps: Dependencies, owner: str, id: str, payload: Mapping[str, Any]) -> dict[str, Any]:
    get_house(deps.repo, owner, id)
    house = House.from_input(payload, id)
    if house.payment_type == "cash" and deps.repo.list_installments(owner, id):
        raise ValidationError("à vista: exclua antes as prestações desta casa")
    deps.repo.save_house(owner, house)
    return house_view(deps.repo, owner, house)
