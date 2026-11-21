"""The Lambdas' use cases, called directly (no HTTP), against both repositories (conftest.repo).
Every change to a house answers the house's page (application.house_view), like GET /houses/{id}."""
import pytest

from conftest import OTHER, OWNER, expense_input, house_input, plan_input
from create_expense.use_case import create_expense
from create_house.use_case import create_house
from create_installments.use_case import create_installments
from delete_expense.use_case import delete_expense
from delete_house.use_case import delete_house
from delete_installment.use_case import delete_installment
from get_house.use_case import get_house
from houses_core import application
from houses_core.domain.errors import NotFound, ValidationError
from list_houses.use_case import list_houses
from update_expense.use_case import update_expense
from update_house.use_case import update_house
from update_installment.use_case import update_installment


def new_house(deps, **extra):
    return create_house(deps, OWNER, house_input(**extra))["house"]["id"]


def new_expense(deps, house_id, **extra):
    """Creates a cost and returns its id: the one id the house's page did not have before."""
    before = {e["id"] for e in get_house(deps, OWNER, house_id)["expenses"]}
    view = create_expense(deps, OWNER, house_id, expense_input(**extra))
    (added,) = {e["id"] for e in view["expenses"]} - before
    return added


def test_every_change_answers_the_house_page(deps):
    view = create_house(deps, OWNER, house_input())
    hid = view["house"]["id"]
    assert view == get_house(deps, OWNER, hid)
    assert view["expenses"] == [] and view["installments"] == []
    for change in (lambda: update_house(deps, OWNER, hid, house_input(name="Nova")),
                   lambda: create_expense(deps, OWNER, hid, expense_input()),
                   lambda: create_installments(deps, OWNER, hid, plan_input())):
        assert change() == get_house(deps, OWNER, hid)


def test_house_with_its_costs(deps):
    hid = new_house(deps)
    new_expense(deps, hid, date="2026-02-01", amount_cents=1000)
    newest = new_expense(deps, hid, date="2026-03-01", category="labor", amount_cents=500)
    found = get_house(deps, OWNER, hid)
    assert found["house"]["name"] == "Casa Azul"
    assert [e["id"] for e in found["expenses"]][0] == newest                    # newest first
    assert found["totals"]["renovation_cents"] == 1500
    assert found["totals"]["total_cents"] == 31_800_000 + 1500
    assert found["totals"]["by_category"]["labor"] == 500


def test_list_houses_by_name_with_their_totals(deps):
    b = new_house(deps, name="Bela Vista")
    a = new_house(deps, name="apartamento 12", purchase_costs_cents=0)
    new_expense(deps, b, amount_cents=700)
    new_expense(deps, b, amount_cents=300)
    new_expense(deps, a, amount_cents=5)
    create_installments(deps, OWNER, a, plan_input(count=2, amount_cents=100))
    houses = list_houses(deps, OWNER)
    assert [h["name"] for h in houses] == ["apartamento 12", "Bela Vista"]
    assert houses[0]["totals"]["renovation_cents"] == 5 and houses[0]["totals"]["purchase_cents"] == 30_000_000
    assert houses[0]["totals"]["payment"]["installments_count"] == 2
    assert houses[1]["totals"]["renovation_cents"] == 1000 and houses[1]["totals"]["expense_count"] == 2
    assert houses[1]["totals"]["payment"]["installments_count"] == 0


def test_update_house_keeps_its_costs_and_installments(deps):
    hid = new_house(deps)
    new_expense(deps, hid)
    create_installments(deps, OWNER, hid, plan_input())
    view = update_house(deps, OWNER, hid, house_input(name="Casa Verde", status="sold"))
    assert view["house"]["id"] == hid and view["house"]["status"] == "sold"
    assert view["totals"]["expense_count"] == 1 and len(view["installments"]) == 3


def test_delete_house_deletes_what_is_its_only(deps):
    hid = new_house(deps)
    other = new_house(deps, name="Outra")
    for _ in range(3):
        new_expense(deps, hid)
    new_expense(deps, other)
    create_installments(deps, OWNER, hid, plan_input(count=30))         # more than one batch of 25
    create_installments(deps, OWNER, other, plan_input(count=1))
    delete_house(deps, OWNER, hid)
    assert [h["name"] for h in list_houses(deps, OWNER)] == ["Outra"]
    assert [e.house_id for e in deps.repo.list_expenses(OWNER)] == [other]
    assert [i.house_id for i in deps.repo.list_installments(OWNER)] == [other]
    with pytest.raises(NotFound):
        delete_house(deps, OWNER, hid)


def test_update_and_delete_expense(deps):
    hid = new_house(deps)
    eid = new_expense(deps, hid)
    view = update_expense(deps, OWNER, hid, eid, expense_input(description="Areia", amount_cents=99))
    assert [(e["id"], e["description"]) for e in view["expenses"]] == [(eid, "Areia")]
    assert view["totals"]["renovation_cents"] == 99
    assert delete_expense(deps, OWNER, hid, eid)["expenses"] == []
    with pytest.raises(NotFound):
        delete_expense(deps, OWNER, hid, eid)


def test_an_expense_belongs_to_its_house(deps):
    hid = new_house(deps)
    other = new_house(deps, name="Outra")
    eid = new_expense(deps, hid)
    with pytest.raises(NotFound):
        update_expense(deps, OWNER, other, eid, expense_input())
    with pytest.raises(NotFound):
        create_expense(deps, OWNER, "00000000", expense_input())


def test_installments_monthly_in_due_order(deps):
    hid = new_house(deps, down_payment_cents=6_000_000)
    view = create_installments(deps, OWNER, hid, plan_input(first_due_date="2026-01-31", count=3, amount_cents=1000))
    assert [i["due_date"] for i in view["installments"]] == ["2026-01-31", "2026-02-28", "2026-03-31"]
    assert all(i["paid_date"] == "" for i in view["installments"])
    payment = view["totals"]["payment"]
    assert payment == {"down_payment_cents": 6_000_000, "installments_count": 3, "installments_cents": 3000,
                       "paid_count": 0, "paid_cents": 0, "open_cents": 3000, "next_due_date": "2026-01-31",
                       "total_paid_cents": 6_000_000}


def test_pay_an_installment_then_undo_change_and_delete(deps):
    hid = new_house(deps, down_payment_cents=100)
    first, second = create_installments(deps, OWNER, hid, plan_input(count=2, amount_cents=1000))["installments"]
    paid = {**first, "paid_date": "2026-02-09"}
    view = update_installment(deps, OWNER, hid, first["id"], paid)
    assert view["installments"][0]["paid_date"] == "2026-02-09"
    payment = view["totals"]["payment"]
    assert (payment["paid_count"], payment["paid_cents"], payment["open_cents"]) == (1, 1000, 1000)
    assert payment["next_due_date"] == second["due_date"] and payment["total_paid_cents"] == 1100
    view = update_installment(deps, OWNER, hid, first["id"], {**first, "paid_date": ""})      # not paid after all
    assert view["totals"]["payment"]["paid_count"] == 0
    view = update_installment(deps, OWNER, hid, second["id"], {**second, "amount_cents": 1500})
    assert view["totals"]["payment"]["installments_cents"] == 2500
    view = delete_installment(deps, OWNER, hid, first["id"])
    assert [i["id"] for i in view["installments"]] == [second["id"]]
    with pytest.raises(NotFound):
        delete_installment(deps, OWNER, hid, first["id"])


def test_an_installment_belongs_to_its_house(deps):
    hid = new_house(deps)
    other = new_house(deps, name="Outra")
    (inst,) = create_installments(deps, OWNER, hid, plan_input(count=1))["installments"]
    with pytest.raises(NotFound):
        update_installment(deps, OWNER, other, inst["id"], inst)
    with pytest.raises(NotFound):
        delete_installment(deps, OWNER, other, inst["id"])
    with pytest.raises(NotFound):
        create_installments(deps, OWNER, "00000000", plan_input())


def test_owners_never_see_each_other(deps):
    hid = new_house(deps)
    eid = new_expense(deps, hid)
    (inst,) = create_installments(deps, OWNER, hid, plan_input(count=1))["installments"]
    assert list_houses(deps, OTHER) == []
    for call in (lambda: get_house(deps, OTHER, hid),
                 lambda: update_house(deps, OTHER, hid, house_input()),
                 lambda: delete_house(deps, OTHER, hid),
                 lambda: create_expense(deps, OTHER, hid, expense_input()),
                 lambda: delete_expense(deps, OTHER, hid, eid),
                 lambda: create_installments(deps, OTHER, hid, plan_input()),
                 lambda: update_installment(deps, OTHER, hid, inst["id"], inst),
                 lambda: delete_installment(deps, OTHER, hid, inst["id"])):
        with pytest.raises(NotFound):
            call()
    view = get_house(deps, OWNER, hid)
    assert view["totals"]["expense_count"] == 1 and len(view["installments"]) == 1


def test_limits(deps, monkeypatch):
    monkeypatch.setattr(application, "MAX_HOUSES", 1)
    monkeypatch.setattr(application, "MAX_EXPENSES_PER_HOUSE", 1)
    monkeypatch.setattr(application, "MAX_INSTALLMENTS_PER_HOUSE", 4)
    hid = new_house(deps)
    with pytest.raises(ValidationError, match="limite"):
        create_house(deps, OWNER, house_input())
    new_expense(deps, hid)
    with pytest.raises(ValidationError, match="limite"):
        create_expense(deps, OWNER, hid, expense_input())
    create_installments(deps, OWNER, hid, plan_input(count=3))
    with pytest.raises(ValidationError, match="limite"):
        create_installments(deps, OWNER, hid, plan_input(count=2))       # 3 + 2 > 4: none is added
    assert len(get_house(deps, OWNER, hid)["installments"]) == 3


def test_invalid_input_writes_nothing(deps):
    with pytest.raises(ValidationError):
        create_house(deps, OWNER, house_input(purchase_price_cents=-5))
    assert list_houses(deps, OWNER) == []
    hid = new_house(deps)
    with pytest.raises(ValidationError):
        create_installments(deps, OWNER, hid, plan_input(count=0))
    assert get_house(deps, OWNER, hid)["installments"] == []
