"""Houses bought with partners: invites by phone, what partners can do, and how much each one put in.
Against both repositories (conftest.repo)."""
import pytest

from accept_invite.use_case import accept_invite
from conftest import OTHER, OWNER, expense_input, house_input, plan_input
from create_expense.use_case import create_expense
from create_house.use_case import create_house
from create_invite.use_case import create_invite
from decline_invite.use_case import decline_invite
from delete_house.use_case import delete_house
from delete_invite.use_case import delete_invite
from get_house.use_case import get_house
from houses_core.domain.errors import Forbidden, NotFound, ValidationError
from houses_core.domain.models import OWNER_MEMBER_ID
from list_houses.use_case import list_houses
from list_invites.use_case import list_invites
from remove_partner.use_case import remove_partner
from update_expense.use_case import update_expense
from update_house.use_case import update_house
from update_installment.use_case import update_installment
from update_shares.use_case import update_shares

OWNER_PHONE, OTHER_PHONE, THIRD, THIRD_PHONE = "+5511911111111", "+5521922222222", "owner-c", "+5531933333333"


def shared_house(deps, **extra):
    """OWNER's house, with OTHER as a partner (invited by phone, accepted). Returns (house id, OTHER's member id)."""
    hid = create_house(deps, OWNER, house_input(**extra), OWNER_PHONE)["house"]["id"]
    create_invite(deps, OWNER, hid, {"phone": "21922222222"}, OWNER_PHONE)
    (invite,) = list_invites(deps, OTHER, OTHER_PHONE)
    accept_invite(deps, OTHER, invite["id"], OTHER_PHONE)
    return hid, get_house(deps, OTHER, hid)["me"]


def test_invite_accept_and_the_partner_sees_the_house(deps):
    hid = create_house(deps, OWNER, house_input(), OWNER_PHONE)["house"]["id"]
    view = create_invite(deps, OWNER, hid, {"phone": "21922222222"}, OWNER_PHONE)
    assert [i["phone"] for i in view["house"]["invites"]] == [OTHER_PHONE]
    assert list_houses(deps, OTHER) == []                            # not before accepting
    (invite,) = list_invites(deps, OTHER, OTHER_PHONE)
    assert invite["house_name"] == "Casa Azul" and invite["from_phone"] == OWNER_PHONE
    assert accept_invite(deps, OTHER, invite["id"], OTHER_PHONE) == {"house_id": hid}
    assert list_invites(deps, OTHER, OTHER_PHONE) == []
    (listed,) = list_houses(deps, OTHER)
    assert listed["id"] == hid and listed["role"] == "partner" and listed["partners"] == [
        {"id": listed["partners"][0]["id"], "phone": OTHER_PHONE}]                  # the login (`user`) is not shown
    view = get_house(deps, OTHER, hid)
    assert view["role"] == "partner" and view["me"] != OWNER_MEMBER_ID
    assert [(m["phone"], m["role"]) for m in view["members"]] == [(OWNER_PHONE, "owner"), (OTHER_PHONE, "partner")]
    assert view["house"]["invites"] == [] and list_houses(deps, OWNER)[0]["role"] == "owner"


def test_whoever_is_not_in_the_house_does_not_see_it(deps):
    hid, _ = shared_house(deps)
    for call in (lambda: get_house(deps, THIRD, hid),
                 lambda: update_house(deps, THIRD, hid, house_input()),
                 lambda: create_expense(deps, THIRD, hid, expense_input())):
        with pytest.raises(NotFound):
            call()
    assert list_houses(deps, THIRD) == []


def test_an_invite_is_answered_only_by_its_phone(deps):
    hid = create_house(deps, OWNER, house_input(), OWNER_PHONE)["house"]["id"]
    create_invite(deps, OWNER, hid, {"phone": "21922222222"}, OWNER_PHONE)
    (invite,) = list_invites(deps, OTHER, OTHER_PHONE)
    assert list_invites(deps, THIRD, THIRD_PHONE) == [] and list_invites(deps, THIRD, "") == []
    with pytest.raises(NotFound):
        accept_invite(deps, THIRD, invite["id"], THIRD_PHONE)
    with pytest.raises(NotFound):
        accept_invite(deps, THIRD, invite["id"], "")


def test_decline(deps):
    hid = create_house(deps, OWNER, house_input(), OWNER_PHONE)["house"]["id"]
    create_invite(deps, OWNER, hid, {"phone": "21922222222"}, OWNER_PHONE)
    (invite,) = list_invites(deps, OTHER, OTHER_PHONE)
    decline_invite(deps, OTHER, invite["id"], OTHER_PHONE)
    assert list_invites(deps, OTHER, OTHER_PHONE) == [] and get_house(deps, OWNER, hid)["house"]["invites"] == []
    assert list_houses(deps, OTHER) == []
    create_invite(deps, OWNER, hid, {"phone": "21922222222"}, OWNER_PHONE)             # can be invited again


def test_a_cancelled_invite_can_not_be_accepted(deps):
    hid = create_house(deps, OWNER, house_input(), OWNER_PHONE)["house"]["id"]
    view = create_invite(deps, OWNER, hid, {"phone": "21922222222"}, OWNER_PHONE)
    invite_id = view["house"]["invites"][0]["id"]
    assert delete_invite(deps, OWNER, hid, invite_id)["house"]["invites"] == []
    assert list_invites(deps, OTHER, OTHER_PHONE) == []
    with pytest.raises(NotFound):
        accept_invite(deps, OTHER, invite_id, OTHER_PHONE)


@pytest.mark.parametrize("phone, message", [
    ("11911111111", "seu número"), ("1191111", "DDD"), ("(11) 91111-1111", "DDD"), (None, "DDD"),
])
def test_invalid_invites(deps, phone, message):
    hid = create_house(deps, OWNER, house_input(), OWNER_PHONE)["house"]["id"]
    with pytest.raises(ValidationError, match=message):
        create_invite(deps, OWNER, hid, {"phone": phone}, OWNER_PHONE)


def test_the_same_person_is_not_invited_twice(deps):
    hid, _ = shared_house(deps)
    with pytest.raises(ValidationError, match="já é sócia"):
        create_invite(deps, OWNER, hid, {"phone": "21922222222"}, OWNER_PHONE)
    create_invite(deps, OWNER, hid, {"phone": "31933333333"}, OWNER_PHONE)
    with pytest.raises(ValidationError, match="já foi convidada"):
        create_invite(deps, OWNER, hid, {"phone": "31933333333"}, OWNER_PHONE)


def test_only_the_owner_invites_removes_partners_and_deletes(deps):
    hid, partner = shared_house(deps)
    view = get_house(deps, OWNER, hid)
    for call in (lambda: create_invite(deps, OTHER, hid, {"phone": "31933333333"}, OTHER_PHONE),
                 lambda: remove_partner(deps, OTHER, hid, partner),
                 lambda: delete_house(deps, OTHER, hid)):
        with pytest.raises(Forbidden, match="só o dono"):
            call()
    assert get_house(deps, OWNER, hid) == view


def test_a_partner_changes_the_house_and_keeps_who_is_in_it(deps):
    hid, partner = shared_house(deps)
    view = update_house(deps, OTHER, hid, house_input(name="Casa Verde", areas=["Cozinha"]), OTHER_PHONE)
    assert view["house"]["name"] == "Casa Verde" and view["house"]["owner_phone"] == OWNER_PHONE
    assert [m["id"] for m in view["members"]] == [OWNER_MEMBER_ID, partner]
    assert get_house(deps, OWNER, hid)["house"]["name"] == "Casa Verde"            # it is the same house


def test_who_paid_what(deps):
    hid, partner = shared_house(deps, payment_type="installments", down_payment_cents=10_000_000,
                                installments=plan_input(count=3, amount_cents=1000))
    view = create_expense(deps, OTHER, hid, expense_input(amount_cents=500))           # paid by whoever registers it
    assert view["expenses"][0]["paid_by"] == partner
    view = create_expense(deps, OTHER, hid, expense_input(amount_cents=70, paid_by=OWNER_MEMBER_ID))
    first, second, _ = view["installments"]
    view = update_installment(deps, OTHER, hid, first["id"], {**first, "paid_date": "2026-02-10"})
    assert view["installments"][0]["paid_by"] == partner                              # marked as paid by the partner
    view = update_installment(deps, OWNER, hid, second["id"], {**second, "paid_date": "2026-03-10"})
    assert view["installments"][1]["paid_by"] == OWNER_MEMBER_ID
    rows = {r["member_id"]: r for r in view["totals"]["by_member"]}
    # the owner paid the whole purchase up front while no share is given: entrada + costs
    assert rows[OWNER_MEMBER_ID] == {"member_id": OWNER_MEMBER_ID, "purchase_cents": 11_800_000,
                                     "installments_cents": 1000, "renovation_cents": 70, "total_cents": 11_801_070}
    assert rows[partner] == {"member_id": partner, "purchase_cents": 0, "installments_cents": 1000,
                             "renovation_cents": 500, "total_cents": 1500}
    with pytest.raises(ValidationError, match="pago por"):
        create_expense(deps, OWNER, hid, expense_input(paid_by="abcdef12"))
    eid = next(e["id"] for e in view["expenses"] if e["amount_cents"] == 500)
    view = update_expense(deps, OWNER, hid, eid, expense_input(amount_cents=500))       # keeps who paid it
    assert next(e for e in view["expenses"] if e["id"] == eid)["paid_by"] == partner


def test_purchase_shares(deps):
    hid, partner = shared_house(deps)                         # cash: R$ 300.000 + R$ 18.000 of costs up front
    view = update_shares(deps, OTHER, hid, {"shares": [{"member_id": OWNER_MEMBER_ID, "cents": 20_000_000},
                                                       {"member_id": partner, "cents": 10_000_000}]})
    rows = {r["member_id"]: r["purchase_cents"] for r in view["totals"]["by_member"]}
    assert rows == {OWNER_MEMBER_ID: 20_000_000, partner: 10_000_000}
    assert view["totals"]["purchase_unassigned_cents"] == 1_800_000                   # the costs: not split yet
    for shares, message in (([{"member_id": "abcdef12", "cents": 1}], "sócios"),
                            ([{"member_id": partner, "cents": 1}, {"member_id": partner, "cents": 2}], "cada um uma vez"),
                            ([{"member_id": partner, "cents": -1}], "centavos"), ("50/50", "quanto cada sócio")):
        with pytest.raises(ValidationError, match=message):
            update_shares(deps, OWNER, hid, {"shares": shares})


def test_a_partner_with_payments_is_not_removed(deps):
    hid, partner = shared_house(deps)
    eid = create_expense(deps, OTHER, hid, expense_input())["expenses"][0]["id"]
    with pytest.raises(ValidationError, match="pagamentos lançados"):
        remove_partner(deps, OWNER, hid, partner)
    update_expense(deps, OWNER, hid, eid, expense_input(paid_by=OWNER_MEMBER_ID))
    view = remove_partner(deps, OWNER, hid, partner)
    assert [m["role"] for m in view["members"]] == ["owner"]
    assert list_houses(deps, OTHER) == []
    with pytest.raises(NotFound):
        get_house(deps, OTHER, hid)


def test_deleting_a_shared_house_leaves_nothing_behind(deps):
    hid, _ = shared_house(deps)
    create_invite(deps, OWNER, hid, {"phone": "31933333333"}, OWNER_PHONE)
    delete_house(deps, OWNER, hid)
    assert list_houses(deps, OTHER) == [] and list_invites(deps, THIRD, THIRD_PHONE) == []
    assert deps.repo.list_links(OTHER) == []


def test_a_house_registered_before_phones_gets_the_owners(deps):
    hid = create_house(deps, OWNER, house_input())["house"]["id"]                      # no phone then
    assert update_house(deps, OWNER, hid, house_input(), OWNER_PHONE)["house"]["owner_phone"] == OWNER_PHONE
