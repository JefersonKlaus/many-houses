"""Ports: what the use cases need from the outside world, without knowing how it is done.
adapters/dynamo_repository.py implements Repository in AWS; local/memory_repository.py, locally."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Protocol

from .domain.models import Expense, House, Installment


class Repository(Protocol):
    """Every owner's data. `owner` is the user's id, always taken from the login token."""

    def list_houses(self, owner: str) -> list[House]: ...
    def get_house(self, owner: str, id: str) -> Optional[House]: ...
    def save_house(self, owner: str, house: House) -> None: ...
    def delete_house(self, owner: str, id: str) -> None: ...

    def list_expenses(self, owner: str, house_id: Optional[str] = None) -> list[Expense]:
        """One house's renovation costs; with no house, every house's."""
    def get_expense(self, owner: str, house_id: str, id: str) -> Optional[Expense]: ...
    def save_expense(self, owner: str, expense: Expense) -> None: ...
    def delete_expense(self, owner: str, house_id: str, id: str) -> None: ...

    def list_installments(self, owner: str, house_id: Optional[str] = None) -> list[Installment]:
        """One house's installments (prestações); with no house, every house's."""
    def get_installment(self, owner: str, house_id: str, id: str) -> Optional[Installment]: ...
    def save_installments(self, owner: str, installments: list[Installment]) -> None:
        """Saves many at once (a whole payment plan): one call, not one per installment."""
    def delete_installments(self, owner: str, house_id: str, ids: list[str]) -> None: ...


@dataclass(frozen=True)
class Dependencies:
    """What every use case receives: the ports, already plugged into their adapters."""
    repo: Repository
