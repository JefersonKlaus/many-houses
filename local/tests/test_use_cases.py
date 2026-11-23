"""The Lambdas' use cases, called directly (no HTTP), against both repositories (conftest.repo).
Every change to a house answers the house's page (application.house_view), like GET /houses/{id}."""
import pytest

from conftest import OTHER, OWNER, expense_input, house_input, plan_input
from create_expense.use_case import create_expense
from create_house.use_case import create_house
from create_installments.use_case import create_installments
from create_invite.use_case import create_invite
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
    """A house bought in installments with no installment yet (so tests add their own)."""
    hid = create_house(deps, OWNER, house_input(**extra))["house"]["id"]
    update_house(deps, OWNER, hid, house_input(payment_type="installments", **extra))
    return hid


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
    for change in (lambda: update_house(deps, OWNER, hid, house_input(name="Nova", payment_type="installments")),
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


def test_sold_houses_are_always_last(deps):
    for name, status in (("Azul", "sold"), ("Casa Nova", "renovating"), ("Amarela", "ready"), ("Branca", "sold")):
        create_house(deps, OWNER, house_input(name=name, status=status))
    assert [h["name"] for h in list_houses(deps, OWNER)] == ["Amarela", "Casa Nova", "Azul", "Branca"]


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
    view = update_house(deps, OWNER, hid, house_input(name="Casa Verde", status="sold", payment_type="installments"))
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


def test_bought_cash(deps):
    view = create_house(deps, OWNER, house_input(down_payment_cents=5000, installments=plan_input()))
    assert view["house"]["payment_type"] == "cash"
    assert view["house"]["down_payment_cents"] == 0 and view["installments"] == []     # ignored when cash
    with pytest.raises(ValidationError, match="à vista"):
        create_installments(deps, OWNER, view["house"]["id"], plan_input())


def test_bought_in_installments_registers_the_plan_with_the_house(deps):
    view = create_house(deps, OWNER, house_input(payment_type="installments", down_payment_cents=6_000_000,
                                                 installments=plan_input(count=120, amount_cents=300_000)))
    assert view["house"]["payment_type"] == "installments" and len(view["installments"]) == 120
    payment = view["totals"]["payment"]
    assert payment["down_payment_cents"] == 6_000_000 and payment["installments_cents"] == 36_000_000
    assert view["installments"][0]["due_date"] == "2026-02-10"
    assert view["installments"][-1]["due_date"] == "2036-01-10"


@pytest.mark.parametrize("plan, message", [
    (None, "parcelado"), ("12x", "parcelado"), (plan_input(count=0), "quantidade"),
    (plan_input(amount_cents=0), "valor"), (plan_input(first_due_date=""), "primeiro vencimento"),
])
def test_installments_without_a_valid_plan_saves_nothing(deps, plan, message):
    with pytest.raises(ValidationError, match=message):
        create_house(deps, OWNER, house_input(payment_type="installments", installments=plan))
    assert list_houses(deps, OWNER) == [] and deps.repo.list_installments(OWNER) == []


def test_a_house_with_installments_only_becomes_cash_without_them(deps):
    view = create_house(deps, OWNER, house_input(payment_type="installments", installments=plan_input(count=2)))
    hid = view["house"]["id"]
    with pytest.raises(ValidationError, match="exclua antes as prestações"):
        update_house(deps, OWNER, hid, house_input(payment_type="cash"))
    for inst in view["installments"]:
        delete_installment(deps, OWNER, hid, inst["id"])
    assert update_house(deps, OWNER, hid, house_input(payment_type="cash"))["house"]["payment_type"] == "cash"


def test_suggested_sale_price_follows_what_was_invested(deps):
    view = create_house(deps, OWNER, house_input(target_profit_percent=30))
    hid = view["house"]["id"]
    assert view["totals"]["sale"] == {"target_profit_percent": 30, "target_profit_cents": 9_540_000,
                                      "suggested_price_cents": 41_340_000}          # 318.000 + 30%
    view = create_expense(deps, OWNER, hid, expense_input(amount_cents=2_000_000))   # R$ 20.000 of renovation
    assert view["totals"]["sale"]["suggested_price_cents"] == 43_940_000             # 338.000 + 30%
    assert list_houses(deps, OWNER)[0]["totals"]["sale"]["suggested_price_cents"] == 43_940_000
    view = update_house(deps, OWNER, hid, house_input(target_profit_percent=0))
    assert view["totals"]["sale"]["suggested_price_cents"] == view["totals"]["total_cents"]


def test_costs_by_area(deps):
    view = create_house(deps, OWNER, house_input(areas=["Cozinha", "Telhado", "Banheiro"]))
    hid = view["house"]["id"]
    kitchen, roof, bathroom = (a["id"] for a in view["house"]["areas"])
    create_expense(deps, OWNER, hid, expense_input(area_id=kitchen, amount_cents=700))
    create_expense(deps, OWNER, hid, expense_input(area_id=kitchen, amount_cents=300))
    create_expense(deps, OWNER, hid, expense_input(area_id=roof, amount_cents=5000))
    view = create_expense(deps, OWNER, hid, expense_input(amount_cents=40))           # no area
    assert view["totals"]["by_area"] == [
        {"id": kitchen, "name": "Cozinha", "cents": 1000, "count": 2},
        {"id": roof, "name": "Telhado", "cents": 5000, "count": 1},
        {"id": bathroom, "name": "Banheiro", "cents": 0, "count": 0}]
    assert view["totals"]["no_area_cents"] == 40


def test_a_cost_only_goes_to_an_area_of_its_house(deps):
    view = create_house(deps, OWNER, house_input(areas=["Cozinha"]))
    hid = view["house"]["id"]
    other = create_house(deps, OWNER, house_input(name="Outra", areas=["Sala"]))["house"]["areas"][0]["id"]
    with pytest.raises(ValidationError, match="área"):
        create_expense(deps, OWNER, hid, expense_input(area_id=other))
    eid = new_expense(deps, hid)
    with pytest.raises(ValidationError, match="área"):
        update_expense(deps, OWNER, hid, eid, expense_input(area_id=other))
    kitchen = view["house"]["areas"][0]["id"]
    view = update_expense(deps, OWNER, hid, eid, expense_input(area_id=kitchen))
    assert view["expenses"][0]["area_id"] == kitchen


def test_an_area_with_costs_is_not_removed(deps):
    view = create_house(deps, OWNER, house_input(areas=["Cozinha", "Sala"]))
    hid = view["house"]["id"]
    kitchen = view["house"]["areas"][0]["id"]
    eid = new_expense(deps, hid, area_id=kitchen)
    with pytest.raises(ValidationError, match="Cozinha.*tem custos"):
        update_house(deps, OWNER, hid, house_input(areas=["Sala"]))
    view = update_house(deps, OWNER, hid, house_input(areas=["COZINHA", "Sala", "Quintal"]))   # renamed: same area
    assert view["house"]["areas"][0]["id"] == kitchen and view["totals"]["by_area"][0]["count"] == 1
    update_expense(deps, OWNER, hid, eid, expense_input())                              # the cost leaves the area
    view = update_house(deps, OWNER, hid, house_input(areas=["Sala"]))
    assert [a["name"] for a in view["house"]["areas"]] == ["Sala"]


# ------------------------------------------------------------------ houses bought in one deal
def deal_input(**extra):
    """Two houses bought at once: 500 and 250 (thousand), one entrada and one plan for both."""
    return house_input(**{"purchase_price_cents": 50_000_000, "purchase_costs_cents": 0,
                          "payment_type": "installments", "down_payment_cents": 7_500_000,
                          "installments": {"count": 2, "amount_cents": 1_000_000, "first_due_date": "2026-02-10"},
                          "also_bought": [{"name": "Casa Verde", "address": "Rua B, 2",
                                           "purchase_price_cents": 25_000_000}], **extra})


def deal(deps):
    view = create_house(deps, OWNER, deal_input())
    other = next(h for h in deps.repo.list_houses(OWNER) if h.id != view["house"]["id"])
    return view, get_house(deps, OWNER, other.id)


def test_two_houses_in_one_deal_split_entrada_and_installments_by_price(deps):
    first, second = deal(deps)
    assert first["house"]["bundle_id"] == second["house"]["bundle_id"] != ""
    assert (first["house"]["down_payment_cents"], second["house"]["down_payment_cents"]) == (5_000_000, 2_500_000)
    assert [i["amount_cents"] for i in first["installments"]] == [666_667, 666_667]
    assert [i["amount_cents"] for i in second["installments"]] == [333_333, 333_333]      # not a cent lost
    assert {i["total_cents"] for i in first["installments"] + second["installments"]} == {1_000_000}
    assert first["installments"][0]["group_id"] == second["installments"][0]["group_id"] != ""
    assert [(b["name"], b["percent"]) for b in first["bundle"]] == [("Casa Azul", 66.67), ("Casa Verde", 33.33)] \
        or [(b["name"], b["percent"]) for b in first["bundle"]] == [("Casa Verde", 33.33), ("Casa Azul", 66.67)]


def test_installment_of_a_deal_changes_and_goes_together(deps):
    first, second = deal(deps)
    a, b = first["installments"][0], second["installments"][0]
    view = update_installment(deps, OWNER, first["house"]["id"], a["id"], {**a, "paid_date": "2026-02-09"})
    assert view["installments"][0]["paid_date"] == "2026-02-09"
    assert get_house(deps, OWNER, second["house"]["id"])["installments"][0]["paid_date"] == "2026-02-09"
    view = update_installment(deps, OWNER, first["house"]["id"], a["id"], {**a, "total_cents": 2_000_000})
    other = get_house(deps, OWNER, second["house"]["id"])
    assert (view["installments"][0]["amount_cents"], other["installments"][0]["amount_cents"]) == (1_333_334, 666_666)
    assert other["installments"][0]["total_cents"] == 2_000_000 and view["installments"][1]["total_cents"] == 1_000_000
    delete_installment(deps, OWNER, first["house"]["id"], a["id"])
    assert len(get_house(deps, OWNER, second["house"]["id"])["installments"]) == 1
    assert deps.repo.get_installment(OWNER, second["house"]["id"], b["id"]) is None


def test_more_installments_for_a_deal_and_deleting_one_house_of_it(deps):
    first, second = deal(deps)
    view = create_installments(deps, OWNER, first["house"]["id"], plan_input(count=1, amount_cents=900_000))
    assert len(view["installments"]) == 3 and len(get_house(deps, OWNER, second["house"]["id"])["installments"]) == 3
    delete_house(deps, OWNER, second["house"]["id"])
    view = get_house(deps, OWNER, first["house"]["id"])          # left alone: a house like any other again
    assert view["bundle"] == [] and view["house"]["bundle_id"] == ""
    assert all(i["group_id"] == "" and i["total_cents"] == 0 for i in view["installments"])


def test_a_deal_with_partners_spreads_what_each_paid_over_the_houses(deps):
    # up front: entrada 75.000,00 (50.000 + 25.000) + costs 18.000 + 0 = 93.000,00 in all
    payload = deal_input(purchase_costs_cents=1_800_000, owner_share_cents=4_000_000,
                         partners=[{"phone": "11987654321", "cents": 5_300_000}])
    view = create_house(deps, OWNER, payload)
    houses = sorted(deps.repo.list_houses(OWNER), key=lambda h: h.id != view["house"]["id"])
    assert len(houses) == 2 and all(len(h.invites) == 1 for h in houses)
    for house in houses:                                       # each house's shares add up to what it cost up front
        assert sum(s.cents for s in house.purchase_shares) == house.upfront_cents
    assert sum(s.cents for h in houses for s in h.purchase_shares if s.member_id == "00000000") == 4_000_000
    assert sum(s.cents for h in houses for s in h.purchase_shares if s.member_id != "00000000") == 5_300_000
    assert len({i.id for h in houses for i in h.invites}) == 2     # an invite for each house, same phone
    assert len(deps.repo.list_pending_invites("+5511987654321")) == 2
    with pytest.raises(ValidationError):                       # the shares must close with the whole deal
        create_house(deps, OWNER, deal_input(owner_share_cents=1, partners=[{"phone": "11987654322", "cents": 1}]))


def test_a_deal_has_its_entrada_fit_the_prices(deps):
    with pytest.raises(ValidationError):
        create_house(deps, OWNER, deal_input(down_payment_cents=80_000_000))
    assert deps.repo.list_houses(OWNER) == []


def test_paying_an_installment_of_a_deal_by_a_partner_is_the_same_partner_in_each_house(deps):
    from accept_invite.use_case import accept_invite
    payload = deal_input(owner_share_cents=2_500_000, partners=[{"phone": "11987654321", "cents": 5_000_000}])
    view = create_house(deps, OWNER, payload)
    houses = deps.repo.list_houses(OWNER)
    for invite in deps.repo.list_pending_invites("+5511987654321"):
        accept_invite(deps, "partner-1", invite.id, "+5511987654321", "Ana")
    first = get_house(deps, "partner-1", view["house"]["id"])
    inst = first["installments"][0]
    update_installment(deps, "partner-1", view["house"]["id"], inst["id"], {**inst, "paid_date": "2026-02-09"})
    other = next(h for h in houses if h.id != view["house"]["id"])
    paid_by = {i.house_id: i.paid_by for i in deps.repo.list_installments(OWNER) if i.paid_date}
    partner_of = lambda house: next(p.id for p in deps.repo.get_house(OWNER, house.id).partners)    # noqa: E731
    assert paid_by == {view["house"]["id"]: partner_of(houses[0] if houses[0].id == view["house"]["id"] else other),
                       other.id: partner_of(other)}


def test_recurring_bills_warn_two_days_before_they_are_due(deps, monkeypatch):
    from set_recurring.use_case import set_recurring
    monkeypatch.setattr("set_recurring.use_case.today", lambda: "2026-01-15")      # registered before the dates tried
    hid = new_house(deps)
    view = set_recurring(deps, OWNER, hid, {"bills": [{"name": "Energia", "day": 10}, {"name": "Água", "day": 31}]})
    assert [(b["name"], b["day"]) for b in view["house"]["recurring_bills"]] == [("Energia", 10), ("Água", 31)]
    soon = lambda on, only="": [(d["name"], d["days"]) for d in list_houses(deps, OWNER, on)[0]["due_soon"]  # noqa: E731
                                if only in d["name"]]
    assert soon("2026-03-07") == []                                        # three days to go
    assert soon("2026-03-08") == [("Energia", 2)]
    assert soon("2026-03-10") == [("Energia", 0)]
    assert soon("2026-03-12") == [("Energia", -2)]                         # late, until it is paid
    assert soon("2026-02-26", "Água") == [("Água", 2)]                             # day 31 in February: the 28th
    assert soon("2026-02-28", "Água") == [("Água", 0)]
    assert soon("2026-03-30", "Água") == [("Água", 1)]
    new_expense(deps, hid, date="2026-03-09", category="recurring", description="energia", amount_cents=1000)
    assert soon("2026-03-10") == []                                        # paid (same name, same month)
    assert soon("2026-04-08") == [("Energia", 2)]                          # next month's comes again
    assert soon("2026-03-31") == [("Água", 0)]                             # and the next month's, seen from the 31st


def test_unpaid_installments_are_warned_too(deps):
    hid = new_house(deps)
    create_installments(deps, OWNER, hid, plan_input(first_due_date="2026-02-10", count=2))
    soon = lambda on: [(d["type"], d["due_date"]) for d in list_houses(deps, OWNER, on)[0]["due_soon"]]  # noqa: E731
    assert soon("2026-02-07") == []
    assert soon("2026-02-08") == [("installment", "2026-02-10")]
    assert soon("2026-03-15") == [("installment", "2026-02-10"), ("installment", "2026-03-10")]   # late ones stay
    first = get_house(deps, OWNER, hid)["installments"][0]
    update_installment(deps, OWNER, hid, first["id"], {**first, "paid_date": "2026-02-09"})
    assert soon("2026-02-08") == []


def test_invalid_recurring_bills(deps):
    from set_recurring.use_case import set_recurring
    hid = new_house(deps)
    for bills, message in (([{"name": "", "day": 5}], "nome"), ([{"name": "Luz", "day": 32}], "dia"),
                           ([{"name": "Luz", "day": 5}, {"name": "luz", "day": 6}], "duas vezes")):
        with pytest.raises(ValidationError, match=message):
            set_recurring(deps, OWNER, hid, {"bills": bills})
    with pytest.raises(ValidationError):
        set_recurring(deps, OWNER, hid, {})
    view = set_recurring(deps, OWNER, hid, {"bills": [{"name": "Luz", "day": 5}]})
    again = set_recurring(deps, OWNER, hid, {"bills": [{"name": "LUZ", "day": 6}]})
    assert again["house"]["recurring_bills"][0]["id"] == view["house"]["recurring_bills"][0]["id"]
    assert update_house(deps, OWNER, hid, house_input())["house"]["recurring_bills"][0]["day"] == 6   # kept


def test_a_late_bill_paid_next_month_counts_for_its_own_month(deps, monkeypatch):
    from set_recurring.use_case import set_recurring
    monkeypatch.setattr("set_recurring.use_case.today", lambda: "2026-01-15")
    hid = new_house(deps)
    set_recurring(deps, OWNER, hid, {"bills": [{"name": "Energia", "day": 10}]})
    soon = lambda on: [d["days"] for d in list_houses(deps, OWNER, on)[0]["due_soon"]]  # noqa: E731
    assert soon("2026-11-12") == [-2]
    new_expense(deps, hid, date="2026-11-12", category="recurring", description="Energia", reference="2026-10")
    assert soon("2026-11-12") == [-2]                                      # that paid October's, not November's
    view = create_expense(deps, OWNER, hid, expense_input(date="2026-12-03", category="recurring",
                                                           description="Energia", reference="2026-11"))
    assert "2026-11" in {e["reference"] for e in view["expenses"]}
    assert soon("2026-12-03") == []
    with pytest.raises(ValidationError, match="mês de referência"):
        create_expense(deps, OWNER, hid, expense_input(category="recurring", reference="2026-13"))


def test_a_cancelled_bill_stops_being_charged_and_keeps_its_history(deps, monkeypatch):
    from set_recurring.use_case import set_recurring
    monkeypatch.setattr("set_recurring.use_case.today", lambda: "2026-03-20")
    hid = new_house(deps)
    set_recurring(deps, OWNER, hid, {"bills": [{"name": "Netflix", "day": 10}]})
    soon = lambda on: [d["due_date"] for d in list_houses(deps, OWNER, on)[0]["due_soon"]]  # noqa: E731
    assert soon("2026-02-08") == []                                        # before it was registered: not charged
    assert soon("2026-04-08") == ["2026-04-10"]
    view = set_recurring(deps, OWNER, hid, {"bills": [{"name": "Netflix", "day": 10, "until": "2026-04"}]})
    bill = view["house"]["recurring_bills"][0]
    assert (bill["since"], bill["until"]) == ("2026-03", "2026-04")        # started in March, last charge in April
    assert soon("2026-04-08") == ["2026-04-10"] and soon("2026-05-08") == []   # cancelled: no more warnings
    view = set_recurring(deps, OWNER, hid, {"bills": [{"name": "Netflix", "day": 10}]})                # reactivated
    assert view["house"]["recurring_bills"][0]["until"] == "" and soon("2026-05-08") == ["2026-05-10"]
    with pytest.raises(ValidationError, match="último mês"):
        set_recurring(deps, OWNER, hid, {"bills": [{"name": "Netflix", "day": 10, "until": "2026-13"}]})
