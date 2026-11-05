"""Phone verification: Firebase ID token check, encrypted storage, routes."""

import time
import uuid

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from sqlalchemy import text

from app.phone import PhoneTokenError, PhoneVerifier, mask_phone

PROJECT = "demo-project"
KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


def firebase_token(key=KEY, **overrides) -> str:
    now = int(time.time())
    claims = {
        "iss": f"https://securetoken.google.com/{PROJECT}",
        "aud": PROJECT,
        "sub": "firebase-uid-1",
        "iat": now,
        "exp": now + 3600,
        "auth_time": now,
        "phone_number": "+919773703018",
        "firebase": {"sign_in_provider": "phone"},
    }
    claims.update(overrides)
    return jwt.encode(claims, key, algorithm="RS256")


def verifier() -> PhoneVerifier:
    return PhoneVerifier(PROJECT, key_for=lambda _token: KEY.public_key())


# ---- token check ---------------------------------------------------------------


async def test_valid_token_gives_the_number():
    assert await verifier().verify(firebase_token()) == "+919773703018"


@pytest.mark.parametrize(
    "overrides",
    [
        {"aud": "another-project"},
        {"iss": "https://securetoken.google.com/another-project"},
        {"exp": int(time.time()) - 120},
        {"auth_time": int(time.time()) - 3600},  # SMS check too long ago
        {"firebase": {"sign_in_provider": "google.com"}},
        {"phone_number": None},
        {"phone_number": "12345"},
    ],
)
async def test_bad_tokens_are_rejected(overrides):
    with pytest.raises(PhoneTokenError):
        await verifier().verify(firebase_token(**overrides))


async def test_token_signed_by_someone_else_is_rejected():
    other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    with pytest.raises(PhoneTokenError):
        await verifier().verify(firebase_token(key=other))


def test_mask():
    assert mask_phone("+919773703018") == "+91 ••••• •3018"
    assert mask_phone("+15555550100") == "+1 ••••• •0100"


# ---- routes --------------------------------------------------------------------


async def test_verify_store_and_remove(client, db):
    client.app.state.phone_verifier = verifier()

    before = (await client.get("/me/phone")).json()
    assert before == {"phone": None, "verification": True}

    resp = await client.post("/me/phone", json={"id_token": firebase_token()})
    assert resp.status_code == 200, resp.text
    assert resp.json()["phone"]["label"] == "+91 ••••• •3018"

    async with db.connect() as conn:
        stored = (await conn.execute(text("SELECT ciphertext FROM user_phones"))).scalar()
        actions = (await conn.execute(text("SELECT action FROM audit_log"))).scalars().all()
    assert b"9773703018" not in stored  # encrypted at rest
    assert actions == ["phone_verified"]

    user_id = (await client.get("/me")).json()["id"]
    assert await client.app.state.phones.reveal(uuid.UUID(user_id)) == "+919773703018"

    assert (await client.delete("/me/phone")).status_code == 204
    assert (await client.get("/me/phone")).json()["phone"] is None


async def test_bad_token_is_a_400(client):
    client.app.state.phone_verifier = verifier()
    resp = await client.post("/me/phone", json={"id_token": firebase_token(aud="nope")})
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "phone_not_verified"


async def test_off_without_firebase_project(client):
    client.app.state.phone_verifier = None
    assert (await client.get("/me/phone")).json()["verification"] is False
    resp = await client.post("/me/phone", json={"id_token": firebase_token()})
    assert resp.status_code == 503
