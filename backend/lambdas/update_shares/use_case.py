"""Use case (application layer): says how much of the purchase (what was paid up front) each member paid:
`shares`: [{member_id, cents}]. The user is the house's owner or one of its partners (application.house_access). Answers the house's page (application.house_view).
Depends only on the core's domain and ports, never on AWS."""
from __future__ import annotations

from dataclasses import replace
from typing import Any, Mapping

from houses_core.application import Access, house_access, house_view
from houses_core.domain.models import shares_from_input
from houses_core.ports import Dependencies


def update_shares(deps: Dependencies, user: str, house_id: str, payload: Mapping[str, Any]) -> dict[str, Any]:
    access = house_access(deps.repo, user, house_id)
    house = replace(access.house, purchase_shares=shares_from_input(payload, access.house.member_ids))
    deps.repo.save_house(access.owner, house)
    return house_view(deps.repo, Access(access.owner, house, access.member_id))
