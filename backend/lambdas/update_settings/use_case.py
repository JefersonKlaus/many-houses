"""Use case (application layer): saves the user's settings: their name (also in every house they are in, so
partners see it at once) and the profit wanted that a new house starts with.
Depends only on the core's domain and ports, never on AWS."""
from __future__ import annotations

from dataclasses import replace
from typing import Any, Mapping

from houses_core.domain.models import Profile
from houses_core.ports import Dependencies


def update_settings(deps: Dependencies, user: str, payload: Mapping[str, Any], phone: str, login_name: str,
                    email: str) -> dict[str, Any]:
    profile = Profile.from_input(payload)
    deps.repo.save_profile(user, profile)
    name = profile.name or login_name
    for house in deps.repo.list_houses(user):               # the houses they registered
        if name and house.owner_name != name:
            deps.repo.save_house(user, replace(house, owner_name=name))
    for owner, house_id in deps.repo.list_links(user):      # and the ones they are a partner in
        house = deps.repo.get_house(owner, house_id)
        if house and name and any(p.user == user and p.name != name for p in house.partners):
            deps.repo.save_house(owner, replace(house, partners=tuple(
                replace(p, name=name) if p.user == user else p for p in house.partners)))
    return {"name": name, "phone": phone, "email": email, "default_profit_percent": profile.default_profit_percent}
