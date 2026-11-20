"""Models and validation. Dates are "YYYY-MM-DD"; money is always an integer number of cents
(R$ 1,00 = 100), never a float.

Error messages are shown to the user as-is, so they stay in Portuguese (the app's language)."""
from __future__ import annotations

import re
import uuid
from dataclasses import asdict, dataclass
from datetime import date
from typing import Any, Mapping, Optional

from .errors import ValidationError

ITEM_ID_RE = re.compile(r"^[0-9a-f]{8}$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
MAX_AMOUNT_CENTS = 10_000_000_000           # R$ 100 milhões: no single amount is bigger than this

# The screens show these in Portuguese (frontend/js/screens/houses.js).
HOUSE_STATUSES = ("renovating", "ready", "sold")                         # em reforma, pronta, vendida
EXPENSE_CATEGORIES = ("material", "labor", "services", "project", "other")  # material, mão de obra, serviços,
                                                                          # projeto e documentação, outros

# How each API field is named in the (Portuguese) error messages shown to the user.
FIELD_LABELS = {
    "name": "nome", "address": "endereço", "notes": "observações", "status": "situação",
    "purchase_date": "data da compra", "purchase_price_cents": "valor da compra",
    "purchase_costs_cents": "custos da compra", "date": "data", "category": "categoria",
    "description": "descrição", "supplier": "fornecedor", "amount_cents": "valor",
}


def new_id() -> str:
    return uuid.uuid4().hex[:8]


def parse_date(value: Any, label: str = "data") -> str:
    if not isinstance(value, str) or not _DATE_RE.match(value):
        raise ValidationError(f"{label}: use AAAA-MM-DD")
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError:
        raise ValidationError(f"{label}: essa data não existe") from None


def _text(payload: Mapping[str, Any], field: str, max_length: int = 80, required: bool = True) -> str:
    value = payload.get(field)
    label = FIELD_LABELS[field]
    if value is None and not required:
        return ""
    if not isinstance(value, str) or (required and not value.strip()):
        raise ValidationError(f"{label}: preencha este campo")
    cleaned = " ".join(value.split()) if max_length <= 200 else value.strip()   # long texts keep their lines
    if len(cleaned) > max_length:
        raise ValidationError(f"{label}: no máximo {max_length} caracteres")
    return cleaned


def _cents(payload: Mapping[str, Any], field: str, minimum: int = 0, required: bool = True) -> int:
    value = payload.get(field)
    if value is None and not required:
        return 0
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= MAX_AMOUNT_CENTS:
        raise ValidationError(f"{FIELD_LABELS[field]}: informe um valor em centavos de {minimum} "
                              f"a {MAX_AMOUNT_CENTS}")
    return value


def _choice(payload: Mapping[str, Any], field: str, options: tuple[str, ...], default: Optional[str] = None) -> str:
    value = payload.get(field, default)
    if value not in options:
        raise ValidationError(f"{FIELD_LABELS[field]}: escolha uma das opções")
    return value


@dataclass(frozen=True)
class House:
    """A house that was bought to be renovated. The purchase is its price plus what it cost to buy it
    (ITBI, deed, registry, broker...); the renovation costs are Expenses."""
    id: str
    name: str                       # a short nickname: "Casa da Rua das Flores"
    address: str
    purchase_date: str
    purchase_price_cents: int
    purchase_costs_cents: int = 0
    status: str = "renovating"
    notes: str = ""

    @classmethod
    def from_input(cls, payload: Mapping[str, Any], id: Optional[str] = None) -> "House":
        return cls(id or new_id(), _text(payload, "name"), _text(payload, "address", 200),
                   parse_date(payload.get("purchase_date"), FIELD_LABELS["purchase_date"]),
                   _cents(payload, "purchase_price_cents"),
                   _cents(payload, "purchase_costs_cents", required=False),
                   _choice(payload, "status", HOUSE_STATUSES, "renovating"),
                   _text(payload, "notes", 2000, required=False))

    @property
    def purchase_total_cents(self) -> int:
        return self.purchase_price_cents + self.purchase_costs_cents

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: Mapping[str, Any]) -> "House":
        return cls(d["id"], d["name"], d["address"], d["purchase_date"], d["purchase_price_cents"],
                   d.get("purchase_costs_cents", 0), d.get("status", "renovating"), d.get("notes", ""))


@dataclass(frozen=True)
class Expense:
    """One renovation cost of a house: a purchase of material, a payment to a worker, a service..."""
    id: str
    house_id: str
    date: str
    category: str
    description: str
    amount_cents: int
    supplier: str = ""

    @classmethod
    def from_input(cls, payload: Mapping[str, Any], house_id: str, id: Optional[str] = None) -> "Expense":
        return cls(id or new_id(), house_id, parse_date(payload.get("date")),
                   _choice(payload, "category", EXPENSE_CATEGORIES),
                   _text(payload, "description", 120), _cents(payload, "amount_cents", minimum=1),
                   _text(payload, "supplier", 80, required=False))

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: Mapping[str, Any]) -> "Expense":
        return cls(d["id"], d["house_id"], d["date"], d["category"], d["description"], d["amount_cents"],
                   d.get("supplier", ""))
