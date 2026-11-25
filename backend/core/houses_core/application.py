"""Application rules that more than one use case applies. They only go through the ports."""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, replace
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable

from .domain.errors import NotFound, ValidationError
from .domain.models import (EXPENSE_CATEGORIES, OWNER_MEMBER_ID, Expense, House, Installment, TimelineEntry,
                            add_months, photo_key)
from .ports import Dependencies, Repository

MAX_HOUSES = 500
MAX_EXPENSES_PER_HOUSE = 2000
MAX_INSTALLMENTS_PER_HOUSE = 600


def today() -> str:
    """Today in Brasília (UTC-3 all year), "YYYY-MM-DD", like the screens' today()."""
    return (datetime.now(timezone.utc) - timedelta(hours=3)).date().isoformat()


@dataclass(frozen=True)
class Access:
    """A user's access to a house: `owner` is whose data it is kept in (whoever registered it), `member_id`
    is who the user is in it (OWNER_MEMBER_ID for whoever registered it, the partner's id for the others).
    It is only about where the data is: all partners can do the same things."""
    owner: str
    house: House
    member_id: str

    @property
    def is_owner(self) -> bool:
        return self.member_id == OWNER_MEMBER_ID


def house_access(repo: Repository, user: str, id: Any) -> Access:
    """The user's own house, or a house they are a partner in. Anything else: not found (whoever is not
    in a house doesn't even learn that it exists)."""
    if not isinstance(id, str):
        raise NotFound("casa não encontrada")
    house = repo.get_house(user, id)
    if house is not None:
        return Access(user, house, OWNER_MEMBER_ID)
    owner = repo.get_link(user, id)
    house = repo.get_house(owner, id) if owner else None
    partner = next((p for p in house.partners if p.user == user), None) if house else None
    if partner is None:
        raise NotFound("casa não encontrada")
    return Access(owner, house, partner.id)


def get_expense(repo: Repository, access: Access, id: Any) -> Expense:
    expense = repo.get_expense(access.owner, access.house.id, id) if isinstance(id, str) else None
    if expense is None:
        raise NotFound("custo não encontrado")
    return expense


def get_installment(repo: Repository, access: Access, id: Any) -> Installment:
    installment = repo.get_installment(access.owner, access.house.id, id) if isinstance(id, str) else None
    if installment is None:
        raise NotFound("prestação não encontrada")
    return installment


def check_house_limit(repo: Repository, owner: str, adding: int = 1) -> None:
    if len(repo.list_houses(owner)) + adding > MAX_HOUSES:
        raise ValidationError(f"limite de {MAX_HOUSES} casas atingido")


def check_expense_limit(repo: Repository, owner: str, house_id: str) -> None:
    if len(repo.list_expenses(owner, house_id)) >= MAX_EXPENSES_PER_HOUSE:
        raise ValidationError(f"limite de {MAX_EXPENSES_PER_HOUSE} custos nesta casa atingido")


def check_expense_area(house: House, expense: Expense) -> None:
    if expense.area_id and expense.area_id not in {a.id for a in house.areas}:
        raise ValidationError("área: escolha uma das áreas da casa")


def check_member(house: House, member_id: str) -> None:
    if member_id and member_id not in house.member_ids:
        raise ValidationError("pago por: escolha um dos sócios da casa")


def check_removed_areas_have_no_costs(repo: Repository, owner: str, before: House, after: House) -> None:
    """An area can only leave the house when no cost is linked to it (they would lose their area)."""
    kept = {a.id for a in after.areas}
    removed = {a.id: a.name for a in before.areas if a.id not in kept}
    if not removed:
        return
    used = {e.area_id for e in repo.list_expenses(owner, before.id)}
    for area_id, name in removed.items():
        if area_id in used:
            raise ValidationError(f"área \"{name}\" tem custos lançados: mude esses custos de área antes de removê-la")


def check_bought_in_installments(house: House) -> None:
    if house.payment_type != "installments":
        raise ValidationError("esta casa foi comprada à vista: mude a forma de pagamento para parcelado")


def check_installment_limit(repo: Repository, owner: str, house_id: str, adding: int) -> None:
    if len(repo.list_installments(owner, house_id)) + adding > MAX_INSTALLMENTS_PER_HOUSE:
        raise ValidationError(f"limite de {MAX_INSTALLMENTS_PER_HOUSE} prestações nesta casa")


def bundle_houses(repo: Repository, owner: str, house: House) -> list[House]:
    """The houses bought in the same deal as `house` (itself included), in a fixed order; just itself when
    it was bought alone."""
    if not house.bundle_id:
        return [house]
    deal = [h for h in repo.list_houses(owner) if h.bundle_id == house.bundle_id]
    return sorted(deal, key=lambda h: h.id) if len(deal) > 1 else [house]


def group_siblings(repo: Repository, owner: str, installment: Installment) -> list[Installment]:
    """The installment and its ones of the other houses of the deal (the same month), in a fixed order."""
    if not installment.group_id:
        return [installment]
    return sorted((i for i in repo.list_installments(owner) if i.group_id == installment.group_id),
                  key=lambda i: i.house_id)


def same_member(source: House, member_id: str, target: House) -> str:
    """Who `member_id` of one house of a deal is in another house of it: the owner is the owner everywhere, a
    partner is found by phone (each house has its own ids); "" (the owner) if they are not in the other."""
    if member_id in ("", OWNER_MEMBER_ID):
        return member_id
    phone = next((m["phone"] for m in members(source) if m["id"] == member_id), None)
    return next((m["id"] for m in members(target) if phone and m["phone"] == phone), "")


def leave_bundle(repo: Repository, owner: str, house: House) -> None:
    """A house of a deal was deleted: what is left of the deal keeps its installments, now adding up to
    the houses that remain (and a house left alone is just a house again)."""
    if not house.bundle_id:
        return
    left = [h for h in repo.list_houses(owner) if h.bundle_id == house.bundle_id and h.id != house.id]
    alone = len(left) < 2
    if alone:
        for h in left:
            repo.save_house(owner, replace(h, bundle_id=""))
    months = defaultdict(list)
    for i in repo.list_installments(owner):
        if i.group_id and i.house_id in {h.id for h in left}:
            months[i.group_id].append(i)
    repo.save_installments(owner, [replace(i, group_id="" if alone else i.group_id,
                                           total_cents=0 if alone else sum(m.amount_cents for m in items))
                                   for items in months.values() for i in items])


def sorted_houses(houses: Iterable[House]) -> list[House]:
    """By name, the sold ones always last."""
    return sorted(houses, key=lambda h: (h.status == "sold", h.name.lower(), h.id))


def sorted_expenses(expenses: Iterable[Expense]) -> list[Expense]:
    """Newest first."""
    return sorted(expenses, key=lambda e: (e.date, e.id), reverse=True)


def sorted_installments(installments: Iterable[Installment]) -> list[Installment]:
    """In the order they are due."""
    return sorted(installments, key=lambda i: (i.due_date, i.id))


def members(house: House) -> list[dict[str, Any]]:
    """The owner first, then the partners, then the ones invited who didn't answer yet ("invited"):
    how the screens list and name them."""
    return ([{"id": OWNER_MEMBER_ID, "name": house.owner_name, "phone": house.owner_phone, "role": "owner"}]
            + [{"id": p.id, "name": p.name, "phone": p.phone, "role": "partner"} for p in house.partners]
            + [{"id": i.id, "name": "", "phone": i.phone, "role": "invited"} for i in house.invites])


def user_name(repo: Repository, user: str, login_name: str) -> str:
    """The name the user chose in the settings or, without one, their login's (Cognito's `name`)."""
    profile = repo.get_profile(user)
    return (profile.name if profile and profile.name else "") or login_name


def with_my_name(access: Access, name: str) -> House:
    """The house with the user's current name (it can change in their login): kept on each change they make."""
    house = access.house
    if not name:
        return house
    if access.is_owner:
        return house if house.owner_name == name else replace(house, owner_name=name)
    return replace(house, partners=tuple(replace(p, name=name) if p.id == access.member_id else p
                                         for p in house.partners))


def totals(house: House, expenses: Iterable[Expense], installments: Iterable[Installment] = ()) -> dict[str, Any]:
    """What a house cost: the purchase (price + its costs), the renovation (by category and by area)
    and the sum. `payment`: how the price is being paid, the entrada plus the installments paid and open.
    `by_area`: each of the house's areas, in its order, with its costs; `no_area_cents`: costs with no area.
    `recurring_cents`: the recurring costs (energy, water, internet...), by name (their description, ignoring case) in
    `by_recurring` [{name, cents, count}], the biggest first; they are
    not renovation, but count in `total_cents`. `by_member`: what each member put in so far (see `by_member`)."""
    expenses, installments = list(expenses), list(installments)
    by_category = dict.fromkeys(EXPENSE_CATEGORIES, 0)
    by_recurring: dict[str, dict[str, Any]] = {}
    by_area = {a.id: {"id": a.id, "name": a.name, "cents": 0, "count": 0} for a in house.areas}
    no_area = count = 0
    for e in expenses:
        if e.recurring:
            group = by_recurring.setdefault(e.description.casefold(), {"name": e.description, "cents": 0, "count": 0})
            group["cents"] += e.amount_cents
            group["count"] += 1
            continue
        by_category[e.category] += e.amount_cents
        count += 1
        if e.area_id in by_area:
            by_area[e.area_id]["cents"] += e.amount_cents
            by_area[e.area_id]["count"] += 1
        else:
            no_area += e.amount_cents
    by_recurring = sorted(by_recurring.values(), key=lambda g: (-g["cents"], g["name"]))
    renovation, recurring = sum(by_category.values()), sum(g["cents"] for g in by_recurring)
    invested = house.purchase_total_cents + renovation + recurring
    return {"purchase_cents": house.purchase_total_cents, "renovation_cents": renovation,
            "recurring_cents": recurring, "by_recurring": by_recurring,
            "recurring_count": sum(1 for e in expenses if e.recurring),
            "total_cents": invested, "expense_count": count,
            "by_category": by_category, "by_area": list(by_area.values()), "no_area_cents": no_area,
            "payment": payment(house, installments),
            "sale": sale(house, invested),
            **by_member(house, expenses, installments)}


def by_member(house: House, expenses: list[Expense], installments: list[Installment]) -> dict[str, Any]:
    """How much each member actually put into the house so far: their share of the purchase (what was
    paid up front), the installments they paid and the renovation and recurring costs they paid. A record with no
    `paid_by` (or of someone no longer in the house: a declined invite) counts for the owner. `purchase_unassigned_cents`:
    what was paid up front that the shares don't cover yet (negative: the shares add up to more)."""
    ids = house.member_ids
    rows = {m: {"member_id": m, "purchase_cents": 0, "installments_cents": 0, "renovation_cents": 0,
                              "recurring_cents": 0} for m in ids}
    who = lambda member_id: member_id if member_id in rows else OWNER_MEMBER_ID  # noqa: E731
    if house.purchase_shares:
        for share in house.purchase_shares:
            rows[who(share.member_id)]["purchase_cents"] += share.cents
        unassigned = house.upfront_cents - sum(s.cents for s in house.purchase_shares)
    else:
        rows[OWNER_MEMBER_ID]["purchase_cents"] = house.upfront_cents
        unassigned = 0
    for i in installments:
        if i.paid:
            rows[who(i.paid_by)]["installments_cents"] += i.amount_cents
    for e in expenses:
        rows[who(e.paid_by)]["recurring_cents" if e.recurring else "renovation_cents"] += e.amount_cents
    for row in rows.values():
        row["total_cents"] = (row["purchase_cents"] + row["installments_cents"] + row["renovation_cents"]
                              + row["recurring_cents"])
    return {"by_member": list(rows.values()), "purchase_unassigned_cents": unassigned}


def sale(house: House, invested_cents: int) -> dict[str, Any]:
    """For how much to sell the house today, as it is, to make the profit wanted: what was invested
    so far (purchase + renovation) plus that percentage of it."""
    profit = round(invested_cents * house.target_profit_percent / 100)
    return {"target_profit_percent": house.target_profit_percent, "target_profit_cents": profit,
            "suggested_price_cents": invested_cents + profit}


def payment(house: House, installments: Iterable[Installment]) -> dict[str, Any]:
    installments = list(installments)
    paid = [i for i in installments if i.paid]
    open_ = sorted_installments(i for i in installments if not i.paid)
    paid_cents = sum(i.amount_cents for i in paid)
    return {"down_payment_cents": house.down_payment_cents,
            "installments_count": len(installments), "installments_cents": sum(i.amount_cents for i in installments),
            "paid_count": len(paid), "paid_cents": paid_cents, "open_cents": sum(i.amount_cents for i in open_),
            "next_due_date": open_[0].due_date if open_ else None,
            "total_paid_cents": house.down_payment_cents + paid_cents}


def public_house(house: House) -> dict[str, Any]:
    """The house as the screens get it: the partners' logins (`user`) are not shown, only their phones."""
    data = house.to_dict()
    data["partners"] = [{"id": p.id, "name": p.name, "phone": p.phone} for p in house.partners]
    for key in ("areas", "invites", "purchase_shares", "recurring_bills"):        # lists, as in the JSON the screens get
        data[key] = list(data[key])
    return data


WARN_DAYS = 2           # a bill or an installment due in this many days (or less) is warned about


def _days_between(first: str, last: str) -> int:
    return (date.fromisoformat(last) - date.fromisoformat(first)).days


def due_soon(house: House, expenses: Iterable[Expense], installments: Iterable[Installment],
             on: str) -> list[dict[str, Any]]:
    """What the house has to pay soon, on the day `on`: its unpaid installments and its recurring bills due in up to
    WARN_DAYS days (or already late: an installment at any time, a bill from this month). A bill is paid when a
    recurring cost with its name (ignoring case) refers to the month of its due date (Expense.month). `days`: until the
    due date (negative: late), the soonest first."""
    due = []
    for i in installments:
        if not i.paid and _days_between(on, i.due_date) <= WARN_DAYS:
            due.append({"house_id": house.id, "house_name": house.name, "type": "installment", "name": "Prestação",
                        "due_date": i.due_date, "days": _days_between(on, i.due_date), "amount_cents": i.amount_cents})
    paid = {(e.description.casefold(), e.month) for e in expenses if e.recurring}
    first_of_month = on[:8] + "01"
    for bill in house.recurring_bills:
        for month in (first_of_month, add_months(first_of_month, 1)):
            last_day = (date.fromisoformat(add_months(month, 1)) - timedelta(days=1)).day
            due_date = f"{month[:8]}{min(bill.day, last_day):02d}"
            days = _days_between(on, due_date)
            if bill.due_in(month[:7]) and days <= WARN_DAYS and (bill.name.casefold(), month[:7]) not in paid and (days >= 0 or month == first_of_month):
                due.append({"house_id": house.id, "house_name": house.name, "type": "recurring", "name": bill.name,
                            "due_date": due_date, "days": days, "amount_cents": 0})
    return sorted(due, key=lambda d: (d["days"], d["house_name"], d["name"]))


def sorted_timeline(entries: Iterable[TimelineEntry]) -> list[TimelineEntry]:
    """From the purchase to the end: oldest first."""
    return sorted(entries, key=lambda t: (t.date, t.id))


def photo_keys(access: Access, photo_ids: Iterable[str]) -> list[str]:
    return [photo_key(access.owner, access.house.id, p) for p in photo_ids if p]


def delete_photos(deps: Dependencies, access: Access, photo_ids: Iterable[str]) -> None:
    if deps.photos is not None:
        keys = photo_keys(access, photo_ids)
        if keys:
            deps.photos.delete(keys)


def bundle_view(repo: Repository, access: Access) -> list[dict[str, Any]]:
    """The houses bought in the same deal as this one, with the part of each installment that is theirs
    (their price over the deal's); [] when it was bought alone."""
    deal = bundle_houses(repo, access.owner, access.house)
    if len(deal) < 2:
        return []
    weights = [h.purchase_price_cents for h in deal]
    if not any(weights):
        weights = [1] * len(deal)
    return [{"id": h.id, "name": h.name, "price_cents": h.purchase_price_cents,
             "percent": round(100 * w / sum(weights), 2)} for h, w in zip(deal, weights)]


def house_view(deps: Dependencies, access: Access) -> dict[str, Any]:
    """One house's page: the house, its members, its costs (newest first), its installments (in due
    order), its timeline (oldest first) and the totals. Each photo comes with a link valid for a while.
    GET /houses/{id} answers this, and so does every change to a house, so the screen redraws at once,
    without a second request. `me`: who the user is among the members."""
    repo, house = deps.repo, access.house
    url = lambda photo_id: (deps.photos.view_url(photo_key(access.owner, house.id, photo_id))  # noqa: E731
                            if deps.photos is not None and photo_id else "")
    expenses = sorted_expenses(repo.list_expenses(access.owner, house.id))
    installments = sorted_installments(repo.list_installments(access.owner, house.id))
    timeline = sorted_timeline(repo.list_timeline(access.owner, house.id))
    return {"house": public_house(house), "members": members(house), "bundle": bundle_view(repo, access),
            "me": access.member_id, "role": "owner" if access.is_owner else "partner",
            "expenses": [{**e.to_dict(), "nf_photo_url": url(e.nf_photo), "material_photo_url": url(e.material_photo)}
                         for e in expenses],
            "installments": [i.to_dict() for i in installments],
            "due_soon": due_soon(house, expenses, installments, today()),
            "timeline": [{**t.to_dict(), "photo_urls": [url(p) for p in t.photos]} for t in timeline],
            "totals": totals(house, expenses, installments)}
