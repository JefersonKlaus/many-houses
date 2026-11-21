"""Application rules that more than one use case applies. They only go through the ports."""
from __future__ import annotations

from typing import Any, Iterable

from .domain.errors import NotFound, ValidationError
from .domain.models import EXPENSE_CATEGORIES, Expense, House, Installment
from .ports import Repository

MAX_HOUSES = 500
MAX_EXPENSES_PER_HOUSE = 2000
MAX_INSTALLMENTS_PER_HOUSE = 600


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


def get_installment(repo: Repository, owner: str, house_id: Any, id: Any) -> Installment:
    get_house(repo, owner, house_id)
    installment = repo.get_installment(owner, house_id, id) if isinstance(id, str) else None
    if installment is None:
        raise NotFound("prestação não encontrada")
    return installment


def check_house_limit(repo: Repository, owner: str) -> None:
    if len(repo.list_houses(owner)) >= MAX_HOUSES:
        raise ValidationError(f"limite de {MAX_HOUSES} casas atingido")


def check_expense_limit(repo: Repository, owner: str, house_id: str) -> None:
    if len(repo.list_expenses(owner, house_id)) >= MAX_EXPENSES_PER_HOUSE:
        raise ValidationError(f"limite de {MAX_EXPENSES_PER_HOUSE} custos nesta casa atingido")


def check_expense_area(house: House, expense: Expense) -> None:
    if expense.area_id and expense.area_id not in {a.id for a in house.areas}:
        raise ValidationError("área: escolha uma das áreas da casa")


def check_removed_areas_have_no_costs(repo: Repository, owner: str, before: House, after: House) -> None:
    """An area can only leave the house when no cost is linked to it (they would lose their area)."""
    kept = {a.id for a in after.areas}
    removed = {a.id: a.name for a in before.areas if a.id not in kept}
    if not removed:
        return
    used = {e.area_id for e in repo.list_expenses(owner, before.id)}
    for area_id, name in removed.items():
        if area_id in used:
            raise ValidationError(f"área \"{name}\" tem custos lançados: mude esses custos de área antes de removê-la")


def check_bought_in_installments(house: House) -> None:
    if house.payment_type != "installments":
        raise ValidationError("esta casa foi comprada à vista: mude a forma de pagamento para parcelado")


def check_installment_limit(repo: Repository, owner: str, house_id: str, adding: int) -> None:
    if len(repo.list_installments(owner, house_id)) + adding > MAX_INSTALLMENTS_PER_HOUSE:
        raise ValidationError(f"limite de {MAX_INSTALLMENTS_PER_HOUSE} prestações nesta casa")


def sorted_houses(houses: Iterable[House]) -> list[House]:
    return sorted(houses, key=lambda h: (h.name.lower(), h.id))


def sorted_expenses(expenses: Iterable[Expense]) -> list[Expense]:
    """Newest first."""
    return sorted(expenses, key=lambda e: (e.date, e.id), reverse=True)


def sorted_installments(installments: Iterable[Installment]) -> list[Installment]:
    """In the order they are due."""
    return sorted(installments, key=lambda i: (i.due_date, i.id))


def totals(house: House, expenses: Iterable[Expense], installments: Iterable[Installment] = ()) -> dict[str, Any]:
    """What a house cost: the purchase (price + its costs), the renovation (by category and by area)
    and the sum. `payment`: how the price is being paid, the entrada plus the installments paid and open.
    `by_area`: each of the house's areas, in its order, with its costs; `no_area_cents`: costs with no area."""
    by_category = dict.fromkeys(EXPENSE_CATEGORIES, 0)
    by_area = {a.id: {"id": a.id, "name": a.name, "cents": 0, "count": 0} for a in house.areas}
    no_area = count = 0
    for e in expenses:
        by_category[e.category] += e.amount_cents
        count += 1
        if e.area_id in by_area:
            by_area[e.area_id]["cents"] += e.amount_cents
            by_area[e.area_id]["count"] += 1
        else:
            no_area += e.amount_cents
    renovation = sum(by_category.values())
    return {"purchase_cents": house.purchase_total_cents, "renovation_cents": renovation,
            "total_cents": house.purchase_total_cents + renovation, "expense_count": count,
            "by_category": by_category, "by_area": list(by_area.values()), "no_area_cents": no_area,
            "payment": payment(house, installments),
            "sale": sale(house, house.purchase_total_cents + renovation)}


def sale(house: House, invested_cents: int) -> dict[str, Any]:
    """For how much to sell the house today, as it is, to make the profit wanted: what was invested
    so far (purchase + renovation) plus that percentage of it."""
    profit = round(invested_cents * house.target_profit_percent / 100)
    return {"target_profit_percent": house.target_profit_percent, "target_profit_cents": profit,
            "suggested_price_cents": invested_cents + profit}


def payment(house: House, installments: Iterable[Installment]) -> dict[str, Any]:
    installments = list(installments)
    paid = [i for i in installments if i.paid]
    open_ = sorted_installments(i for i in installments if not i.paid)
    paid_cents = sum(i.amount_cents for i in paid)
    return {"down_payment_cents": house.down_payment_cents,
            "installments_count": len(installments), "installments_cents": sum(i.amount_cents for i in installments),
            "paid_count": len(paid), "paid_cents": paid_cents, "open_cents": sum(i.amount_cents for i in open_),
            "next_due_date": open_[0].due_date if open_ else None,
            "total_paid_cents": house.down_payment_cents + paid_cents}


def house_view(repo: Repository, owner: str, house: House) -> dict[str, Any]:
    """One house's page: the house, its costs (newest first), its installments (in due order) and the totals.
    GET /houses/{id} answers this, and so does every change to a house, so the screen redraws at once,
    without a second request."""
    expenses = sorted_expenses(repo.list_expenses(owner, house.id))
    installments = sorted_installments(repo.list_installments(owner, house.id))
    return {"house": house.to_dict(), "expenses": [e.to_dict() for e in expenses],
            "installments": [i.to_dict() for i in installments],
            "totals": totals(house, expenses, installments)}
