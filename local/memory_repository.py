"""In-memory repository: used in tests and to run without AWS. Never deployed (the Lambdas use DynamoDB)."""
from __future__ import annotations

import threading
from typing import Any, Optional

from houses_core.domain.models import Expense, House


class MemoryRepository:
    def __init__(self) -> None:
        self._data: dict[str, dict[str, Any]] = {}
        self._lock = threading.Lock()       # the local server answers several requests at once

    def _owner(self, owner: str) -> dict[str, Any]:
        with self._lock:
            return self._data.setdefault(owner, {"houses": {}, "expenses": {}})

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
