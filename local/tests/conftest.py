import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "local"))                  # MemoryRepository and the local API Gateway

import api_gateway  # noqa: E402,F401  (puts backend/core and backend/lambdas on the path, like each zip)
from houses_core.adapters.dynamo_repository import DynamoRepository  # noqa: E402
from houses_core.ports import Dependencies  # noqa: E402
from memory_repository import MemoryRepository  # noqa: E402

OWNER = "owner-a"
OTHER = "owner-b"


class FakeDynamo:
    """Only what the repository uses: get, put, delete, batch write and a paginated begins_with query.
    `unprocessed`: how many batch calls leave their last item unprocessed (like DynamoDB throttling)."""

    def __init__(self, page_size=2, unprocessed=0):
        self.items, self.page_size, self.unprocessed, self.batch_calls = {}, page_size, unprocessed, 0

    @staticmethod
    def _k(key):
        return key["PK"]["S"], key["SK"]["S"]

    def get_item(self, TableName, Key, ConsistentRead=False):
        item = self.items.get(self._k(Key))
        return {"Item": item} if item else {}

    def put_item(self, TableName, Item):
        self.items[self._k(Item)] = Item

    def delete_item(self, TableName, Key):
        self.items.pop(self._k(Key), None)

    def batch_write_item(self, RequestItems):
        self.batch_calls += 1
        (table, requests), = RequestItems.items()
        assert 1 <= len(requests) <= 25
        left = []
        if self.unprocessed:
            self.unprocessed -= 1
            requests, left = requests[:-1], requests[-1:]
        for r in requests:
            if "PutRequest" in r:
                self.put_item(table, r["PutRequest"]["Item"])
            else:
                self.delete_item(table, r["DeleteRequest"]["Key"])
        return {"UnprocessedItems": {table: left} if left else {}}

    def query(self, TableName, KeyConditionExpression, ExpressionAttributeValues,
              ConsistentRead=False, ExclusiveStartKey=None):
        assert KeyConditionExpression == "PK = :pk AND begins_with(SK, :p)", KeyConditionExpression
        pk, prefix = ExpressionAttributeValues[":pk"]["S"], ExpressionAttributeValues[":p"]["S"]
        found = sorted(k for k in self.items if k[0] == pk and k[1].startswith(prefix))
        if ExclusiveStartKey:
            found = [k for k in found if k[1] > ExclusiveStartKey["SK"]["S"]]
        page, rest = found[:self.page_size], found[self.page_size:]
        response = {"Items": [self.items[k] for k in page]}
        if rest:
            response["LastEvaluatedKey"] = {"PK": {"S": pk}, "SK": {"S": page[-1][1]}}
        return response


@pytest.fixture(params=["memory", "dynamo"])
def repo(request):
    """Every rule test runs against both repositories: they must behave the same."""
    return MemoryRepository() if request.param == "memory" else DynamoRepository(FakeDynamo(), "t")


@pytest.fixture
def deps(repo):
    return Dependencies(repo)


def house_input(**extra):
    return {"name": "Casa Azul", "address": "Rua A, 1", "purchase_date": "2026-01-10",
            "purchase_price_cents": 30_000_000, "purchase_costs_cents": 1_800_000, **extra}


def expense_input(**extra):
    return {"date": "2026-02-01", "category": "material", "description": "Cimento",
            "amount_cents": 150_000, "supplier": "Depósito", **extra}


def plan_input(**extra):
    return {"first_due_date": "2026-02-10", "amount_cents": 250_000, "count": 3, **extra}
