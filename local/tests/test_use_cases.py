"""The Lambdas' use cases, called directly (no HTTP), against both repositories (conftest.repo)."""
import pytest

from conftest import OTHER, OWNER, expense_input, house_input
from create_expense.use_case import create_expense
from create_house.use_case import create_house
from delete_expense.use_case import delete_expense
from delete_house.use_case import delete_house
from get_house.use_case import get_house
from houses_core import application
from houses_core.domain.errors import NotFound, ValidationError
from list_houses.use_case import list_houses
from update_expense.use_case import update_expense
from update_house.use_case import update_house


def test_house_with_its_costs(deps):
    house = create_house(deps, OWNER, house_input())
    create_expense(deps, OWNER, house.id, expense_input(date="2026-02-01", amount_cents=1000))
    newest = create_expense(deps, OWNER, house.id, expense_input(date="2026-03-01", category="labor", amount_cents=500))
    found = get_house(deps, OWNER, house.id)
    assert found["house"]["name"] == "Casa Azul"
    assert [e["id"] for e in found["expenses"]][0] == newest.id                  # newest first
    assert found["totals"]["renovation_cents"] == 1500
    assert found["totals"]["total_cents"] == 31_800_000 + 1500
    assert found["totals"]["by_category"]["labor"] == 500


def test_list_houses_by_name_with_their_totals(deps):
    b = create_house(deps, OWNER, house_input(name="Bela Vista"))
    a = create_house(deps, OWNER, house_input(name="apartamento 12", purchase_costs_cents=0))
    create_expense(deps, OWNER, b.id, expense_input(amount_cents=700))
    create_expense(deps, OWNER, b.id, expense_input(amount_cents=300))
    create_expense(deps, OWNER, a.id, expense_input(amount_cents=5))
    houses = list_houses(deps, OWNER)
    assert [h["name"] for h in houses] == ["apartamento 12", "Bela Vista"]
    assert houses[0]["totals"]["renovation_cents"] == 5 and houses[0]["totals"]["purchase_cents"] == 30_000_000
    assert houses[1]["totals"]["renovation_cents"] == 1000 and houses[1]["totals"]["expense_count"] == 2


def test_update_house_keeps_its_costs(deps):
    house = create_house(deps, OWNER, house_input())
    create_expense(deps, OWNER, house.id, expense_input())
    updated = update_house(deps, OWNER, house.id, house_input(name="Casa Verde", status="sold"))
    assert updated.id == house.id and updated.status == "sold"
    assert get_house(deps, OWNER, house.id)["totals"]["expense_count"] == 1


def test_delete_house_deletes_its_costs_only(deps):
    house = create_house(deps, OWNER, house_input())
    other = create_house(deps, OWNER, house_input(name="Outra"))
    for _ in range(3):
        create_expense(deps, OWNER, house.id, expense_input())
    create_expense(deps, OWNER, other.id, expense_input())
    delete_house(deps, OWNER, house.id)
    assert [h["name"] for h in list_houses(deps, OWNER)] == ["Outra"]
    assert [e.house_id for e in deps.repo.list_expenses(OWNER)] == [other.id]
    with pytest.raises(NotFound):
        delete_house(deps, OWNER, house.id)


def test_update_and_delete_expense(deps):
    house = create_house(deps, OWNER, house_input())
    expense = create_expense(deps, OWNER, house.id, expense_input())
    changed = update_expense(deps, OWNER, house.id, expense.id, expense_input(description="Areia", amount_cents=99))
    assert changed.id == expense.id and changed.description == "Areia"
    assert get_house(deps, OWNER, house.id)["totals"]["renovation_cents"] == 99
    delete_expense(deps, OWNER, house.id, expense.id)
    assert get_house(deps, OWNER, house.id)["expenses"] == []
    with pytest.raises(NotFound):
        delete_expense(deps, OWNER, house.id, expense.id)


def test_an_expense_belongs_to_its_house(deps):
    house = create_house(deps, OWNER, house_input())
    other = create_house(deps, OWNER, house_input(name="Outra"))
    expense = create_expense(deps, OWNER, house.id, expense_input())
    with pytest.raises(NotFound):
        update_expense(deps, OWNER, other.id, expense.id, expense_input())
    with pytest.raises(NotFound):
        create_expense(deps, OWNER, "00000000", expense_input())


def test_owners_never_see_each_other(deps):
    house = create_house(deps, OWNER, house_input())
    expense = create_expense(deps, OWNER, house.id, expense_input())
    assert list_houses(deps, OTHER) == []
    for call in (lambda: get_house(deps, OTHER, house.id),
                 lambda: update_house(deps, OTHER, house.id, house_input()),
                 lambda: delete_house(deps, OTHER, house.id),
                 lambda: create_expense(deps, OTHER, house.id, expense_input()),
                 lambda: delete_expense(deps, OTHER, house.id, expense.id)):
        with pytest.raises(NotFound):
            call()
    assert get_house(deps, OWNER, house.id)["totals"]["expense_count"] == 1


def test_limits(deps, monkeypatch):
    monkeypatch.setattr(application, "MAX_HOUSES", 1)
    monkeypatch.setattr(application, "MAX_EXPENSES_PER_HOUSE", 1)
    house = create_house(deps, OWNER, house_input())
    with pytest.raises(ValidationError, match="limite"):
        create_house(deps, OWNER, house_input())
    create_expense(deps, OWNER, house.id, expense_input())
    with pytest.raises(ValidationError, match="limite"):
        create_expense(deps, OWNER, house.id, expense_input())


def test_invalid_input_writes_nothing(deps):
    with pytest.raises(ValidationError):
        create_house(deps, OWNER, house_input(purchase_price_cents=-5))
    assert list_houses(deps, OWNER) == []
