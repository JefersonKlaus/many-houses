"""Use case (application layer): deletes a house with everything in it: its costs, its installments, its
partners' links and its pending invites. Any partner can: it is gone for all of them.
Depends only on the core's domain and ports, never on AWS."""
from __future__ import annotations

from houses_core.application import house_access
from houses_core.ports import Dependencies


def delete_house(deps: Dependencies, user: str, id: str) -> None:
    access = house_access(deps.repo, user, id)
    owner, house = access.owner, access.house
    for expense in deps.repo.list_expenses(owner, id):     # what belongs to it first: no orphan is ever left
        deps.repo.delete_expense(owner, id, expense.id)
    deps.repo.delete_installments(owner, id, [i.id for i in deps.repo.list_installments(owner, id)])
    for partner in house.partners:
        deps.repo.delete_link(partner.user, id)
    for invite in house.invites:
        deps.repo.delete_pending_invite(invite.phone, invite.id)
    deps.repo.delete_house(owner, id)
