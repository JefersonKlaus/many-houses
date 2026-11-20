"""Use case (application layer): deletes a renovation cost of a house.
Depends only on the core's domain and ports, never on AWS."""
from __future__ import annotations

from houses_core.application import get_expense
from houses_core.ports import Dependencies


def delete_expense(deps: Dependencies, owner: str, house_id: str, id: str) -> None:
    get_expense(deps.repo, owner, house_id, id)
    deps.repo.delete_expense(owner, house_id, id)
