"""Application rules that more than one use case applies. They only go through the ports."""
from __future__ import annotations

from typing import Any, Iterable

from .domain.errors import NotFound, ValidationError
from .domain.models import EXPENSE_CATEGORIES, Expense, House
from .ports import Repository

MAX_HOUSES = 500
MAX_EXPENSES_PER_HOUSE = 2000


def get_house(repo: Repository, owner: str, id: Any) -> House:
    house = repo.get_house(owner, id) if isinstance(id, str) else None
    if house is None:
        raise NotFound("casa não encontrada")
    return house


def get_expense(repo: Repository, owner: str, house_id: Any, id: Any) -> Expense:
    get_house(repo, owner, house_id)
    expense = repo.get_expense(owner, house_id, id) if isinstance(id, str) else None
    if expense is None:
        raise NotFound("custo não encontrado")
    return expense


def check_house_limit(repo: Repository, owner: str) -> None:
    if len(repo.list_houses(owner)) >= MAX_HOUSES:
        raise ValidationError(f"limite de {MAX_HOUSES} casas atingido")


def check_expense_limit(repo: Repository, owner: str, house_id: str) -> None:
    if len(repo.list_expenses(owner, house_id)) >= MAX_EXPENSES_PER_HOUSE:
        raise ValidationError(f"limite de {MAX_EXPENSES_PER_HOUSE} custos nesta casa atingido")


def sorted_houses(houses: Iterable[House]) -> list[House]:
    return sorted(houses, key=lambda h: (h.name.lower(), h.id))


def sorted_expenses(expenses: Iterable[Expense]) -> list[Expense]:
    """Newest first."""
    return sorted(expenses, key=lambda e: (e.date, e.id), reverse=True)


def totals(house: House, expenses: Iterable[Expense]) -> dict[str, Any]:
    """What a house cost: the purchase (price + its costs), the renovation (by category) and the sum."""
    by_category = dict.fromkeys(EXPENSE_CATEGORIES, 0)
    count = 0
    for e in expenses:
        by_category[e.category] += e.amount_cents
        count += 1
    renovation = sum(by_category.values())
    return {"purchase_cents": house.purchase_total_cents, "renovation_cents": renovation,
            "total_cents": house.purchase_total_cents + renovation, "expense_count": count,
            "by_category": by_category}
