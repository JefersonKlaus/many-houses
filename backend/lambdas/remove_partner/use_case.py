"""Use case (application layer): removes a partner from a house. Any other partner can, while nothing paid is
registered for that partner (costs, installments or a share of the purchase). Whoever
registered the house can't be removed: the house is kept in their data.
Answers the house's page (application.house_view).
Depends only on the core's domain and ports, never on AWS."""
from __future__ import annotations

from dataclasses import replace
from typing import Any

from houses_core.application import Access, house_access, house_view
from houses_core.domain.errors import NotFound, ValidationError
from houses_core.ports import Dependencies


def remove_partner(deps: Dependencies, user: str, house_id: str, id: str) -> dict[str, Any]:
    access = house_access(deps.repo, user, house_id)
    owner, house = access.owner, access.house
    partner = next((p for p in house.partners if p.id == id), None)
    if partner is None:
        raise NotFound("sócio não encontrado")
    if id == access.member_id:
        raise ValidationError("você não pode remover a si mesmo: peça a outro sócio")
    paid = (any(e.paid_by == id for e in deps.repo.list_expenses(owner, house_id))
            or any(i.paid_by == id for i in deps.repo.list_installments(owner, house_id))
            or any(s.member_id == id for s in house.purchase_shares))
    if paid:
        raise ValidationError("esse sócio tem pagamentos lançados: passe-os para outro sócio antes de removê-lo")
    house = replace(house, partners=tuple(p for p in house.partners if p.id != id))
    deps.repo.save_house(owner, house)
    deps.repo.delete_link(partner.user, house_id)
    return house_view(deps, Access(owner, house, access.member_id))
