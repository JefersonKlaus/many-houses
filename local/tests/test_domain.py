import pytest

from conftest import expense_input, house_input, plan_input
from houses_core.application import totals
from houses_core.domain.errors import ValidationError
from houses_core.domain.models import MAX_AMOUNT_CENTS, Expense, House, Installment, add_months


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
    ({"down_payment_cents": -1}, "entrada"), ({"down_payment_cents": 30_000_001}, "maior que o valor do imóvel"),
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


def test_house_down_payment():
    house = House.from_input(house_input(down_payment_cents=6_000_000))
    assert house.down_payment_cents == 6_000_000 and House.from_dict(house.to_dict()) == house
    assert House.from_input(house_input()).down_payment_cents == 0
    old = {k: v for k, v in house.to_dict().items() if k != "down_payment_cents"}   # saved before the field existed
    assert House.from_dict(old).down_payment_cents == 0


@pytest.mark.parametrize("start, months, expected", [
    ("2026-01-15", 1, "2026-02-15"), ("2026-01-31", 1, "2026-02-28"), ("2028-01-31", 1, "2028-02-29"),
    ("2026-11-30", 2, "2027-01-30"), ("2026-12-31", 12, "2027-12-31"), ("2026-05-31", 0, "2026-05-31"),
])
def test_add_months_keeps_the_day_or_the_months_last_day(start, months, expected):
    assert add_months(start, months) == expected


def test_installment_plan():
    plan = Installment.plan(plan_input(first_due_date="2026-12-10", count=3), "abcd1234")
    assert [i.due_date for i in plan] == ["2026-12-10", "2027-01-10", "2027-02-10"]
    assert {i.amount_cents for i in plan} == {250_000} and not any(i.paid for i in plan)
    assert len({i.id for i in plan}) == 3
    assert Installment.from_dict(plan[0].to_dict()) == plan[0]


@pytest.mark.parametrize("change, message", [
    ({"count": 0}, "quantidade"), ({"count": 601}, "quantidade"), ({"count": "3"}, "quantidade"),
    ({"count": True}, "quantidade"), ({"amount_cents": 0}, "valor"), ({"first_due_date": "x"}, "primeiro vencimento"),
])
def test_invalid_installment_plan(change, message):
    with pytest.raises(ValidationError, match=message):
        Installment.plan(plan_input(**change), "abcd1234")


def test_installment_from_input_paid_or_not():
    base = {"due_date": "2026-03-10", "amount_cents": 500}
    assert Installment.from_input(base, "abcd1234").paid_date == ""
    assert Installment.from_input({**base, "paid_date": None}, "abcd1234").paid is False
    assert Installment.from_input({**base, "paid_date": "2026-03-09"}, "abcd1234").paid is True
    with pytest.raises(ValidationError, match="data do pagamento"):
        Installment.from_input({**base, "paid_date": "ontem"}, "abcd1234")
    with pytest.raises(ValidationError, match="vencimento"):
        Installment.from_input({**base, "due_date": ""}, "abcd1234")
