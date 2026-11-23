"""The settings: the user's name (theirs, over the login's) and the profit wanted that a new house starts with."""
import pytest

from accept_invite.use_case import accept_invite
from conftest import OTHER, OWNER, house_input
from create_house.use_case import create_house
from create_invite.use_case import create_invite
from get_house.use_case import get_house
from get_settings.use_case import get_settings
from houses_core.domain.errors import ValidationError
from list_invites.use_case import list_invites
from update_settings.use_case import update_settings

PHONE, OTHER_PHONE = "+5511911111111", "+5521922222222"


def test_without_settings_the_logins_data(deps):
    assert get_settings(deps, OWNER, PHONE, "Ana Lima", "ana@example.com") == {
        "name": "Ana Lima", "phone": PHONE, "email": "ana@example.com", "default_profit_percent": 0}


def test_saving_the_settings(deps):
    saved = update_settings(deps, OWNER, {"name": "  Ana   Souza ", "default_profit_percent": 25}, PHONE, "Ana Lima", "")
    assert saved == {"name": "Ana Souza", "phone": PHONE, "email": "", "default_profit_percent": 25}
    assert get_settings(deps, OWNER, PHONE, "Ana Lima", "") == saved
    # an empty name: the login's again
    assert update_settings(deps, OWNER, {"name": "", "default_profit_percent": 0}, PHONE, "Ana Lima", "")["name"] == "Ana Lima"


@pytest.mark.parametrize("payload, message", [
    ({"name": "x" * 81}, "nome"), ({"default_profit_percent": -1}, "lucro desejado padrão"),
    ({"default_profit_percent": "30"}, "lucro desejado padrão"), ({"name": 5}, "nome"),
])
def test_invalid_settings(deps, payload, message):
    with pytest.raises(ValidationError, match=message):
        update_settings(deps, OWNER, payload, PHONE, "", "")


def test_the_chosen_name_is_the_one_partners_see(deps):
    update_settings(deps, OWNER, {"name": "Ana Souza"}, PHONE, "Ana Lima", "")
    hid = create_house(deps, OWNER, house_input(), PHONE, "Ana Lima")["house"]["id"]
    create_invite(deps, OWNER, hid, {"phone": "21922222222"}, PHONE, "Ana Lima")
    (invite,) = list_invites(deps, OTHER, OTHER_PHONE)
    assert invite["from_name"] == "Ana Souza"
    accept_invite(deps, OTHER, invite["id"], OTHER_PHONE, "Bruno Reis")
    assert [m["name"] for m in get_house(deps, OTHER, hid)["members"]] == ["Ana Souza", "Bruno Reis"]
    # renaming in the settings: every house shows the new name at once
    update_settings(deps, OTHER, {"name": "Bruno R."}, OTHER_PHONE, "Bruno Reis", "")
    update_settings(deps, OWNER, {"name": "Ana S."}, PHONE, "Ana Lima", "")
    assert [m["name"] for m in get_house(deps, OWNER, hid)["members"]] == ["Ana S.", "Bruno R."]
