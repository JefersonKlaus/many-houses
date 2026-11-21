"""DynamoDB repository, single table.

PK = OWNER#<owner>   SK = HOUSE#<house id> | EXP#<house id>#<expense id> | INST#<house id>#<installment id>

The item stores the whole object as JSON in the `data` attribute. One house's costs are one query
(begins_with EXP#<house id>#); every house's costs, another (begins_with EXP#). Installments (prestações) work the same way with INST#. The `owner` always
comes from the login token, never from what the browser sends: that is what keeps each user's data apart.
"""
from __future__ import annotations

import json
import time
from typing import Any, Optional

from ..domain.models import Expense, House, Installment

OWNER_PREFIX, HOUSE_PREFIX, EXPENSE_PREFIX, INSTALLMENT_PREFIX = "OWNER#", "HOUSE#", "EXP#", "INST#"
DATA_ATTRIBUTE = "data"
BATCH_SIZE = 25                 # the most BatchWriteItem takes in one call
BATCH_ATTEMPTS = 8


class DynamoRepository:
    def __init__(self, client: Any, table: str) -> None:
        self.client, self.table = client, table

    # -------------------------------------------------------------- low level
    def _key(self, owner: str, sk: str) -> dict[str, Any]:
        return {"PK": {"S": f"{OWNER_PREFIX}{owner}"}, "SK": {"S": sk}}

    def _put(self, owner: str, sk: str, obj: dict[str, Any]) -> None:
        self.client.put_item(TableName=self.table, Item={
            **self._key(owner, sk), DATA_ATTRIBUTE: {"S": json.dumps(obj, ensure_ascii=False)}})

    def _read(self, owner: str, sk: str) -> Optional[dict[str, Any]]:
        item = self.client.get_item(TableName=self.table, Key=self._key(owner, sk), ConsistentRead=True).get("Item")
        return json.loads(item[DATA_ATTRIBUTE]["S"]) if item else None

    def _delete(self, owner: str, sk: str) -> None:
        self.client.delete_item(TableName=self.table, Key=self._key(owner, sk))

    def _batch(self, requests: list[dict[str, Any]]) -> None:
        """Writes/deletes in calls of 25; what DynamoDB leaves unprocessed (throttling) is sent again."""
        for start in range(0, len(requests), BATCH_SIZE):
            pending = {self.table: requests[start:start + BATCH_SIZE]}
            for attempt in range(BATCH_ATTEMPTS):
                pending = self.client.batch_write_item(RequestItems=pending).get("UnprocessedItems") or {}
                if not pending:
                    break
                time.sleep(0.05 * 2 ** attempt)
            else:
                raise RuntimeError("DynamoDB did not accept every item of the batch")

    def _query_prefix(self, owner: str, prefix: str) -> list[dict[str, Any]]:
        items, start_key = [], None
        while True:
            request = {"TableName": self.table, "ConsistentRead": True,
                       "KeyConditionExpression": "PK = :pk AND begins_with(SK, :p)",
                       "ExpressionAttributeValues": {":pk": {"S": f"{OWNER_PREFIX}{owner}"}, ":p": {"S": prefix}}}
            if start_key:
                request["ExclusiveStartKey"] = start_key
            response = self.client.query(**request)
            items += [json.loads(i[DATA_ATTRIBUTE]["S"]) for i in response.get("Items", [])]
            start_key = response.get("LastEvaluatedKey")
            if not start_key:
                return items

    # -------------------------------------------------------------- houses
    def list_houses(self, owner: str) -> list[House]:
        return [House.from_dict(d) for d in self._query_prefix(owner, HOUSE_PREFIX)]

    def get_house(self, owner: str, id: str) -> Optional[House]:
        data = self._read(owner, f"{HOUSE_PREFIX}{id}")
        return House.from_dict(data) if data else None

    def save_house(self, owner: str, house: House) -> None:
        self._put(owner, f"{HOUSE_PREFIX}{house.id}", house.to_dict())

    def delete_house(self, owner: str, id: str) -> None:
        self._delete(owner, f"{HOUSE_PREFIX}{id}")

    # -------------------------------------------------------------- renovation costs
    def list_expenses(self, owner: str, house_id: Optional[str] = None) -> list[Expense]:
        prefix = f"{EXPENSE_PREFIX}{house_id}#" if house_id else EXPENSE_PREFIX
        return [Expense.from_dict(d) for d in self._query_prefix(owner, prefix)]

    def get_expense(self, owner: str, house_id: str, id: str) -> Optional[Expense]:
        data = self._read(owner, f"{EXPENSE_PREFIX}{house_id}#{id}")
        return Expense.from_dict(data) if data else None

    def save_expense(self, owner: str, expense: Expense) -> None:
        self._put(owner, f"{EXPENSE_PREFIX}{expense.house_id}#{expense.id}", expense.to_dict())

    def delete_expense(self, owner: str, house_id: str, id: str) -> None:
        self._delete(owner, f"{EXPENSE_PREFIX}{house_id}#{id}")

    # -------------------------------------------------------------- installments (prestações)
    def list_installments(self, owner: str, house_id: Optional[str] = None) -> list[Installment]:
        prefix = f"{INSTALLMENT_PREFIX}{house_id}#" if house_id else INSTALLMENT_PREFIX
        return [Installment.from_dict(d) for d in self._query_prefix(owner, prefix)]

    def get_installment(self, owner: str, house_id: str, id: str) -> Optional[Installment]:
        data = self._read(owner, f"{INSTALLMENT_PREFIX}{house_id}#{id}")
        return Installment.from_dict(data) if data else None

    def save_installments(self, owner: str, installments: list[Installment]) -> None:
        self._batch([{"PutRequest": {"Item": {
            **self._key(owner, f"{INSTALLMENT_PREFIX}{i.house_id}#{i.id}"),
            DATA_ATTRIBUTE: {"S": json.dumps(i.to_dict(), ensure_ascii=False)}}}} for i in installments])

    def delete_installments(self, owner: str, house_id: str, ids: list[str]) -> None:
        self._batch([{"DeleteRequest": {"Key": self._key(owner, f"{INSTALLMENT_PREFIX}{house_id}#{id}")}}
                     for id in ids])
