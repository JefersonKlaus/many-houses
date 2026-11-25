"""Use case (application layer): registers a house that was bought: name, address, date, price, the costs
of buying it, the profit wanted, its areas and how it was paid. Bought in installments, the same request
brings the entrada and the plan (`installments`: count, amount_cents, first_due_date), created with the
house. Bought with partners (`partners`: [{phone, cents}] and `owner_share_cents`), the purchase is split
here, once, in the act of buying, and each partner is invited by phone.
Bought together with other houses in one deal (`also_bought`: [{name, address, purchase_price_cents, ...}]):
the entrada and the plan are for the whole deal and every house takes its part of them, in proportion to
its price. The answer is the page of the house of the form. The partners (and what each one paid) are for the
whole deal too: each one's part is spread over the houses and they are invited to each of them.
The user is its owner. Answers the house's page (application.house_view).
Depends only on the core's domain and ports, never on AWS."""
from __future__ import annotations

from dataclasses import replace
from typing import Any, Mapping

from houses_core.application import Access, check_house_limit, house_view, today, user_name
from houses_core.domain.errors import ValidationError
from houses_core.domain.models import OWNER_MEMBER_ID, House, Installment, PendingInvite, bought_deal_with_partners
from houses_core.ports import Dependencies


def create_house(deps: Dependencies, user: str, payload: Mapping[str, Any], phone: str = "",
                 name: str = "") -> dict[str, Any]:
    name = user_name(deps.repo, user, name)
    houses = [replace(h, owner_phone=phone, owner_name=name)
              for h in House.bundle_from_input(payload, payload.get("also_bought"))]
    deal = bought_deal_with_partners(payload, [h.upfront_cents for h in houses], phone, today())
    houses = [replace(h, invites=invites, purchase_shares=shares) for h, (invites, shares) in zip(houses, deal)]
    installments = []
    if houses[0].payment_type == "installments":
        plan = payload.get("installments")
        if not isinstance(plan, Mapping):
            raise ValidationError("parcelado: informe quantas parcelas, o valor e a data da primeira")
        # validated before anything is saved; in a deal, the amount is the whole installment
        installments = (Installment.plan_group(plan, houses) if len(houses) > 1
                        else Installment.plan(plan, houses[0].id))
    check_house_limit(deps.repo, user, len(houses))
    for house in houses:
        deps.repo.save_house(user, house)
    deps.repo.save_installments(user, installments)
    for house in houses:
        for invite in house.invites:
            deps.repo.save_pending_invite(PendingInvite(invite.id, invite.phone, user, house.id, house.name, phone,
                                                        invite.date, name))
    return house_view(deps, Access(user, houses[0], OWNER_MEMBER_ID))
