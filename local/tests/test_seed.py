from datetime import date

from houses_core.domain.models import Expense, House, Installment
from houses_core.ports import Dependencies
from list_houses.use_case import list_houses
from memory_repository import MemoryRepository
from seed import seed


def test_demo_data_is_valid_and_looks_used():
    deps = Dependencies(MemoryRepository())
    seed(deps, "me", date(2026, 11, 20))
    houses = list_houses(deps, "me")
    assert len(houses) >= 3 and {h["status"] for h in houses} == {"renovating", "ready", "sold"}
    assert all(h["totals"]["expense_count"] > 0 for h in houses)
    financed = [h["totals"]["payment"] for h in houses if h["totals"]["payment"]["installments_count"]]
    assert len(financed) == 2 and all(0 < p["paid_count"] < p["installments_count"] for p in financed)
    # everything in it would also pass the API's validation
    assert all(h["areas"] for h in houses)
    assert any(a["cents"] > 0 for h in houses for a in h["totals"]["by_area"])
    for house in deps.repo.list_houses("me"):
        typed = {**house.to_dict(), "areas": [a.name for a in house.areas]}       # the form sends the names
        assert House.from_input(typed, house.id, previous=house) == house
    for expense in deps.repo.list_expenses("me"):
        assert Expense.from_input(expense.to_dict(), expense.house_id, expense.id) == expense
    for inst in deps.repo.list_installments("me"):
        assert Installment.from_input(inst.to_dict(), inst.house_id, inst.id) == inst
        assert (inst.paid_date != "") == (inst.due_date <= "2026-11-20")     # due ones are paid, the rest open


def test_demo_data_keeps_the_users_name():
    deps = Dependencies(MemoryRepository())
    seed(deps, "me", date(2026, 11, 20), "+5511999990000", "Carlos Lima")
    assert {h.owner_name for h in deps.repo.list_houses("me")} == {"Carlos Lima"}
    (invite,) = deps.repo.list_pending_invites("+5511999990000")
    assert invite.from_name == "Marcos Pereira"


def test_demo_data_has_warnings():
    deps = Dependencies(MemoryRepository())
    seed(deps, "me", date(2026, 11, 20))
    soon = [(d["house_name"], d["type"], d["name"], d["days"]) for h in list_houses(deps, "me", "2026-11-20")
            for d in h["due_soon"]]
    assert ("Apartamento Centro 302", "installment", "Prestação", 2) in soon
    assert ("Apartamento Centro 302", "recurring", "Condomínio", 2) in soon
    assert ("Sobrado Vila Nova", "recurring", "Energia", 2) in soon
    assert ("Sobrado Vila Nova", "recurring", "Internet", 1) not in soon          # paid this month
    assert any(name == "Sobrado Vila Nova" and days < 0 for name, _, _, days in soon)   # something late
