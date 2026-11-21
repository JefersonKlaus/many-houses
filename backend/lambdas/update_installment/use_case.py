"""Use case (application layer): changes an installment: due date, amount and when it was paid (empty = not
paid yet). Returns the house's page (application.house_view), so the screen redraws without another request.
Depends only on the core's domain and ports, never on AWS."""
from __future__ import annotations

from typing import Any, Mapping

from houses_core.application import get_house, get_installment, house_view
from houses_core.domain.models import Installment
from houses_core.ports import Dependencies


def update_installment(deps: Dependencies, owner: str, house_id: str, id: str,
                       payload: Mapping[str, Any]) -> dict[str, Any]:
    get_installment(deps.repo, owner, house_id, id)
    deps.repo.save_installments(owner, [Installment.from_input(payload, house_id, id)])
    return house_view(deps.repo, owner, get_house(deps.repo, owner, house_id))
