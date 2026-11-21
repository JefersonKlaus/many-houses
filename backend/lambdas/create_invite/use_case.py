"""Use case (application layer): invites someone to be a partner in a house, by their phone (DDD + number). Any
partner can. The invite waits under that phone until they log in and accept or decline it.
Answers the house's page (application.house_view).
Depends only on the core's domain and ports, never on AWS."""
from __future__ import annotations

from dataclasses import replace
from typing import Any, Mapping

from houses_core.application import Access, house_access, house_view, today, with_my_name
from houses_core.domain.errors import ValidationError
from houses_core.domain.models import MAX_PARTNERS, Invite, PendingInvite, new_id, phone_number
from houses_core.ports import Dependencies


def create_invite(deps: Dependencies, user: str, house_id: str, payload: Mapping[str, Any],
                  phone: str = "", name: str = "") -> dict[str, Any]:
    access = house_access(deps.repo, user, house_id)
    house = with_my_name(access, name)
    guest = phone_number(payload.get("phone"))
    if guest == phone:
        raise ValidationError("celular: esse é o seu número")
    if guest == house.owner_phone or any(p.phone == guest for p in house.partners):
        raise ValidationError("celular: essa pessoa já é sócia desta casa")
    if any(i.phone == guest for i in house.invites):
        raise ValidationError("celular: essa pessoa já foi convidada e ainda não respondeu")
    if len(house.partners) + len(house.invites) >= MAX_PARTNERS:
        raise ValidationError(f"limite de {MAX_PARTNERS} sócios por casa")
    invite = Invite(new_id(), guest, today())
    if access.is_owner and not house.owner_phone:
        house = replace(house, owner_phone=phone)
    house = replace(house, invites=house.invites + (invite,))
    deps.repo.save_house(access.owner, house)
    deps.repo.save_pending_invite(PendingInvite(invite.id, guest, access.owner, house.id, house.name,
                                                phone, invite.date, name))     # from whoever invited
    return house_view(deps.repo, Access(access.owner, house, access.member_id))
