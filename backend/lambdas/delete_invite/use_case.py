"""Use case (application layer): cancels an invite that was not answered yet, while nothing paid is
registered for the guest. Only the house's owner can.
Answers the house's page (application.house_view).
Depends only on the core's domain and ports, never on AWS."""
from __future__ import annotations

from dataclasses import replace
from typing import Any

from houses_core.application import Access, house_access, house_view, require_owner
from houses_core.domain.errors import NotFound, ValidationError
from houses_core.ports import Dependencies


def delete_invite(deps: Dependencies, user: str, house_id: str, id: str) -> dict[str, Any]:
    access = house_access(deps.repo, user, house_id)
    require_owner(access, "cancelar convites")
    invite = next((i for i in access.house.invites if i.id == id), None)
    if invite is None:
        raise NotFound("convite não encontrado")
    paid = (any(s.member_id == id for s in access.house.purchase_shares)
            or any(e.paid_by == id for e in deps.repo.list_expenses(user, house_id))
            or any(i.paid_by == id for i in deps.repo.list_installments(user, house_id)))
    if paid:
        raise ValidationError("esse convidado tem pagamentos lançados (como a parte dele na compra): "
                              "o convite não pode ser cancelado")
    house = replace(access.house, invites=tuple(i for i in access.house.invites if i.id != id))
    deps.repo.save_house(user, house)
    deps.repo.delete_pending_invite(invite.phone, id)
    return house_view(deps.repo, Access(user, house, access.member_id))
