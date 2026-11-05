import pytest

from app.config import to_asyncpg_url
from app.secret_scan import find_secret


@pytest.mark.parametrize(
    "text,kind",
    [
        ("my key is sk-or-v1-0123456789abcdef0123456789", "api_key"),
        ("sk-ant-api03-abcdefghijklmnopqrstuv", "api_key"),
        ("token ghp_abcdefghijklmnopqrstuvwxyz0123", "api_key"),
        ("AKIAABCDEFGHIJKLMNOP", "api_key"),
        ("my password is hunter2", "password"),
        ("pwd: s3cret!", "password"),
        ("the otp is 482913", "otp"),
        ("card 4242 4242 4242 4242", "card"),
        ("-----BEGIN OPENSSH PRIVATE KEY-----", "private_key"),
    ],
)
def test_finds_secrets(text, kind):
    assert find_secret(text) == kind


@pytest.mark.parametrize(
    "text",
    [
        "Repeat my last Swiggy order to the same address",
        "Order 2 pizzas and a coke",
        "Log into my gmail and use it for vercel",
        "Call me at 9876543210",
        "Use my OpenRouter API key to generate a video",
        "Reset my password on GitHub",
    ],
)
def test_ignores_normal_messages(text):
    assert find_secret(text) is None


def test_neon_url_is_converted_for_asyncpg():
    url = "postgresql://u:p@ep-x.neon.tech/db?sslmode=require&channel_binding=require"
    assert to_asyncpg_url(url) == "postgresql+asyncpg://u:p@ep-x.neon.tech/db?ssl=require"


def test_asyncpg_url_is_unchanged():
    url = "postgresql+asyncpg://u:p@localhost:5433/db"
    assert to_asyncpg_url(url) == url


def test_proxy_country_is_per_site():
    from tests.conftest import make_settings

    s = make_settings(browser_proxy_sites="swiggy.com:in, zomato.com:IN")
    assert s.proxy_country_for("swiggy.com") == "in"
    assert s.proxy_country_for("www.Swiggy.com") == "in"
    assert s.proxy_country_for("zomato.com") == "in"
    assert s.proxy_country_for("github.com") is None
    assert s.proxy_country_for("notswiggy.com") is None
    assert s.proxy_country_for(None) is None

    fallback = make_settings(browser_proxy_sites="swiggy.com:in", browser_proxy_country="us")
    assert fallback.proxy_country_for("github.com") == "us"
    assert fallback.proxy_country_for("swiggy.com") == "in"
