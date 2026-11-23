"""Use case (application layer): sets the recurring bills of a house (energy, water, internet...) and the day of
the month each one is due: `bills` [{name, day, until}] replaces the list (`until`: the last month it is
due, to cancel one without losing its history). The user is the house's owner or one of its
partners (application.house_access). Answers the house's page (application.house_view).
Depends only on the core's domain and ports, never on AWS."""
from __future__ import annotations

from dataclasses import replace
from typing import Any, Mapping

from houses_core.application import Access, house_access, house_view, today
from houses_core.domain.models import _recurring_bills
from houses_core.ports import Dependencies


def set_recurring(deps: Dependencies, user: str, house_id: str, payload: Mapping[str, Any]) -> dict[str, Any]:
    access = house_access(deps.repo, user, house_id)
    house = replace(access.house, recurring_bills=_recurring_bills(payload, access.house.recurring_bills, today()))
    deps.repo.save_house(access.owner, house)
    return house_view(deps, Access(access.owner, house, access.member_id))
