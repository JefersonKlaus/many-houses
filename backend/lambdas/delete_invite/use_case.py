"""Use case (application layer): cancels an invite that was not answered yet. Only the house's owner can.
Answers the house's page (application.house_view).
Depends only on the core's domain and ports, never on AWS."""
from __future__ import annotations

from dataclasses import replace
from typing import Any

from houses_core.application import Access, house_access, house_view, require_owner
from houses_core.domain.errors import NotFound
from houses_core.ports import Dependencies


def delete_invite(deps: Dependencies, user: str, house_id: str, id: str) -> dict[str, Any]:
    access = house_access(deps.repo, user, house_id)
    require_owner(access, "cancelar convites")
    invite = next((i for i in access.house.invites if i.id == id), None)
    if invite is None:
        raise NotFound("convite não encontrado")
    house = replace(access.house, invites=tuple(i for i in access.house.invites if i.id != id))
    deps.repo.save_house(user, house)
    deps.repo.delete_pending_invite(invite.phone, id)
    return house_view(deps.repo, Access(user, house, access.member_id))
