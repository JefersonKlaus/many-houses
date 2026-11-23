"""Models and validation. Dates are "YYYY-MM-DD"; money is always an integer number of cents
(R$ 1,00 = 100), never a float.

Error messages are shown to the user as-is, so they stay in Portuguese (the app's language)."""
from __future__ import annotations

import re
import uuid
from dataclasses import asdict, dataclass, replace
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
MAX_PARTNERS = 10
MAX_BUNDLE_HOUSES = 10          # houses bought at once, in one deal
MAX_TIMELINE_PHOTOS = 12        # photos in one timeline entry
OWNER_MEMBER_ID = "00000000"    # the house's owner among its members (in `paid_by` and in the purchase shares)
_PHONE_RE = re.compile(r"^[1-9]{2}\d{8,9}$")
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
    "target_profit_percent": "lucro desejado", "areas": "áreas", "area_id": "área", "paid_by": "pago por",
    "phone": "celular", "nf_photo": "foto da NF", "material_photo": "foto do material ou serviço",
    "caption": "descrição", "default_profit_percent": "lucro desejado padrão", "total_cents": "valor total da parcela",
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


def split_cents(total: int, weights: list[int]) -> list[int]:
    """Splits `total` cents in proportion to `weights` (a house of 500 and another of 250: two thirds and
    one third), with no cent lost: the leftover cents go to the biggest remainders. All weights 0: equal parts."""
    if not any(weights):
        weights = [1] * len(weights)
    whole = sum(weights)
    parts = [total * w // whole for w in weights]
    by_remainder = sorted(range(len(weights)), key=lambda n: (-(total * weights[n] % whole), n))
    for n in by_remainder[:total - sum(parts)]:
        parts[n] += 1
    return parts


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


def phone_number(value: Any) -> str:
    """"11987654321" (DDD + number, digits only, like the login screen) -> "+5511987654321"."""
    if not isinstance(value, str) or not _PHONE_RE.match(value.strip()):
        raise ValidationError("celular: digite DDD + número, só os dígitos")
    return f"+55{value.strip()}"


def photo_key(owner: str, house_id: str, photo_id: str) -> str:
    """Where a photo is kept: under its house, so a house's records can only point at its own photos."""
    return f"{owner}/{house_id}/{photo_id}.jpg"


def _photo(payload: Mapping[str, Any], field: str) -> str:
    """A photo's id (given by POST /houses/{id}/photos); "" for none."""
    value = payload.get(field) or ""
    if not isinstance(value, str) or (value and not ITEM_ID_RE.match(value)):
        raise ValidationError(f"{FIELD_LABELS[field]}: envie a foto de novo")
    return value


def _member_id(payload: Mapping[str, Any], field: str = "paid_by") -> str:
    """A member of the house (OWNER_MEMBER_ID or a partner's id); "" when not given."""
    value = payload.get(field) or ""
    if not isinstance(value, str) or (value and not ITEM_ID_RE.match(value)):
        raise ValidationError(f"{FIELD_LABELS[field]}: escolha um dos sócios da casa")
    return value


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
class Partner:
    """Someone who bought the house together with its owner and accepted the invite: `user` is their
    login (`sub`), `id` is how the house's records refer to them (`paid_by`, the purchase shares)."""
    id: str
    user: str
    phone: str
    name: str = ""


@dataclass(frozen=True)
class Invite:
    """An invite to be a partner, sent to a phone, waiting to be accepted or declined."""
    id: str
    phone: str
    date: str


@dataclass(frozen=True)
class Share:
    """How much of the purchase (what was paid up front: the price when cash, the entrada when in
    installments, plus the purchase costs) one member paid. Only set when the house is registered."""
    member_id: str
    cents: int


def brl(cents: int) -> str:
    """123456 -> "R$ 1.234,56", for the messages."""
    whole, rest = divmod(abs(cents), 100)
    return f"{'-' if cents < 0 else ''}R$ {whole:,}".replace(",", ".") + f",{rest:02d}"


def bought_with_partners(payload: Mapping[str, Any], upfront_cents: int, owner_phone: str,
                         today: str) -> tuple[tuple[Invite, ...], tuple[Share, ...]]:
    """When a house is registered as bought with partners: `partners` [{phone, cents}] and the owner's own
    `owner_share_cents`, how much each one paid at the purchase. Each partner gets an invite; the shares
    must add up to what was paid at the purchase (the split is only set here, in the act of buying)."""
    partners = payload.get("partners") or []
    if not isinstance(partners, list) or len(partners) > MAX_PARTNERS:
        raise ValidationError(f"sócios: no máximo {MAX_PARTNERS}")
    if not partners:
        return (), ()
    def amount(value: Any) -> int:
        if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= MAX_AMOUNT_CENTS:
            raise ValidationError("divisão da compra: informe quanto cada um pagou")
        return value
    owner_share = amount(payload.get("owner_share_cents", 0))
    invites, shares, seen = [], [Share(OWNER_MEMBER_ID, owner_share)] if owner_share else [], {owner_phone}
    for partner in partners:
        if not isinstance(partner, Mapping):
            raise ValidationError("sócios: informe o celular e quanto cada um pagou")
        phone = phone_number(partner.get("phone"))
        if phone in seen:
            raise ValidationError("sócios: o mesmo celular aparece duas vezes (ou é o seu)")
        seen.add(phone)
        invite = Invite(new_id(), phone, today)
        invites.append(invite)
        cents = amount(partner.get("cents"))
        if cents:
            shares.append(Share(invite.id, cents))
    total = sum(s.cents for s in shares)
    if total != upfront_cents:
        raise ValidationError(f"divisão da compra: a soma ({brl(total)}) precisa fechar com o que foi pago "
                              f"na compra ({brl(upfront_cents)})")
    return tuple(invites), tuple(shares)


@dataclass(frozen=True)
class PendingInvite:
    """The invite as its guest sees it, kept under their phone: from whom, to which house."""
    id: str
    phone: str
    owner: str
    house_id: str
    house_name: str
    from_phone: str
    date: str
    from_name: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: Mapping[str, Any]) -> "PendingInvite":
        return cls(d["id"], d["phone"], d["owner"], d["house_id"], d["house_name"], d["from_phone"], d["date"],
                   d.get("from_name", ""))


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
    owner_phone: str = ""
    partners: tuple[Partner, ...] = ()
    invites: tuple[Invite, ...] = ()
    purchase_shares: tuple[Share, ...] = ()     # set at registration; empty: the owner paid the whole purchase
    owner_name: str = ""
    bundle_id: str = ""             # houses bought in one deal share it ("compra conjunta"); "" = bought alone

    @classmethod
    def from_input(cls, payload: Mapping[str, Any], id: Optional[str] = None,
                   previous: Optional["House"] = None) -> "House":
        price = _cents(payload, "purchase_price_cents")
        payment_type = _choice(payload, "payment_type", PAYMENT_TYPES, "cash")
        down_payment = _cents(payload, "down_payment_cents", required=False) if payment_type == "installments" else 0
        if down_payment > price:
            raise ValidationError("entrada: não pode ser maior que o valor do imóvel")
        # who it belongs to and its partners never come from the form: they are kept from before
        return cls(id or new_id(), _text(payload, "name"), _text(payload, "address", 200),
                   parse_date(payload.get("purchase_date"), FIELD_LABELS["purchase_date"]),
                   price, _cents(payload, "purchase_costs_cents", required=False),
                   _choice(payload, "status", HOUSE_STATUSES, "renovating"),
                   _text(payload, "notes", 2000, required=False), down_payment, payment_type,
                   _percent(payload, "target_profit_percent"), _areas(payload, previous.areas if previous else ()),
                   previous.owner_phone if previous else "", previous.partners if previous else (),
                   previous.invites if previous else (), previous.purchase_shares if previous else (),
                   previous.owner_name if previous else "", previous.bundle_id if previous else "")

    @classmethod
    def bundle_from_input(cls, payload: Mapping[str, Any], also: Any) -> list["House"]:
        """The house of the form plus the others bought in the same deal (`also`: [{name, address,
        purchase_price_cents, purchase_costs_cents, areas, notes, status, target_profit_percent}]). The date and
        the payment type are the deal's. The entrada is one for the whole deal: each house takes its part of it in
        proportion to its price. Without `also`, just the one house."""
        if not also:
            return [cls.from_input(payload)]
        if not isinstance(also, list) or len(also) + 1 > MAX_BUNDLE_HOUSES:
            raise ValidationError(f"casas da mesma compra: no máximo {MAX_BUNDLE_HOUSES}")
        if any(not isinstance(item, Mapping) for item in also):
            raise ValidationError("casas da mesma compra: informe nome, endereço e valor de cada uma")
        items = [payload, *also]
        prices = [_cents(item, "purchase_price_cents") for item in items]
        payment_type = _choice(payload, "payment_type", PAYMENT_TYPES, "cash")
        down = _cents(payload, "down_payment_cents", required=False) if payment_type == "installments" else 0
        if down > sum(prices):
            raise ValidationError("entrada: não pode ser maior que a soma dos valores dos imóveis")
        bundle_id = new_id()
        deal = {k: payload[k] for k in ("purchase_date", "payment_type") if k in payload}
        houses = []
        for item, share in zip(items, split_cents(down, prices)):
            own = {k: item[k] for k in ("name", "address", "purchase_price_cents", "purchase_costs_cents", "notes",
                                        "areas", "status", "target_profit_percent") if k in item}
            houses.append(replace(cls.from_input({**deal, **own, "down_payment_cents": share}), bundle_id=bundle_id))
        return houses

    @property
    def upfront_cents(self) -> int:
        """What was paid at the purchase: the price (cash) or the entrada (installments), plus its costs."""
        paid = self.down_payment_cents if self.payment_type == "installments" else self.purchase_price_cents
        return paid + self.purchase_costs_cents

    @property
    def member_ids(self) -> list[str]:
        """The owner, the partners and whoever was invited and didn't answer yet: an invited partner keeps
        the invite's id when accepting, so what was registered for them (their share of the purchase,
        what they paid) stays theirs."""
        return [OWNER_MEMBER_ID] + [p.id for p in self.partners] + [i.id for i in self.invites]

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
                   tuple(Area(a["id"], a["name"]) for a in d.get("areas", ())),
                   d.get("owner_phone", ""),
                   tuple(Partner(p["id"], p["user"], p["phone"], p.get("name", "")) for p in d.get("partners", ())),
                   tuple(Invite(i["id"], i["phone"], i["date"]) for i in d.get("invites", ())),
                   tuple(Share(s["member_id"], s["cents"]) for s in d.get("purchase_shares", ())),
                   d.get("owner_name", ""), d.get("bundle_id", ""))


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
    paid_by: str = ""               # the member who paid it; "" = the owner
    nf_photo: str = ""              # a photo of the invoice (nota fiscal); "" = none
    material_photo: str = ""        # a photo of the material or of the work done; "" = none

    @property
    def photos(self) -> list[str]:
        return [p for p in (self.nf_photo, self.material_photo) if p]

    @classmethod
    def from_input(cls, payload: Mapping[str, Any], house_id: str, id: Optional[str] = None) -> "Expense":
        area_id = payload.get("area_id") or ""
        if not isinstance(area_id, str) or (area_id and not ITEM_ID_RE.match(area_id)):
            raise ValidationError("área: escolha uma das áreas da casa")
        return cls(id or new_id(), house_id, parse_date(payload.get("date")),
                   _choice(payload, "category", EXPENSE_CATEGORIES),
                   _text(payload, "description", 120), _cents(payload, "amount_cents", minimum=1),
                   _text(payload, "supplier", 80, required=False), area_id, _member_id(payload),
                   _photo(payload, "nf_photo"), _photo(payload, "material_photo"))

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: Mapping[str, Any]) -> "Expense":
        return cls(d["id"], d["house_id"], d["date"], d["category"], d["description"], d["amount_cents"],
                   d.get("supplier", ""), d.get("area_id", ""), d.get("paid_by", ""),
                   d.get("nf_photo", ""), d.get("material_photo", ""))


@dataclass(frozen=True)
class Installment:
    """One prestação of a house's purchase: when it is due, how much, and when it was paid ("" = not yet)."""
    id: str
    house_id: str
    due_date: str
    amount_cents: int
    paid_date: str = ""
    paid_by: str = ""               # the member who paid it (when paid); "" = the owner
    group_id: str = ""              # the installments of the same month of houses bought in one deal share it
    total_cents: int = 0            # that month's whole installment (all the houses); 0 = not in a group

    @property
    def paid(self) -> bool:
        return bool(self.paid_date)

    @classmethod
    def from_input(cls, payload: Mapping[str, Any], house_id: str, id: Optional[str] = None) -> "Installment":
        paid_date = payload.get("paid_date") or ""
        return cls(id or new_id(), house_id, parse_date(payload.get("due_date"), FIELD_LABELS["due_date"]),
                   _cents(payload, "amount_cents", minimum=1),
                   parse_date(paid_date, FIELD_LABELS["paid_date"]) if paid_date else "",
                   _member_id(payload) if paid_date else "")

    @classmethod
    def plan(cls, payload: Mapping[str, Any], house_id: str) -> list["Installment"]:
        """`count` monthly installments of `amount_cents`, the first one due on `first_due_date`."""
        count = payload.get("count")
        if isinstance(count, bool) or not isinstance(count, int) or not 1 <= count <= MAX_INSTALLMENTS_AT_ONCE:
            raise ValidationError(f"quantidade: de 1 a {MAX_INSTALLMENTS_AT_ONCE} prestações")
        first = parse_date(payload.get("first_due_date"), FIELD_LABELS["first_due_date"])
        amount = _cents(payload, "amount_cents", minimum=1)
        return [cls(new_id(), house_id, add_months(first, n), amount) for n in range(count)]

    @classmethod
    def plan_group(cls, payload: Mapping[str, Any], houses: list["House"]) -> list["Installment"]:
        """The same plan for houses bought in one deal: `amount_cents` is the whole installment, and each
        house gets its part of it in proportion to its price (a 500 and a 250 house: two thirds and one third)."""
        planned, weights = cls.plan(payload, houses[0].id), [h.purchase_price_cents for h in houses]
        installments = []
        for month in planned:
            group = new_id()
            for house, cents in zip(houses, split_cents(month.amount_cents, weights)):
                installments.append(cls(new_id(), house.id, month.due_date, cents, group_id=group,
                                        total_cents=month.amount_cents))
        return installments

    @staticmethod
    def edit_group(siblings: list["Installment"], edited: "Installment",
                   payload: Mapping[str, Any]) -> list["Installment"]:
        """One installment of a group was edited: its due date and payment are everyone's, and a new
        `total_cents` is split again among the houses in the proportion they already had."""
        total = _cents(payload, "total_cents", minimum=1) if "total_cents" in payload else siblings[0].total_cents
        parts = split_cents(total, [s.amount_cents for s in siblings])
        return [replace(s, due_date=edited.due_date, paid_date=edited.paid_date, paid_by=edited.paid_by,
                        amount_cents=cents, total_cents=total) for s, cents in zip(siblings, parts)]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: Mapping[str, Any]) -> "Installment":
        return cls(d["id"], d["house_id"], d["due_date"], d["amount_cents"], d.get("paid_date", ""),
                   d.get("paid_by", ""), d.get("group_id", ""), d.get("total_cents", 0))


@dataclass(frozen=True)
class TimelineEntry:
    """A moment of the house's story, from the purchase to the end of the renovation: a date, what it
    shows and its photos."""
    id: str
    house_id: str
    date: str
    caption: str
    photos: tuple[str, ...]

    @classmethod
    def from_input(cls, payload: Mapping[str, Any], house_id: str, id: Optional[str] = None) -> "TimelineEntry":
        photos = payload.get("photos")
        if not isinstance(photos, list) or not 1 <= len(photos) <= MAX_TIMELINE_PHOTOS:
            raise ValidationError(f"fotos: de 1 a {MAX_TIMELINE_PHOTOS} por registro")
        if any(not isinstance(p, str) or not ITEM_ID_RE.match(p) for p in photos) or len(set(photos)) != len(photos):
            raise ValidationError("fotos: envie as fotos de novo")
        return cls(id or new_id(), house_id, parse_date(payload.get("date")),
                   _text(payload, "caption", 200, required=False), tuple(photos))

    def to_dict(self) -> dict[str, Any]:
        return {**asdict(self), "photos": list(self.photos)}

    @classmethod
    def from_dict(cls, d: Mapping[str, Any]) -> "TimelineEntry":
        return cls(d["id"], d["house_id"], d["date"], d.get("caption", ""), tuple(d.get("photos", ())))


@dataclass(frozen=True)
class Profile:
    """The user's settings: the name partners see (when empty, the login's name) and the profit wanted
    that a new house starts with."""
    name: str = ""
    default_profit_percent: float = 0

    @classmethod
    def from_input(cls, payload: Mapping[str, Any]) -> "Profile":
        return cls(_text(payload, "name", 80, required=False), _percent(payload, "default_profit_percent"))

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: Mapping[str, Any]) -> "Profile":
        return cls(d.get("name", ""), d.get("default_profit_percent", 0))
