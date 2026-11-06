"""The dev-only test shop (app/testshop.py) and its dev-only exceptions."""

import httpx
import pyotp
import pytest
from fastapi import FastAPI

from app import testshop
from app.executors.api import API_BASES, api_bases
from app.executors.browser import secret_scope
from app.main import create_app
from tests.conftest import make_settings


@pytest.fixture
async def shop():
    app = FastAPI()
    app.include_router(testshop.router)
    testshop._log.clear()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testshop.localhost") as c:
        yield c


def last_check() -> dict:
    return testshop._log[0]


async def status_of(environment: str) -> int:
    app = create_app(make_settings(environment=environment))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://x") as c:
        return (await c.get("/testshop/setup")).status_code


async def test_only_mounted_in_development():
    assert await status_of("development") == 200
    assert await status_of("test") == 404


def test_http_secrets_and_api_only_for_the_shop_in_development():
    dev, other = make_settings(environment="development"), make_settings(environment="test")
    assert secret_scope("testshop.localhost", dev) == "http://*.testshop.localhost"
    assert secret_scope("testshop.localhost", other) == "https://*.testshop.localhost"
    assert secret_scope("github.com", dev) == "https://*.github.com"
    assert api_bases(dev)["testshop.localhost"] == testshop.API_BASE
    assert api_bases(other) == API_BASES and "testshop.localhost" not in API_BASES


async def sign_in(shop: httpx.AsyncClient) -> None:
    r = await shop.post(
        "/testshop/login", data={"username": testshop.USERNAME, "password": testshop.PASSWORD}
    )
    assert r.status_code == 303 and last_check()["ok"]
    code = pyotp.TOTP(testshop.TOTP_SECRET).now()
    r = await shop.post("/testshop/2fa", data={"code": code})
    assert r.status_code == 303 and last_check() == {**last_check(), "check": "2fa", "ok": True}


async def test_full_flow_passes(shop):
    await sign_in(shop)
    r = await shop.post(
        "/testshop/checkout",
        data={"number": "4242 4242 4242 4242", "expiry": "12/30", "name": "Test User"},
    )
    assert r.status_code == 200 and "Order TS-" in r.text
    assert last_check()["check"] == "card" and last_check()["ok"]
    assert "4242424242424242" not in str(list(testshop._log))  # masked in the log


async def test_wrong_values_fail_and_are_masked(shop):
    r = await shop.post(
        "/testshop/login", data={"username": testshop.USERNAME, "password": "nope-wrong"}
    )
    assert r.status_code == 401 and not last_check()["ok"]
    assert "nope-wrong" not in last_check()["detail"]

    await sign_in(shop)
    assert (await shop.post("/testshop/2fa", data={"code": "000000"})).status_code in (303, 401)
    r = await shop.post(
        "/testshop/checkout",
        data={"number": "4111111111111111", "expiry": "12/30", "name": "Test User"},
    )
    assert r.status_code == 402 and "number" in r.text and not last_check()["ok"]


async def test_checkout_needs_sign_in(shop):
    assert (await shop.get("/testshop/checkout")).status_code == 401


async def test_api_key(shop):
    ok = await shop.get(
        "/testshop/api/v1/whoami", headers={"Authorization": f"Bearer {testshop.API_KEY}"}
    )
    assert ok.status_code == 200 and ok.json()["user"] == testshop.USERNAME
    bad = await shop.get(
        "/testshop/api/v1/whoami", headers={"Authorization": "Bearer ts_wrong_key_123"}
    )
    assert bad.status_code == 401 and "ts_wrong_key_123" not in last_check()["detail"]
