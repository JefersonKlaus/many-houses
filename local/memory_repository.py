"""In-memory repository: used in tests and to run without AWS. Never deployed (the Lambdas use DynamoDB)."""
from __future__ import annotations

import threading
from typing import Any, Optional

from houses_core.domain.models import Expense, House, Installment, PendingInvite, TimelineEntry


class MemoryRepository:
    def __init__(self) -> None:
        self._data: dict[str, dict[str, Any]] = {}
        self._lock = threading.Lock()       # the local server answers several requests at once
        self._invites: dict[str, dict[str, PendingInvite]] = {}     # phone -> invite id -> invite

    def _owner(self, owner: str) -> dict[str, Any]:
        with self._lock:
            return self._data.setdefault(owner, {"houses": {}, "expenses": {}, "installments": {}, "links": {}, "timeline": {}})

    def list_houses(self, owner: str) -> list[House]:
        return list(self._owner(owner)["houses"].values())

    def get_house(self, owner: str, id: str) -> Optional[House]:
        return self._owner(owner)["houses"].get(id)

    def save_house(self, owner: str, house: House) -> None:
        self._owner(owner)["houses"][house.id] = house

    def delete_house(self, owner: str, id: str) -> None:
        self._owner(owner)["houses"].pop(id, None)

    def list_expenses(self, owner: str, house_id: Optional[str] = None) -> list[Expense]:
        return [e for e in list(self._owner(owner)["expenses"].values()) if house_id is None or e.house_id == house_id]

    def get_expense(self, owner: str, house_id: str, id: str) -> Optional[Expense]:
        return self._owner(owner)["expenses"].get((house_id, id))

    def save_expense(self, owner: str, expense: Expense) -> None:
        self._owner(owner)["expenses"][(expense.house_id, expense.id)] = expense

    def delete_expense(self, owner: str, house_id: str, id: str) -> None:
        self._owner(owner)["expenses"].pop((house_id, id), None)

    def list_installments(self, owner: str, house_id: Optional[str] = None) -> list[Installment]:
        return [i for i in list(self._owner(owner)["installments"].values()) if house_id is None or i.house_id == house_id]

    def get_installment(self, owner: str, house_id: str, id: str) -> Optional[Installment]:
        return self._owner(owner)["installments"].get((house_id, id))

    def save_installments(self, owner: str, installments: list[Installment]) -> None:
        for i in installments:
            self._owner(owner)["installments"][(i.house_id, i.id)] = i

    def delete_installments(self, owner: str, house_id: str, ids: list[str]) -> None:
        for id in ids:
            self._owner(owner)["installments"].pop((house_id, id), None)

    def save_link(self, user: str, owner: str, house_id: str) -> None:
        self._owner(user)["links"][house_id] = owner

    def get_link(self, user: str, house_id: str) -> Optional[str]:
        return self._owner(user)["links"].get(house_id)

    def list_links(self, user: str) -> list[tuple[str, str]]:
        return [(owner, house_id) for house_id, owner in list(self._owner(user)["links"].items())]

    def delete_link(self, user: str, house_id: str) -> None:
        self._owner(user)["links"].pop(house_id, None)

    def save_pending_invite(self, invite: PendingInvite) -> None:
        with self._lock:
            self._invites.setdefault(invite.phone, {})[invite.id] = invite

    def list_pending_invites(self, phone: str) -> list[PendingInvite]:
        return list(self._invites.get(phone, {}).values())

    def get_pending_invite(self, phone: str, id: str) -> Optional[PendingInvite]:
        return self._invites.get(phone, {}).get(id)

    def delete_pending_invite(self, phone: str, id: str) -> None:
        self._invites.get(phone, {}).pop(id, None)

    def list_timeline(self, owner: str, house_id: str) -> list[TimelineEntry]:
        return [e for e in list(self._owner(owner)["timeline"].values()) if e.house_id == house_id]

    def get_timeline_entry(self, owner: str, house_id: str, id: str) -> Optional[TimelineEntry]:
        return self._owner(owner)["timeline"].get((house_id, id))

    def save_timeline_entry(self, owner: str, entry: TimelineEntry) -> None:
        self._owner(owner)["timeline"][(entry.house_id, entry.id)] = entry

    def delete_timeline_entry(self, owner: str, house_id: str, id: str) -> None:
        self._owner(owner)["timeline"].pop((house_id, id), None)
