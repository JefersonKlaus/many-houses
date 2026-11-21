"""Use case (application layer): registers a house that was bought: name, address, date, price, the costs
of buying it, the profit wanted, its areas and how it was paid. Bought in installments, the same request
brings the entrada and the plan (`installments`: count, amount_cents, first_due_date), created with the
house. Bought with partners (`partners`: [{phone, cents}] and `owner_share_cents`), the purchase is split
here, once, in the act of buying, and each partner is invited by phone.
The user is its owner. Answers the house's page (application.house_view).
Depends only on the core's domain and ports, never on AWS."""
from __future__ import annotations

from dataclasses import replace
from typing import Any, Mapping

from houses_core.application import Access, check_house_limit, house_view, today
from houses_core.domain.errors import ValidationError
from houses_core.domain.models import OWNER_MEMBER_ID, House, Installment, PendingInvite, bought_with_partners
from houses_core.ports import Dependencies


def create_house(deps: Dependencies, user: str, payload: Mapping[str, Any], phone: str = "") -> dict[str, Any]:
    house = replace(House.from_input(payload), owner_phone=phone)
    invites, shares = bought_with_partners(payload, house.upfront_cents, phone, today())
    house = replace(house, invites=invites, purchase_shares=shares)
    installments = []
    if house.payment_type == "installments":
        plan = payload.get("installments")
        if not isinstance(plan, Mapping):
            raise ValidationError("parcelado: informe quantas parcelas, o valor e a data da primeira")
        installments = Installment.plan(plan, house.id)        # validated before anything is saved
    check_house_limit(deps.repo, user)
    deps.repo.save_house(user, house)
    deps.repo.save_installments(user, installments)
    for invite in invites:
        deps.repo.save_pending_invite(PendingInvite(invite.id, invite.phone, user, house.id, house.name, phone,
                                                    invite.date))
    return house_view(deps.repo, Access(user, house, OWNER_MEMBER_ID))
