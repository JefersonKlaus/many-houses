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
MAX_INSTALLMENTS_AT_ONCE = 600              # 50 years of monthly installments

# The screens show these in Portuguese (frontend/js/screens/houses.js).
HOUSE_STATUSES = ("renovating", "ready", "sold")                         # em reforma, pronta, vendida
PAYMENT_TYPES = ("cash", "installments")                                  # à vista, parcelado
MAX_PROFIT_PERCENT = 1000
MAX_AREAS = 30
MAX_AREA_NAME = 40
EXPENSE_CATEGORIES = ("material", "labor", "services", "project", "other")  # material, mão de obra, serviços,
                                                                          # projeto e documentação, outros

# How each API field is named in the (Portuguese) error messages shown to the user.
FIELD_LABELS = {
    "name": "nome", "address": "endereço", "notes": "observações", "status": "situação",
    "purchase_date": "data da compra", "purchase_price_cents": "valor da compra",
    "purchase_costs_cents": "custos da compra", "date": "data", "category": "categoria",
    "description": "descrição", "supplier": "fornecedor", "amount_cents": "valor",
    "down_payment_cents": "entrada", "due_date": "vencimento", "paid_date": "data do pagamento",
    "first_due_date": "primeiro vencimento", "count": "quantidade", "payment_type": "forma de pagamento",
    "target_profit_percent": "lucro desejado", "areas": "áreas", "area_id": "área",
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


def add_months(iso: str, months: int) -> str:
    """"2026-01-31" + 1 month -> "2026-02-28": the same day of the month, or the month's last day."""
    d = date.fromisoformat(iso)
    month_index = d.month - 1 + months
    year, month = d.year + month_index // 12, month_index % 12 + 1
    next_month = date(year + month // 12, month % 12 + 1, 1)
    last_day = (next_month - date.resolution).day
    return date(year, month, min(d.day, last_day)).isoformat()


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


def _percent(payload: Mapping[str, Any], field: str) -> float:
    """A percentage like 30 or 12.5 (two decimals at most); missing = 0."""
    value = payload.get(field)
    if value is None:
        return 0
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value <= MAX_PROFIT_PERCENT:
        raise ValidationError(f"{FIELD_LABELS[field]}: informe um percentual de 0 a {MAX_PROFIT_PERCENT}")
    rounded = round(float(value), 2)
    return int(rounded) if rounded.is_integer() else rounded


def _choice(payload: Mapping[str, Any], field: str, options: tuple[str, ...], default: Optional[str] = None) -> str:
    value = payload.get(field, default)
    if value not in options:
        raise ValidationError(f"{FIELD_LABELS[field]}: escolha uma das opções")
    return value


@dataclass(frozen=True)
class Area:
    """A part of the house that needs renovation: "Cozinha", "Telhado", "Banheiro social"..."""
    id: str
    name: str


def _areas(payload: Mapping[str, Any], previous: tuple[Area, ...]) -> tuple[Area, ...]:
    """The area names typed in, in order. A name that already existed (same name, ignoring case)
    keeps its id, so the costs linked to it stay linked."""
    names = payload.get("areas")
    if names is None:
        return ()
    if not isinstance(names, list) or len(names) > MAX_AREAS:
        raise ValidationError(f"áreas: no máximo {MAX_AREAS}")
    known = {a.name.casefold(): a for a in previous}
    areas, seen = [], set()
    for name in names:
        if not isinstance(name, str) or not name.strip():
            raise ValidationError("áreas: o nome da área não pode ficar vazio")
        cleaned = " ".join(name.split())
        if len(cleaned) > MAX_AREA_NAME:
            raise ValidationError(f"áreas: no máximo {MAX_AREA_NAME} caracteres no nome")
        key = cleaned.casefold()
        if key in seen:
            raise ValidationError(f"áreas: \"{cleaned}\" aparece duas vezes")
        seen.add(key)
        areas.append(Area(known[key].id if key in known else new_id(), cleaned))
    return tuple(areas)


@dataclass(frozen=True)
class House:
    """A house that was bought to be renovated. The purchase is its price plus what it cost to buy it
    (ITBI, deed, registry, broker...); the renovation costs are Expenses. It is bought "cash" (à vista)
    or in "installments" (parcelado): then `down_payment_cents` is the entrada and the rest is paid in
    Installments. `target_profit_percent` is the profit wanted on the sale, over what was invested."""
    id: str
    name: str                       # a short nickname: "Casa da Rua das Flores"
    address: str
    purchase_date: str
    purchase_price_cents: int
    purchase_costs_cents: int = 0
    status: str = "renovating"
    notes: str = ""
    down_payment_cents: int = 0     # entrada: always 0 when bought cash
    payment_type: str = "cash"
    target_profit_percent: float = 0
    areas: tuple[Area, ...] = ()    # the parts that need renovation; each cost may be linked to one

    @classmethod
    def from_input(cls, payload: Mapping[str, Any], id: Optional[str] = None,
                   previous: Optional["House"] = None) -> "House":
        price = _cents(payload, "purchase_price_cents")
        payment_type = _choice(payload, "payment_type", PAYMENT_TYPES, "cash")
        down_payment = _cents(payload, "down_payment_cents", required=False) if payment_type == "installments" else 0
        if down_payment > price:
            raise ValidationError("entrada: não pode ser maior que o valor do imóvel")
        return cls(id or new_id(), _text(payload, "name"), _text(payload, "address", 200),
                   parse_date(payload.get("purchase_date"), FIELD_LABELS["purchase_date"]),
                   price, _cents(payload, "purchase_costs_cents", required=False),
                   _choice(payload, "status", HOUSE_STATUSES, "renovating"),
                   _text(payload, "notes", 2000, required=False), down_payment, payment_type,
                   _percent(payload, "target_profit_percent"), _areas(payload, previous.areas if previous else ()))

    @property
    def purchase_total_cents(self) -> int:
        return self.purchase_price_cents + self.purchase_costs_cents

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: Mapping[str, Any]) -> "House":
        return cls(d["id"], d["name"], d["address"], d["purchase_date"], d["purchase_price_cents"],
                   d.get("purchase_costs_cents", 0), d.get("status", "renovating"), d.get("notes", ""),
                   d.get("down_payment_cents", 0),
                   # saved before the field existed: an entrada meant it was bought in installments
                   d.get("payment_type", "installments" if d.get("down_payment_cents") else "cash"),
                   d.get("target_profit_percent", 0),
                   tuple(Area(a["id"], a["name"]) for a in d.get("areas", ())))


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
    area_id: str = ""               # one of the house's areas; "" = not linked to an area

    @classmethod
    def from_input(cls, payload: Mapping[str, Any], house_id: str, id: Optional[str] = None) -> "Expense":
        area_id = payload.get("area_id") or ""
        if not isinstance(area_id, str) or (area_id and not ITEM_ID_RE.match(area_id)):
            raise ValidationError("área: escolha uma das áreas da casa")
        return cls(id or new_id(), house_id, parse_date(payload.get("date")),
                   _choice(payload, "category", EXPENSE_CATEGORIES),
                   _text(payload, "description", 120), _cents(payload, "amount_cents", minimum=1),
                   _text(payload, "supplier", 80, required=False), area_id)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: Mapping[str, Any]) -> "Expense":
        return cls(d["id"], d["house_id"], d["date"], d["category"], d["description"], d["amount_cents"],
                   d.get("supplier", ""), d.get("area_id", ""))


@dataclass(frozen=True)
class Installment:
    """One prestação of a house's purchase: when it is due, how much, and when it was paid ("" = not yet)."""
    id: str
    house_id: str
    due_date: str
    amount_cents: int
    paid_date: str = ""

    @property
    def paid(self) -> bool:
        return bool(self.paid_date)

    @classmethod
    def from_input(cls, payload: Mapping[str, Any], house_id: str, id: Optional[str] = None) -> "Installment":
        paid_date = payload.get("paid_date") or ""
        return cls(id or new_id(), house_id, parse_date(payload.get("due_date"), FIELD_LABELS["due_date"]),
                   _cents(payload, "amount_cents", minimum=1),
                   parse_date(paid_date, FIELD_LABELS["paid_date"]) if paid_date else "")

    @classmethod
    def plan(cls, payload: Mapping[str, Any], house_id: str) -> list["Installment"]:
        """`count` monthly installments of `amount_cents`, the first one due on `first_due_date`."""
        count = payload.get("count")
        if isinstance(count, bool) or not isinstance(count, int) or not 1 <= count <= MAX_INSTALLMENTS_AT_ONCE:
            raise ValidationError(f"quantidade: de 1 a {MAX_INSTALLMENTS_AT_ONCE} prestações")
        first = parse_date(payload.get("first_due_date"), FIELD_LABELS["first_due_date"])
        amount = _cents(payload, "amount_cents", minimum=1)
        return [cls(new_id(), house_id, add_months(first, n), amount) for n in range(count)]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: Mapping[str, Any]) -> "Installment":
        return cls(d["id"], d["house_id"], d["due_date"], d["amount_cents"], d.get("paid_date", ""))
