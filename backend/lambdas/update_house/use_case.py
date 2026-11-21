"""Use case (application layer): changes a house's data (installments, partners and the purchase shares have their own
routes). A house with installments can't become cash until they are deleted; an area with costs
can't be removed. The user is the house's owner or one of its partners (application.house_access).\nAnswers the house's page (application.house_view).
Depends only on the core's domain and ports, never on AWS."""
from __future__ import annotations

from dataclasses import replace
from typing import Any, Mapping

from houses_core.application import (Access, check_removed_areas_have_no_costs, house_access, house_view, user_name,
                                     with_my_name)
from houses_core.domain.errors import ValidationError
from houses_core.domain.models import House
from houses_core.ports import Dependencies


def update_house(deps: Dependencies, user: str, id: str, payload: Mapping[str, Any], phone: str = "",
                 name: str = "") -> dict[str, Any]:
    access = house_access(deps.repo, user, id)
    house = House.from_input(payload, id, previous=with_my_name(access, user_name(deps.repo, user, name)))
    if access.is_owner and phone and not house.owner_phone:     # houses registered before phones were kept
        house = replace(house, owner_phone=phone)
    check_removed_areas_have_no_costs(deps.repo, access.owner, access.house, house)
    if house.payment_type == "cash" and deps.repo.list_installments(access.owner, id):
        raise ValidationError("à vista: exclua antes as prestações desta casa")
    deps.repo.save_house(access.owner, house)
    return house_view(deps, Access(access.owner, house, access.member_id))
