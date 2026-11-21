"""Photos: a cost's two photos (NF and material or service) and the house's timeline. The photos are
kept under their house; each one is deleted with what it belongs to."""
import pytest

from conftest import OWNER, expense_input, house_input
from create_expense.use_case import create_expense
from create_house.use_case import create_house
from create_photo_upload.use_case import create_photo_upload
from create_timeline_entry.use_case import create_timeline_entry
from delete_expense.use_case import delete_expense
from delete_house.use_case import delete_house
from delete_timeline_entry.use_case import delete_timeline_entry
from get_house.use_case import get_house
from houses_core.adapters.s3_photos import MAX_BYTES, S3Photos
from houses_core.domain.errors import NotFound, ValidationError
from houses_core.domain.models import Expense, TimelineEntry
from update_expense.use_case import update_expense
from update_timeline_entry.use_case import update_timeline_entry


def upload(deps, hid):
    """Like the browser: asks for the form, then sends the photo with it. Returns the photo's id."""
    answer = create_photo_upload(deps, OWNER, hid)
    key = answer["upload"]["fields"]["key"]
    assert key == f"{OWNER}/{hid}/{answer['id']}.jpg"                 # under its house
    deps.photos.put(key, "image/jpeg", b"jpeg")
    return answer["id"]


def test_a_cost_has_a_photo_of_the_nf_and_one_of_the_material(deps):
    hid = create_house(deps, OWNER, house_input())["house"]["id"]
    nf, material = upload(deps, hid), upload(deps, hid)
    view = create_expense(deps, OWNER, hid, expense_input(nf_photo=nf, material_photo=material))
    (e,) = view["expenses"]
    assert (e["nf_photo"], e["material_photo"]) == (nf, material)
    assert e["nf_photo_url"] == f"/local-photos/{OWNER}/{hid}/{nf}.jpg" and e["material_photo_url"]
    new_nf = upload(deps, hid)
    view = update_expense(deps, OWNER, hid, e["id"], expense_input(nf_photo=new_nf, material_photo=""))
    assert view["expenses"][0]["material_photo_url"] == ""
    assert set(deps.photos.files) == {f"{OWNER}/{hid}/{new_nf}.jpg"}      # the replaced and the removed: gone
    delete_expense(deps, OWNER, hid, e["id"])
    assert deps.photos.files == {}


def test_without_photos(deps):
    hid = create_house(deps, OWNER, house_input())["house"]["id"]
    (e,) = create_expense(deps, OWNER, hid, expense_input())["expenses"]
    assert e["nf_photo"] == e["nf_photo_url"] == ""


@pytest.mark.parametrize("field", ["nf_photo", "material_photo"])
def test_a_photo_is_an_id(field):
    with pytest.raises(ValidationError, match="foto"):
        Expense.from_input(expense_input(**{field: "../outra-casa/foto"}), "abcd1234")


def test_timeline_from_the_purchase_to_the_end(deps):
    hid = create_house(deps, OWNER, house_input())["house"]["id"]
    first, second, third = (upload(deps, hid) for _ in range(3))
    create_timeline_entry(deps, OWNER, hid, {"date": "2026-03-01", "caption": "Telhado novo", "photos": [third]})
    view = create_timeline_entry(deps, OWNER, hid, {"date": "2026-01-15", "caption": "  Dia da compra ",
                                                    "photos": [first, second]})
    assert [(t["date"], t["caption"]) for t in view["timeline"]] == [("2026-01-15", "Dia da compra"),
                                                                     ("2026-03-01", "Telhado novo")]
    assert len(view["timeline"][0]["photo_urls"]) == 2
    entry = view["timeline"][0]
    view = update_timeline_entry(deps, OWNER, hid, entry["id"], {**entry, "photos": [second]})
    assert view["timeline"][0]["photos"] == [second]
    assert f"{OWNER}/{hid}/{first}.jpg" not in deps.photos.files        # taken out: deleted
    view = delete_timeline_entry(deps, OWNER, hid, entry["id"])
    assert [t["caption"] for t in view["timeline"]] == ["Telhado novo"]
    assert set(deps.photos.files) == {f"{OWNER}/{hid}/{third}.jpg"}
    with pytest.raises(NotFound):
        delete_timeline_entry(deps, OWNER, hid, entry["id"])


@pytest.mark.parametrize("photos, message", [([], "de 1 a 12"), (["abcd1234"] * 2, "de novo"),
                                             (["x"], "de novo"), ([f"{n:08x}" for n in range(13)], "de 1 a 12")])
def test_invalid_timeline_entries(photos, message):
    with pytest.raises(ValidationError, match=message):
        TimelineEntry.from_input({"date": "2026-01-15", "photos": photos}, "abcd1234")


def test_deleting_the_house_deletes_its_photos_and_timeline(deps):
    hid = create_house(deps, OWNER, house_input())["house"]["id"]
    other = create_house(deps, OWNER, house_input(name="Outra"))["house"]["id"]
    create_timeline_entry(deps, OWNER, hid, {"date": "2026-01-15", "photos": [upload(deps, hid)]})
    create_expense(deps, OWNER, hid, expense_input(nf_photo=upload(deps, hid)))
    kept = upload(deps, other)
    delete_house(deps, OWNER, hid)
    assert set(deps.photos.files) == {f"{OWNER}/{other}/{kept}.jpg"}
    assert deps.repo.list_timeline(OWNER, hid) == []


def test_an_upload_is_only_for_a_house_of_the_user(deps):
    hid = create_house(deps, OWNER, house_input())["house"]["id"]
    with pytest.raises(NotFound):
        create_photo_upload(deps, "someone-else", hid)


class FakeS3:
    def __init__(self):
        self.calls, self.objects = [], {f"o/h/{n}.jpg" for n in range(1500)} | {"o/other/1.jpg"}

    def generate_presigned_post(self, bucket, key, Fields, Conditions, ExpiresIn):
        self.calls.append(("post", key, Fields, Conditions))
        return {"url": f"https://{bucket}.s3.sa-east-1.amazonaws.com/", "fields": {"key": key, **Fields}}

    def generate_presigned_url(self, operation, Params, ExpiresIn):
        return f"https://signed/{Params['Key']}"

    def list_objects_v2(self, Bucket, Prefix, ContinuationToken=None):
        keys = sorted(k for k in self.objects if k.startswith(Prefix))
        start = int(ContinuationToken or 0)
        page = keys[start:start + 1000]
        return {"Contents": [{"Key": k} for k in page],
                **({"NextContinuationToken": str(start + 1000)} if start + 1000 < len(keys) else {})}

    def delete_objects(self, Bucket, Delete):
        assert len(Delete["Objects"]) <= 1000
        self.objects -= {o["Key"] for o in Delete["Objects"]}


def test_s3_photos():
    s3 = FakeS3()
    photos = S3Photos(s3, "bucket")
    form = photos.upload_form("o/h/x.jpg")
    assert form["fields"]["key"] == "o/h/x.jpg" and form["url"].startswith("https://bucket.s3.sa-east-1")
    (_, _, fields, conditions), = s3.calls
    assert fields == {"Content-Type": "image/jpeg"} and ["content-length-range", 1, MAX_BYTES] in conditions
    assert photos.view_url("o/h/x.jpg") == "https://signed/o/h/x.jpg"
    photos.delete_prefix("o/h/")                                    # 1500 photos: two pages, two deletes
    assert s3.objects == {"o/other/1.jpg"}
