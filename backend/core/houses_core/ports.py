"""Ports: what the use cases need from the outside world, without knowing how it is done.
adapters/dynamo_repository.py implements Repository in AWS; local/memory_repository.py, locally."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional, Protocol

from .domain.models import Expense, House, Installment, PendingInvite, Profile, TimelineEntry


class Repository(Protocol):
    """Every owner's data. `owner` is the user's id, always taken from the login token. A house and
    everything in it is kept under its owner; its partners only keep a link to it."""

    def list_houses(self, owner: str) -> list[House]: ...
    def get_house(self, owner: str, id: str) -> Optional[House]: ...
    def save_house(self, owner: str, house: House) -> None: ...
    def delete_house(self, owner: str, id: str) -> None: ...

    def list_expenses(self, owner: str, house_id: Optional[str] = None) -> list[Expense]:
        """One house's renovation costs; with no house, every house's."""
    def get_expense(self, owner: str, house_id: str, id: str) -> Optional[Expense]: ...
    def save_expense(self, owner: str, expense: Expense) -> None: ...
    def delete_expense(self, owner: str, house_id: str, id: str) -> None: ...

    def list_installments(self, owner: str, house_id: Optional[str] = None) -> list[Installment]:
        """One house's installments (prestações); with no house, every house's."""
    def get_installment(self, owner: str, house_id: str, id: str) -> Optional[Installment]: ...
    def save_installments(self, owner: str, installments: list[Installment]) -> None:
        """Saves many at once (a whole payment plan): one call, not one per installment."""
    def delete_installments(self, owner: str, house_id: str, ids: list[str]) -> None: ...

    def get_profile(self, user: str) -> Optional[Profile]: ...
    def save_profile(self, user: str, profile: Profile) -> None: ...

    def list_timeline(self, owner: str, house_id: str) -> list[TimelineEntry]: ...
    def get_timeline_entry(self, owner: str, house_id: str, id: str) -> Optional[TimelineEntry]: ...
    def save_timeline_entry(self, owner: str, entry: TimelineEntry) -> None: ...
    def delete_timeline_entry(self, owner: str, house_id: str, id: str) -> None: ...

    def save_link(self, user: str, owner: str, house_id: str) -> None:
        """`user` is a partner in `owner`'s house."""
    def get_link(self, user: str, house_id: str) -> Optional[str]:
        """The owner of a house `user` is a partner in, or None."""
    def list_links(self, user: str) -> list[tuple[str, str]]:
        """(owner, house id) of every house `user` is a partner in."""
    def delete_link(self, user: str, house_id: str) -> None: ...

    def save_pending_invite(self, invite: PendingInvite) -> None:
        """Kept under the guest's phone, so they find it when they log in (even if they had no login yet)."""
    def list_pending_invites(self, phone: str) -> list[PendingInvite]: ...
    def get_pending_invite(self, phone: str, id: str) -> Optional[PendingInvite]: ...
    def delete_pending_invite(self, phone: str, id: str) -> None: ...


class PhotoStorage(Protocol):
    """Where the photos are (S3 in AWS). The browser sends each photo straight to it, with a form signed
    here, and shows it through a link that is only valid for a while: the photos are never public."""

    def upload_form(self, key: str) -> dict[str, Any]:
        """{"url", "fields"}: a form the browser posts the photo to (a JPEG, up to a size limit)."""
    def view_url(self, key: str) -> str:
        """A link to see the photo, valid for a while."""
    def delete(self, keys: list[str]) -> None: ...
    def delete_prefix(self, prefix: str) -> None:
        """Every photo whose key starts with `prefix` (all of a house's)."""


@dataclass(frozen=True)
class Dependencies:
    """What every use case receives: the ports, already plugged into their adapters."""
    repo: Repository
    photos: Optional[PhotoStorage] = None       # without it (some tests) no photo links are given
