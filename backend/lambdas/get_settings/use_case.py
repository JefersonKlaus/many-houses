"""Use case (application layer): the user's settings (name, default profit) and their login's phone and e-mail.
Depends only on the core's domain and ports, never on AWS."""
from __future__ import annotations

from typing import Any

from houses_core.domain.models import Profile
from houses_core.ports import Dependencies


def get_settings(deps: Dependencies, user: str, phone: str, login_name: str, email: str) -> dict[str, Any]:
    profile = deps.repo.get_profile(user) or Profile()
    return {"name": profile.name or login_name, "phone": phone, "email": email,
            "default_profit_percent": profile.default_profit_percent}
