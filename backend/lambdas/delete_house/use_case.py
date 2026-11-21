"""Use case (application layer): deletes a house, its renovation costs and its installments.
Depends only on the core's domain and ports, never on AWS."""
from __future__ import annotations

from houses_core.application import get_house
from houses_core.ports import Dependencies


def delete_house(deps: Dependencies, owner: str, id: str) -> None:
    get_house(deps.repo, owner, id)
    for expense in deps.repo.list_expenses(owner, id):     # what belongs to it first: no orphan is ever left
        deps.repo.delete_expense(owner, id, expense.id)
    deps.repo.delete_installments(owner, id, [i.id for i in deps.repo.list_installments(owner, id)])
    deps.repo.delete_house(owner, id)
