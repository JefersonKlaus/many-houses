"""Use case (application layer): declines an invite sent to the user's phone: it is gone, and the house's owner sees
that nobody is waiting anymore.
Depends only on the core's domain and ports, never on AWS."""
from __future__ import annotations

from dataclasses import replace

from houses_core.domain.errors import NotFound
from houses_core.ports import Dependencies


def decline_invite(deps: Dependencies, user: str, id: str, phone: str) -> None:
    pending = deps.repo.get_pending_invite(phone, id) if phone else None
    if pending is None:
        raise NotFound("convite não encontrado")
    house = deps.repo.get_house(pending.owner, pending.house_id)
    if house is not None and any(i.id == id for i in house.invites):
        deps.repo.save_house(pending.owner, replace(house, invites=tuple(i for i in house.invites if i.id != id)))
    deps.repo.delete_pending_invite(phone, id)
