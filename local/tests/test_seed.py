from datetime import date

from houses_core.domain.models import Expense, House
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
    # everything in it would also pass the API's validation
    for house in deps.repo.list_houses("me"):
        assert House.from_input(house.to_dict(), house.id) == house
    for expense in deps.repo.list_expenses("me"):
        assert Expense.from_input(expense.to_dict(), expense.house_id, expense.id) == expense
