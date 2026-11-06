# ruff: noqa: E501  (inline HTML)
"""Hachi Test Shop: a fake website for checking the vault end to end (development only).

It proves that what the user saved in the Vault reaches a website correctly
when Hachi does a task, without anyone's real accounts:

- /testshop/login     username + password typed by placeholder
- /testshop/2fa       a 6-digit code browser-use generated from the saved setup key
- /testshop/api/v1/*  the API key the backend added to a `call_api` request
- /testshop/checkout  card number, expiry and name (no CVV)

Each check shows a pass or fail and is written to /testshop/log (values
masked). Open it at http://testshop.localhost:8000/testshop (Chrome sends
*.localhost to this machine). The test values below are fake and only work here;
/testshop/setup lists them so you can save them in the Vault.

Never mounted in production (see app/main.py), and the http exception for
secrets applies only to this site in development (executors/browser.py).
"""

import html
import secrets
import time
from collections import deque
from datetime import date
from typing import Any

import pyotp
from fastapi import APIRouter, Form, Header, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

SITE = "testshop.localhost"
PORT = 8000
URL = f"http://{SITE}:{PORT}/testshop"
API_BASE = f"http://127.0.0.1:{PORT}/testshop/api/v1"

# Fake test values. Save these in the Vault for site testshop.localhost.
USERNAME = "hachi-tester"
PASSWORD = "Test-Password-2468"
TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"  # base32, 32 chars
API_KEY = "ts_test_7f3a9c1e5b2d4f6a8c0e"
CARD_NUMBER = "4242424242424242"
CARD_EXPIRY = "12/30"
CARD_NAME = "Test User"
ITEM = ("Hachi plush toy (test)", "₹1")

router = APIRouter(prefix="/testshop", include_in_schema=False)

_log: deque[dict[str, Any]] = deque(maxlen=200)
_sessions: dict[str, dict[str, bool]] = {}  # cookie -> {"password": .., "totp": ..}
COOKIE = "testshop_session"


def enabled(settings: Any) -> bool:
    """Only in local development, never in production."""
    return settings.environment == "development"


def _same(a: str, b: str) -> bool:
    return secrets.compare_digest(a.encode(), b.encode())


def _mask(value: str) -> str:
    value = value or ""
    return (
        f"{value[:2]}…{value[-2:]} ({len(value)} chars)"
        if len(value) > 4
        else f"({len(value)} chars)"
    )


def record(check: str, ok: bool, detail: str) -> None:
    _log.appendleft({"at": time.strftime("%H:%M:%S"), "check": check, "ok": ok, "detail": detail})


def _session(request: Request) -> dict[str, bool]:
    return _sessions.get(request.cookies.get(COOKIE, ""), {})


def _page(title: str, body: str, status: int = 200) -> HTMLResponse:
    return HTMLResponse(
        f"""<!doctype html><html><head><meta charset="utf-8"><title>{title} · Hachi Test Shop</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{{font-family:system-ui,sans-serif;max-width:560px;margin:40px auto;padding:0 16px;color:#222}}
h1{{font-size:1.4rem}} label{{display:block;margin:12px 0 4px}} input{{width:100%;padding:8px;font-size:1rem}}
button{{margin-top:16px;padding:10px 18px;font-size:1rem;cursor:pointer}}
.ok{{color:#0a7a2f;font-weight:600}} .bad{{color:#b00020;font-weight:600}}
nav a{{margin-right:12px}} table{{border-collapse:collapse;width:100%}} td,th{{border-bottom:1px solid #ddd;padding:6px;text-align:left;font-size:.9rem}}
</style></head><body>
<nav><a href="/testshop">Home</a><a href="/testshop/login">Sign in</a><a href="/testshop/checkout">Checkout</a><a href="/testshop/log">Check log</a></nav>
<h1>{title}</h1>{body}</body></html>""",
        status_code=status,
    )


def _result(ok: bool, yes: str, no: str) -> str:
    return f'<p class="{"ok" if ok else "bad"}">{"✅ " + yes if ok else "❌ " + no}</p>'


@router.get("", response_class=HTMLResponse)
async def home(request: Request) -> HTMLResponse:
    s = _session(request)
    if s.get("totp"):
        state = '<p class="ok">✅ Signed in as hachi-tester (password and 2FA checked).</p>'
    else:
        state = '<p>Not signed in. <a href="/testshop/login">Sign in</a></p>'
    return _page(
        "Hachi Test Shop",
        f"{state}<p>One item for sale: <b>{ITEM[0]}</b>, {ITEM[1]}. "
        '<a href="/testshop/checkout">Buy it</a> (sign in first).</p>'
        "<p>A fake shop for testing Hachi. Nothing here is real.</p>",
    )


@router.get("/setup", response_class=HTMLResponse)
async def setup() -> HTMLResponse:
    rows = [
        ("Website login: username", USERNAME),
        ("Website login: password", PASSWORD),
        ("2FA setup key", TOTP_SECRET),
        ("API key", API_KEY),
        ("Card number", CARD_NUMBER),
        ("Card expiry", CARD_EXPIRY),
        ("Name on card", CARD_NAME),
    ]
    table = "".join(f"<tr><td>{k}</td><td><code>{html.escape(v)}</code></td></tr>" for k, v in rows)
    return _page(
        "Test values",
        f"<p>Save these in Hachi's Vault for the site <b>{SITE}</b>. They're fake and only work here.</p>"
        f"<table>{table}</table>",
    )


@router.get("/login", response_class=HTMLResponse)
async def login_form() -> HTMLResponse:
    return _page(
        "Sign in",
        '<form method="post" action="/testshop/login">'
        '<label for="u">Username</label><input id="u" name="username" autocomplete="username">'
        '<label for="p">Password</label><input id="p" name="password" type="password" autocomplete="current-password">'
        "<button>Sign in</button></form>",
    )


@router.post("/login", response_model=None)
async def login(
    username: str = Form(""), password: str = Form("")
) -> HTMLResponse | RedirectResponse:
    ok = _same(username.strip(), USERNAME) and _same(password, PASSWORD)
    record(
        "password",
        ok,
        f"username {'right' if username.strip() == USERNAME else 'wrong: ' + _mask(username)}, "
        f"password {'right' if password == PASSWORD else 'wrong: ' + _mask(password)}",
    )
    if not ok:
        return _page(
            "Sign in",
            _result(False, "", "Wrong username or password.")
            + '<p><a href="/testshop/login">Try again</a></p>',
            401,
        )
    token = secrets.token_urlsafe(16)
    _sessions[token] = {"password": True, "totp": False}
    resp = RedirectResponse("/testshop/2fa", status_code=303)
    resp.set_cookie(COOKIE, token, httponly=True, samesite="lax")
    return resp


@router.get("/2fa", response_class=HTMLResponse)
async def totp_form(request: Request) -> HTMLResponse:
    if not _session(request).get("password"):
        return _page(
            "Two-factor code", '<p>Sign in first. <a href="/testshop/login">Sign in</a></p>', 401
        )
    return _page(
        "Two-factor code",
        _result(True, "Password correct.", "")
        + "<p>Enter the 6-digit code from your authenticator app.</p>"
        '<form method="post" action="/testshop/2fa">'
        '<label for="c">Authentication code</label>'
        '<input id="c" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6">'
        "<button>Verify</button></form>",
    )


@router.post("/2fa", response_model=None)
async def totp_check(request: Request, code: str = Form("")) -> HTMLResponse | RedirectResponse:
    s = _session(request)
    if not s.get("password"):
        return _page(
            "Two-factor code", '<p>Sign in first. <a href="/testshop/login">Sign in</a></p>', 401
        )
    code = code.strip().replace(" ", "")
    ok = pyotp.TOTP(TOTP_SECRET).verify(code, valid_window=1)
    record(
        "2fa",
        ok,
        "code valid for the saved setup key" if ok else f"code wrong ({len(code)} digits)",
    )
    if not ok:
        return _page(
            "Two-factor code",
            _result(False, "", "That code isn't right.")
            + '<p><a href="/testshop/2fa">Try again</a></p>',
            401,
        )
    s["totp"] = True
    return RedirectResponse("/testshop/account", status_code=303)


@router.get("/account", response_class=HTMLResponse)
async def account(request: Request) -> HTMLResponse:
    s = _session(request)
    if not s.get("totp"):
        return _page(
            "Your account", '<p>Not signed in. <a href="/testshop/login">Sign in</a></p>', 401
        )
    return _page(
        "Your account",
        _result(True, "Signed in as hachi-tester. Password and 2FA code were both correct.", "")
        + '<p><a href="/testshop/checkout">Go to checkout</a></p>',
    )


@router.get("/checkout", response_class=HTMLResponse)
async def checkout_form(request: Request) -> HTMLResponse:
    if not _session(request).get("totp"):
        return _page("Checkout", '<p>Sign in first. <a href="/testshop/login">Sign in</a></p>', 401)
    return _page(
        "Checkout",
        f"<p>{ITEM[0]}: <b>{ITEM[1]}</b></p>"
        '<form method="post" action="/testshop/checkout">'
        '<label for="n">Card number</label><input id="n" name="number" autocomplete="cc-number" inputmode="numeric">'
        '<label for="e">Expiry (MM/YY)</label><input id="e" name="expiry" autocomplete="cc-exp" placeholder="MM/YY">'
        '<label for="h">Name on card</label><input id="h" name="name" autocomplete="cc-name">'
        f"<button>Place order · {ITEM[1]}</button></form>"
        "<p><small>Test shop: no CVV needed, nothing is charged.</small></p>",
    )


def _expiry_ok(expiry: str) -> bool:
    try:
        mm, yy = expiry.strip().split("/")
        month, year = int(mm), 2000 + int(yy)
    except ValueError:
        return False
    today = date.today()
    return 1 <= month <= 12 and (year, month) >= (today.year, today.month)


@router.post("/checkout", response_class=HTMLResponse)
async def checkout(
    request: Request, number: str = Form(""), expiry: str = Form(""), name: str = Form("")
) -> HTMLResponse:
    if not _session(request).get("totp"):
        return _page("Checkout", '<p>Sign in first. <a href="/testshop/login">Sign in</a></p>', 401)
    digits = "".join(c for c in number if c.isdigit())
    checks = {
        "number": digits == CARD_NUMBER,
        "expiry": expiry.strip() == CARD_EXPIRY and _expiry_ok(expiry),
        "name": name.strip().lower() == CARD_NAME.lower(),
    }
    ok = all(checks.values())
    record(
        "card",
        ok,
        ", ".join(f"{k} {'right' if v else 'wrong'}" for k, v in checks.items())
        + (f" (card ••{digits[-4:]})" if digits else " (no number)"),
    )
    if not ok:
        wrong = ", ".join(k for k, v in checks.items() if not v)
        return _page(
            "Checkout",
            _result(False, "", f"Payment declined: {wrong} didn't match.")
            + '<p><a href="/testshop/checkout">Try again</a></p>',
            402,
        )
    order = f"TS-{secrets.randbelow(900000) + 100000}"
    return _page(
        "Order placed",
        _result(
            True, f"Order {order} placed: {ITEM[0]}, {ITEM[1]}, paid with card ••{digits[-4:]}.", ""
        ),
    )


@router.get("/api/v1/whoami")
async def api_whoami(authorization: str = Header("")) -> JSONResponse:
    key = authorization.removeprefix("Bearer ").strip()
    ok = _same(key, API_KEY)
    record("api_key", ok, "key right" if ok else f"key wrong: {_mask(key)}")
    if not ok:
        return JSONResponse({"error": "invalid API key"}, status_code=401)
    return JSONResponse({"ok": True, "user": USERNAME, "plan": "test", "orders": 0})


@router.get("/log", response_class=HTMLResponse)
async def log_page() -> HTMLResponse:
    rows = "".join(
        f"<tr><td>{e['at']}</td><td>{e['check']}</td>"
        f'<td class="{"ok" if e["ok"] else "bad"}">{"✅ pass" if e["ok"] else "❌ fail"}</td>'
        f"<td>{html.escape(e['detail'])}</td></tr>"
        for e in _log
    )
    return _page(
        "Check log",
        "<p>Newest first. Values are masked.</p>"
        f"<table><tr><th>Time</th><th>Check</th><th>Result</th><th>Detail</th></tr>{rows}</table>"
        if rows
        else "<p>Nothing checked yet.</p>",
    )


@router.get("/log.json")
async def log_json() -> list[dict[str, Any]]:
    return list(_log)
