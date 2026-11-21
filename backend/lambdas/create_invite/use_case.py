"""Use case (application layer): invites someone to be a partner in a house, by their phone (DDD + number). The invite
waits under that phone until they log in and accept or decline it. Only the house's owner can.
Answers the house's page (application.house_view).
Depends only on the core's domain and ports, never on AWS."""
from __future__ import annotations

from dataclasses import replace
from typing import Any, Mapping

from houses_core.application import Access, house_access, house_view, require_owner, today
from houses_core.domain.errors import ValidationError
from houses_core.domain.models import MAX_PARTNERS, Invite, PendingInvite, new_id, phone_number
from houses_core.ports import Dependencies


def create_invite(deps: Dependencies, user: str, house_id: str, payload: Mapping[str, Any],
                  phone: str = "") -> dict[str, Any]:
    access = house_access(deps.repo, user, house_id)
    require_owner(access, "convidar sócios")
    house = access.house
    guest = phone_number(payload.get("phone"))
    if guest in (phone, house.owner_phone):
        raise ValidationError("celular: esse é o seu número")
    if any(p.phone == guest for p in house.partners):
        raise ValidationError("celular: essa pessoa já é sócia desta casa")
    if any(i.phone == guest for i in house.invites):
        raise ValidationError("celular: essa pessoa já foi convidada e ainda não respondeu")
    if len(house.partners) + len(house.invites) >= MAX_PARTNERS:
        raise ValidationError(f"limite de {MAX_PARTNERS} sócios por casa")
    invite = Invite(new_id(), guest, today())
    house = replace(house, owner_phone=house.owner_phone or phone, invites=house.invites + (invite,))
    deps.repo.save_house(user, house)
    deps.repo.save_pending_invite(PendingInvite(invite.id, guest, user, house.id, house.name,
                                                house.owner_phone, invite.date))
    return house_view(deps.repo, Access(user, house, access.member_id))
