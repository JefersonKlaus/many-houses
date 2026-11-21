"""Use case (application layer): deletes an installment. The user is the house's owner or one of its partners (application.house_access). Answers the house's page (application.house_view).
Depends only on the core's domain and ports, never on AWS."""
from __future__ import annotations

from typing import Any

from houses_core.application import get_installment, house_access, house_view
from houses_core.ports import Dependencies


def delete_installment(deps: Dependencies, user: str, house_id: str, id: str) -> dict[str, Any]:
    access = house_access(deps.repo, user, house_id)
    get_installment(deps.repo, access, id)
    deps.repo.delete_installments(access.owner, house_id, [id])
    return house_view(deps, access)
