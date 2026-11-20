"""The DynamoDB format: what each item looks like in the table (the in-memory one has no format)."""
import json

from conftest import FakeDynamo, OWNER, expense_input, house_input
from houses_core.adapters.dynamo_repository import DynamoRepository
from houses_core.domain.models import Expense, House


def test_keys_and_pagination():
    table = FakeDynamo(page_size=2)
    repo = DynamoRepository(table, "t")
    house = House.from_input(house_input())
    repo.save_house(OWNER, house)
    expenses = [Expense.from_input(expense_input(description=f"item {i}"), house.id) for i in range(5)]
    for e in expenses:
        repo.save_expense(OWNER, e)
    assert (f"OWNER#{OWNER}", f"HOUSE#{house.id}") in table.items
    assert (f"OWNER#{OWNER}", f"EXP#{house.id}#{expenses[0].id}") in table.items
    stored = json.loads(table.items[(f"OWNER#{OWNER}", f"HOUSE#{house.id}")]["data"]["S"])
    assert stored["name"] == "Casa Azul"
    assert repo.list_houses(OWNER) == [house]                       # the costs are not houses
    assert sorted(repo.list_expenses(OWNER, house.id), key=lambda e: e.id) == sorted(expenses, key=lambda e: e.id)
    assert len(repo.list_expenses(OWNER)) == 5                       # 3 pages of 2


def test_one_house_prefix_does_not_catch_another():
    """EXP#<house id># ends with "#": house "aaaa0000" never sees the costs of "aaaa00001" or similar."""
    repo = DynamoRepository(FakeDynamo(), "t")
    repo.save_expense(OWNER, Expense.from_input(expense_input(), "aaaa0000"))
    repo.save_expense(OWNER, Expense.from_input(expense_input(), "aaaa0001"))
    assert [e.house_id for e in repo.list_expenses(OWNER, "aaaa0000")] == ["aaaa0000"]
