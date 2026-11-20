import base64
import json
import re

import pytest

from conftest import ROOT, expense_input, house_input
from houses_core.adapters.api_gateway import MAX_BODY
from houses_core.ports import Dependencies
from api_gateway import ROUTES, dispatch
from memory_repository import MemoryRepository


def call(deps, method, path, body=None, query=None, owner="owner-a", base64_=False):
    event = {"rawPath": path, "requestContext": {"http": {"method": method}}, "queryStringParameters": query}
    if owner is not None:
        event["requestContext"]["authorizer"] = {"jwt": {"claims": {"sub": owner}}}
    if body is not None:
        text = body if isinstance(body, str) else json.dumps(body)
        event["body"] = base64.b64encode(text.encode()).decode() if base64_ else text
        event["isBase64Encoded"] = base64_
    response = dispatch(event, deps)
    return response["statusCode"], json.loads(response["body"]) if response["body"] else None


@pytest.fixture
def api():
    return Dependencies(MemoryRepository())


def test_full_flow(api):
    status, house = call(api, "POST", "/houses", house_input())
    assert status == 201 and house["status"] == "renovating"
    hid = house["id"]
    status, expense = call(api, "POST", f"/houses/{hid}/expenses", expense_input())
    assert status == 201 and expense["house_id"] == hid
    status, found = call(api, "GET", f"/houses/{hid}")
    assert status == 200 and found["totals"]["renovation_cents"] == 150_000
    status, changed = call(api, "PUT", f"/houses/{hid}/expenses/{expense['id']}", expense_input(amount_cents=10))
    assert status == 200 and changed["amount_cents"] == 10
    status, houses = call(api, "GET", "/houses")
    assert status == 200 and houses[0]["totals"]["total_cents"] == 31_800_010
    assert call(api, "PUT", f"/houses/{hid}", house_input(name="Nova"))[1]["name"] == "Nova"
    assert call(api, "DELETE", f"/houses/{hid}/expenses/{expense['id']}") == (204, None)
    assert call(api, "DELETE", f"/houses/{hid}/expenses/{expense['id']}")[0] == 404
    assert call(api, "DELETE", f"/houses/{hid}") == (204, None)
    assert call(api, "GET", f"/houses/{hid}")[0] == 404
    assert call(api, "GET", "/houses")[1] == []


def test_validation_is_400_with_a_message(api):
    status, body = call(api, "POST", "/houses", house_input(name=""))
    assert status == 400 and "nome" in body["error"]


def test_no_login_is_401_and_does_not_touch_the_database(api):
    assert call(api, "GET", "/houses", owner=None)[0] == 401
    assert call(api, "GET", "/houses", owner="")[0] == 401
    assert call(api, "POST", "/houses", house_input(), owner=None)[0] == 401
    assert call(api, "GET", "/houses")[1] == []                     # nothing was written


def test_the_owner_comes_from_the_token_not_from_the_body(api):
    call(api, "POST", "/houses", house_input(owner="owner-b", PK="OWNER#owner-b"))
    assert call(api, "GET", "/houses", owner="owner-b")[1] == []
    assert len(call(api, "GET", "/houses", owner="owner-a")[1]) == 1


@pytest.mark.parametrize("method, path", [
    ("GET", "/nothing"), ("PATCH", "/houses"), ("GET", "/houses/xyz"), ("GET", "/houses/"),
    ("DELETE", "/houses/ZZZZZZZZ"), ("GET", "/houses/abcd1234/expenses"),
    ("PUT", "/houses/abcd1234/expenses/../x"),
])
def test_odd_routes_are_404(api, method, path):
    assert call(api, method, path)[0] == 404


@pytest.mark.parametrize("body", ["{broken", "[1, 2]", '"text"', "x" * (MAX_BODY + 1)])
def test_bad_body_becomes_400(api, body):
    assert call(api, "POST", "/houses", body)[0] == 400


def test_base64_body(api):
    assert call(api, "POST", "/houses", house_input(), base64_=True)[0] == 201


def test_unexpected_error_does_not_leak_details(caplog):
    class Broken(MemoryRepository):
        def list_houses(self, owner):
            raise RuntimeError("database-password")
    status, body = call(Dependencies(Broken()), "GET", "/houses")
    assert status == 500 and "password" not in json.dumps(body)
    assert "database-password" in caplog.text                     # stays only in the log


def test_one_lambda_per_action_each_with_its_own_route():
    """backend/lambdas/<action>/: the use case, the inbound adapter and lambda.json (read by Terraform)."""
    folders = sorted(p.name for p in (ROOT / "backend" / "lambdas").iterdir() if p.is_dir() and p.name != "__pycache__")
    assert folders == sorted(name for _, _, name, _ in ROUTES)
    for name in folders:
        for file in ("__init__.py", "use_case.py", "handler.py", "lambda.json"):
            assert (ROOT / "backend" / "lambdas" / name / file).is_file(), (name, file)
    routes = [(method, pattern.pattern) for method, pattern, _, _ in ROUTES]
    assert len(routes) == len(set(routes)), "two Lambdas with the same route"


def test_read_only_lambdas_never_write():
    """The Lambdas marked "read" get an IAM role that cannot write: their use case must not need it."""
    reads = [name for _, _, name, _ in ROUTES
             if json.loads((ROOT / "backend" / "lambdas" / name / "lambda.json").read_text())["database"] == "read"]
    assert reads and all(n.startswith(("list_", "get_")) for n in reads)
    source = "\n".join((ROOT / "backend" / "lambdas" / n / "use_case.py").read_text(encoding="utf-8") for n in reads)
    for write in ("save_", "delete_"):
        assert f"repo.{write}" not in source, write


def _generic(route):
    return re.sub(r"\{[^}]+\}", "{}", route)


def test_every_call_of_the_frontend_has_a_lambda_and_every_lambda_is_used():
    """The contract between the two sides: each api("METHOD", "/path") in frontend/js matches a route
    in some lambda.json (what Terraform deploys), and no Lambda is left that nobody calls."""
    routes = {_generic(json.loads((ROOT / "backend" / "lambdas" / name / "lambda.json").read_text())["route"])
              for _, _, name, _ in ROUTES}
    calls = set()
    for file in (ROOT / "frontend" / "js").rglob("*.js"):
        for method, path in re.findall(r'api\("([A-Z]+)", [`"]([^`"]+)[`"]', file.read_text(encoding="utf-8")):
            calls.add(f"{method} {re.sub(r'\$\{[^}]+\}', '{}', path)}")
    assert calls - routes == set(), "the frontend calls routes no Lambda answers"
    assert routes - calls == set(), "Lambdas nobody calls"
