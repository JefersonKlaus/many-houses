"""Use case (application layer): deletes a renovation cost and its photos. The user is the house's owner or one of its partners (application.house_access). Answers the house's page (application.house_view).
Depends only on the core's domain and ports, never on AWS."""
from __future__ import annotations

from typing import Any

from houses_core.application import delete_photos, get_expense, house_access, house_view
from houses_core.ports import Dependencies


def delete_expense(deps: Dependencies, user: str, house_id: str, id: str) -> dict[str, Any]:
    access = house_access(deps.repo, user, house_id)
    expense = get_expense(deps.repo, access, id)
    deps.repo.delete_expense(access.owner, house_id, id)
    delete_photos(deps, access, expense.photos)
    return house_view(deps, access)
