"""The user's details for forms (app/profile.py)."""

import uuid

import pytest
from sqlalchemy import text

from app.executors.browser import browser_rules
from app.profile import InvalidProfile, clean_profile, profile_rules

DETAILS = {
    "full_name": "Test User",
    "date_of_birth": "1995-04-12",
    "email": "test@example.com",
    "address_line1": "12 Example Road",
    "city": "Mumbai",
    "postal_code": "400001",
    "country": "India",
    "food_preference": "Vegetarian",
}


def test_clean_keeps_known_fields_and_drops_empty():
    assert clean_profile({"full_name": "  Test   User ", "city": "", "notes": None}) == {
        "full_name": "Test User"
    }


@pytest.mark.parametrize(
    "data",
    [
        {"nickname": "x"},
        {"date_of_birth": "12/04/1995"},
        {"date_of_birth": "2999-01-01"},
        {"email": "not-an-email"},
        {"postal_code": "<script>"},
        {"full_name": "x" * 121},
        {"city": 5},
    ],
)
def test_clean_rejects_bad_details(data):
    with pytest.raises(InvalidProfile):
        clean_profile(data)


def test_rules_hide_identifying_details_from_the_model():
    rules = browser_rules([], profile_rules(DETAILS))
    assert "<secret>profile_full_name</secret>" in rules
    assert "profile_address_line1" in rules and "profile_postal_code" in rules
    for hidden in ("Test User", "1995-04-12", "test@example.com", "12 Example Road", "400001"):
        assert hidden not in rules
    assert "city: Mumbai" in rules and "food preference: Vegetarian" in rules
    assert profile_rules({}) == ""


async def test_save_read_and_clear(client, db):
    assert (await client.get("/me/profile")).json() == {"details": {}}

    resp = await client.put("/me/profile", json={"details": DETAILS})
    assert resp.status_code == 200, resp.text
    assert (await client.get("/me/profile")).json() == {"details": DETAILS}

    async with db.connect() as conn:
        stored = (await conn.execute(text("SELECT ciphertext FROM user_profiles"))).scalar()
        actions = (await conn.execute(text("SELECT action FROM audit_log"))).scalars().all()
    assert b"Example Road" not in stored  # encrypted at rest
    assert actions == ["profile_updated"]

    user_id = uuid.UUID((await client.get("/me")).json()["id"])
    used = await client.app.state.profiles.for_task(user_id, "swiggy.com")
    assert used == DETAILS

    assert (await client.put("/me/profile", json={"details": {}})).json() == {"details": {}}
    async with db.connect() as conn:
        rows = (await conn.execute(text("SELECT count(*) FROM user_profiles"))).scalar()
    assert rows == 0


async def test_bad_details_are_a_400(client):
    resp = await client.put("/me/profile", json={"details": {"email": "nope"}})
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "validation_error"
