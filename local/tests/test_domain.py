import pytest

from conftest import expense_input, house_input
from houses_core.application import totals
from houses_core.domain.errors import ValidationError
from houses_core.domain.models import MAX_AMOUNT_CENTS, Expense, House


def test_house_from_input_cleans_and_defaults():
    house = House.from_input(house_input(name="  Casa   Azul ", purchase_costs_cents=None))
    assert house.name == "Casa Azul"
    assert house.purchase_costs_cents == 0 and house.status == "renovating" and house.notes == ""
    assert house.purchase_total_cents == 30_000_000
    assert House.from_dict(house.to_dict()) == house


def test_house_notes_keep_their_lines():
    assert House.from_input(house_input(notes="linha 1\nlinha 2")).notes == "linha 1\nlinha 2"


@pytest.mark.parametrize("change, message", [
    ({"name": ""}, "nome"), ({"name": "x" * 81}, "nome"), ({"address": None}, "endereço"),
    ({"purchase_date": "10/01/2026"}, "data da compra"), ({"purchase_date": "2026-02-30"}, "não existe"),
    ({"purchase_price_cents": -1}, "valor da compra"), ({"purchase_price_cents": 10.5}, "valor da compra"),
    ({"purchase_price_cents": True}, "valor da compra"), ({"purchase_price_cents": MAX_AMOUNT_CENTS + 1}, "valor"),
    ({"purchase_costs_cents": "100"}, "custos da compra"), ({"status": "demolished"}, "situação"),
])
def test_invalid_house(change, message):
    with pytest.raises(ValidationError, match=message):
        House.from_input(house_input(**change))


def test_expense_from_input():
    expense = Expense.from_input(expense_input(supplier=None), "abcd1234")
    assert expense.house_id == "abcd1234" and expense.supplier == "" and expense.amount_cents == 150_000
    assert Expense.from_dict(expense.to_dict()) == expense


@pytest.mark.parametrize("change, message", [
    ({"amount_cents": 0}, "valor"), ({"category": "food"}, "categoria"), ({"category": None}, "categoria"),
    ({"description": " "}, "descrição"), ({"date": ""}, "data"),
])
def test_invalid_expense(change, message):
    with pytest.raises(ValidationError, match=message):
        Expense.from_input(expense_input(**change), "abcd1234")


def test_totals_add_up_by_category():
    house = House.from_input(house_input())
    expenses = [Expense.from_input(expense_input(amount_cents=100), house.id),
                Expense.from_input(expense_input(amount_cents=250), house.id),
                Expense.from_input(expense_input(category="labor", amount_cents=1000), house.id)]
    result = totals(house, expenses)
    assert result["purchase_cents"] == 31_800_000
    assert result["renovation_cents"] == 1350
    assert result["total_cents"] == 31_801_350
    assert result["expense_count"] == 3
    assert result["by_category"] == {"material": 350, "labor": 1000, "services": 0, "project": 0, "other": 0}
