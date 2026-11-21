"""Use case (application layer): deletes an installment.
Returns the house's page (application.house_view), so the screen redraws without another request.
Depends only on the core's domain and ports, never on AWS."""
from __future__ import annotations

from typing import Any

from houses_core.application import get_house, get_installment, house_view
from houses_core.ports import Dependencies


def delete_installment(deps: Dependencies, owner: str, house_id: str, id: str) -> dict[str, Any]:
    get_installment(deps.repo, owner, house_id, id)
    deps.repo.delete_installments(owner, house_id, [id])
    return house_view(deps.repo, owner, get_house(deps.repo, owner, house_id))
