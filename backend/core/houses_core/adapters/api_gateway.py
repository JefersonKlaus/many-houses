"""Inbound adapter shared by every Lambda: API Gateway event (HTTP API, payload v2) -> Request ->
the Lambda's action -> HTTP response. Login, path ids, body and errors are handled here, once."""
from __future__ import annotations

import base64
import json
import logging
from dataclasses import dataclass
from typing import Any, Callable, Optional

from ..domain.errors import BusinessError, ValidationError
from ..domain.models import ITEM_ID_RE
from ..ports import Dependencies

log = logging.getLogger(__name__)
MAX_BODY = 10_000                       # bytes: no record needs more than this


@dataclass(frozen=True)
class Request:
    owner: str                          # the user = `sub` of the token API Gateway already verified
    body: dict[str, Any]
    query: dict[str, str]
    path: dict[str, str]                # the {...} in the route: {"id": <house>, "expense_id": ...}
    phone: str = ""                     # the login's phone ("+55..."), from the same token; "" if it has none
    name: str = ""                      # the login's name, from the same token; "" if it has none
    email: str = ""                     # the login's e-mail, from the same token; "" if it has none

    @property
    def id(self) -> Optional[str]:
        return self.path.get("id")


Action = Callable[[Dependencies, Request], Any]
Handle = Callable[[dict[str, Any], Dependencies], dict[str, Any]]


def endpoint(action: Action, *, status: int = 200) -> Handle:
    """Wraps a Lambda's action. Every {...} in a route is an id: one that is not an id is 404 before
    touching the database. A 204 answers with no body."""
    def handle(event: dict[str, Any], deps: Dependencies) -> dict[str, Any]:
        try:
            owner = _owner(event)
            path = event.get("pathParameters") or {}
            if not all(isinstance(v, str) and ITEM_ID_RE.match(v) for v in path.values()):
                return response(404, {"error": "não encontrado"})
            method = event["requestContext"]["http"]["method"]
            request = Request(owner, _body(event) if method in ("POST", "PUT") else {},
                              event.get("queryStringParameters") or {}, dict(path), _phone(event), _name(event),
                              _claim(event, "email"))
            result = action(deps, request)
            return response(status, None if status == 204 else result)
        except PermissionError:
            return response(401, {"error": "não autenticado"})
        except BusinessError as error:
            return response(error.status, {"error": str(error)})
        except Exception:
            log.exception("unexpected error")
            return response(500, {"error": "erro interno, tente de novo"})
    return handle


def response(status: int, body: Any = None) -> dict[str, Any]:
    return {"statusCode": status, "headers": {"content-type": "application/json"},
            "body": "" if body is None else json.dumps(body, ensure_ascii=False)}


def _owner(event: dict[str, Any]) -> str:
    """The login's `sub`, from the token API Gateway's JWT authorizer already verified. Never taken
    from the body: that is what keeps each user's data apart."""
    try:
        owner = event["requestContext"]["authorizer"]["jwt"]["claims"]["sub"]
    except (KeyError, TypeError):
        raise PermissionError from None
    if not isinstance(owner, str) or not owner:
        raise PermissionError
    return owner


def _phone(event: dict[str, Any]) -> str:
    """The login's verified phone (`phone_number` in the ID token): invites are sent to a phone."""
    claims = event["requestContext"]["authorizer"]["jwt"]["claims"]
    phone = claims.get("phone_number", "")
    return phone if isinstance(phone, str) and phone.startswith("+") else ""


def _name(event: dict[str, Any]) -> str:
    """The login's name (`name` in the ID token, set when the login is created): how partners see each other."""
    name = event["requestContext"]["authorizer"]["jwt"]["claims"].get("name", "")
    return " ".join(name.split())[:80] if isinstance(name, str) else ""


def _claim(event: dict[str, Any], name: str) -> str:
    value = event["requestContext"]["authorizer"]["jwt"]["claims"].get(name, "")
    return value if isinstance(value, str) else ""


def _body(event: dict[str, Any]) -> dict[str, Any]:
    raw = event.get("body") or ""
    if event.get("isBase64Encoded"):
        raw = base64.b64decode(raw).decode("utf-8", "replace")
    if not raw:
        return {}
    if len(raw) > MAX_BODY:
        raise ValidationError("corpo grande demais")
    try:
        payload = json.loads(raw)
    except ValueError:
        raise ValidationError("corpo não é um JSON válido") from None
    if not isinstance(payload, dict):
        raise ValidationError("o corpo deve ser um objeto JSON")
    return payload
