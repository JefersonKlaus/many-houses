"""Use case (application layer): the invites waiting for the user's answer: the ones sent to the phone of their login,
oldest first. A login with no phone has none.
Depends only on the core's domain and ports, never on AWS."""
from __future__ import annotations

from typing import Any

from houses_core.ports import Dependencies


def list_invites(deps: Dependencies, user: str, phone: str) -> list[dict[str, Any]]:
    if not phone:
        return []
    invites = sorted(deps.repo.list_pending_invites(phone), key=lambda i: (i.date, i.id))
    return [{"id": i.id, "house_name": i.house_name, "from_phone": i.from_phone, "date": i.date}
            for i in invites if i.owner != user]
