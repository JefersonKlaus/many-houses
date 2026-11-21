"""Use case (application layer): accepts an invite sent to the user's phone: they become a partner in the house
and see it among their houses. Answers {house_id}.
Depends only on the core's domain and ports, never on AWS."""
from __future__ import annotations

from dataclasses import replace
from typing import Any

from houses_core.domain.errors import NotFound, ValidationError
from houses_core.domain.models import Partner
from houses_core.ports import Dependencies


def accept_invite(deps: Dependencies, user: str, id: str, phone: str) -> dict[str, Any]:
    pending = deps.repo.get_pending_invite(phone, id) if phone else None
    if pending is None:
        raise NotFound("convite não encontrado")
    if pending.owner == user:
        raise ValidationError("esse convite é de uma casa sua")
    house = deps.repo.get_house(pending.owner, pending.house_id)
    if house is None or not any(i.id == id for i in house.invites):
        deps.repo.delete_pending_invite(phone, id)          # the house was deleted or the invite cancelled
        raise NotFound("esse convite não existe mais")
    partners = house.partners
    if not any(p.user == user for p in partners):
        partners = partners + (Partner(id, user, phone),)     # the invite's id: their share stays theirs
    house = replace(house, partners=partners, invites=tuple(i for i in house.invites if i.id != id))
    deps.repo.save_house(pending.owner, house)
    deps.repo.save_link(user, pending.owner, house.id)
    deps.repo.delete_pending_invite(phone, id)
    return {"house_id": house.id}
