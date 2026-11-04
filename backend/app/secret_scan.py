"""Detect secrets pasted into chat so they are never stored (docs/API.md §5).

Errs on the side of catching secrets; a false positive only asks the user to
use the secure input instead.
"""

import re

_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("api_key", re.compile(r"\bsk-[A-Za-z0-9_-]{16,}")),
    ("api_key", re.compile(r"\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}")),
    ("api_key", re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}")),
    ("api_key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("api_key", re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b")),
    ("api_key", re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}")),
    ("private_key", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("token", re.compile(r"\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}")),
    (
        "password",
        re.compile(r"(?i)\b(password|passwd|pwd|passcode|pin)\b\s*(is|:|=)\s*\S+"),
    ),
    (
        "otp",
        re.compile(r"(?i)\b(otp|2fa|verification code|one[- ]time code)\b\D{0,15}\b\d{4,8}\b"),
    ),
)

_CARD_CANDIDATE = re.compile(r"\b(?:\d[ -]?){13,19}\b")


def _luhn_ok(digits: str) -> bool:
    total = 0
    for index, char in enumerate(reversed(digits)):
        value = int(char)
        if index % 2 == 1:
            value *= 2
            if value > 9:
                value -= 9
        total += value
    return total % 10 == 0


def find_secret(text: str) -> str | None:
    """Return the kind of secret found in `text`, or None."""
    for kind, pattern in _PATTERNS:
        if pattern.search(text):
            return kind
    for match in _CARD_CANDIDATE.finditer(text):
        digits = re.sub(r"\D", "", match.group())
        if 13 <= len(digits) <= 19 and _luhn_ok(digits):
            return "card"
    return None
