"""What the browser model reports is scrubbed of saved values; where it starts."""

import logging

from app.executors.browser import (
    SITE_UNREACHABLE,
    browser_rules,
    quiet_library_logs,
    scrub,
    start_url,
)
from tests.conftest import make_settings

SAVED = {
    "shop.com_card_number": "4242424242424242",
    "shop.com_card_name": "Test User",
    "shop.com_password": "Hunter-2-Hunter",
    "one_time_code": "123",  # too short to scrub safely
}


def test_scrub_replaces_saved_values_in_any_format():
    text = (
        "Filled 4242424242424242 and 4242 4242 4242 4242 and 4242-4242-4242-4242 for "
        "TEST USER, password Hunter-2-Hunter. Card ends 4242. Code 123."
    )
    out = scrub(text, SAVED)
    assert "4242424242424242" not in out and "4242 4242" not in out and "4242-4242" not in out
    assert "Test User".lower() not in out.lower() and "Hunter-2-Hunter" not in out
    assert "[shop.com_card_number]" in out and "ends 4242" in out and "Code 123" in out


def test_scrub_walks_nested_results():
    judged = {"verdict": True, "reasons": ["typed 4242424242424242"], "n": 3}
    assert scrub(judged, SAVED) == {
        "verdict": True,
        "reasons": ["typed [shop.com_card_number]"],
        "n": 3,
    }


def test_start_url_is_https_except_the_dev_test_shop():
    dev, other = make_settings(environment="development"), make_settings(environment="test")
    assert start_url("github.com", dev) == "https://github.com"
    assert start_url("testshop.localhost", dev).startswith("http://testshop.localhost:")
    assert start_url("testshop.localhost", other) == "https://testshop.localhost"


def test_rules_tell_an_outage_apart_from_a_login_problem():
    assert SITE_UNREACHABLE in browser_rules([]) and SITE_UNREACHABLE in browser_rules(["a_b"])


def test_browser_use_step_logs_are_off():
    import browser_use  # noqa: F401  (sets up its loggers on import)

    quiet_library_logs()
    agent_log = logging.getLogger("browser_use.Agent")
    assert not agent_log.isEnabledFor(logging.INFO)
    assert agent_log.isEnabledFor(logging.WARNING)
