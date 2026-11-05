"""Backend token verification (docs/API.md §2).

The Next.js server signs a short-lived HS256 JWT with BACKEND_JWT_SECRET after
Google sign-in. The backend only verifies it and upserts the user.
"""

import time
from typing import Annotated

import jwt
from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from app.errors import APIError
from app.models import User


def _token_from(request: Request) -> str:
    header = request.headers.get("authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise APIError(401, "unauthenticated", "Sign in required.")
    return token


def decode_token(token: str, secret: str, audience: str) -> dict:
    try:
        claims = jwt.decode(
            token,
            secret,
            algorithms=["HS256"],
            audience=audience,
            options={"require": ["sub", "exp", "iat", "aud"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise APIError(401, "token_expired", "Session expired, refresh the token.") from exc
    except jwt.PyJWTError as exc:
        raise APIError(401, "unauthenticated", "Invalid token.") from exc
    if not claims.get("email"):
        raise APIError(401, "unauthenticated", "Invalid token.")
    return claims


USER_CACHE_SECONDS = 300


async def current_user(request: Request) -> User:
    settings = request.app.state.settings
    claims = decode_token(_token_from(request), settings.backend_jwt_secret, settings.jwt_audience)
    # Every request needs the user; remembering it for a few minutes saves a database
    # round trip each time. Kept per app instance (tests build a fresh app each time).
    cache: dict[str, tuple[float, User]] | None = getattr(request.app.state, "user_cache", None)
    if cache is None:
        cache = request.app.state.user_cache = {}
    hit = cache.get(claims["sub"])
    if hit and time.monotonic() - hit[0] < USER_CACHE_SECONDS:
        return hit[1]
    user = await _load_user(request, claims)
    if len(cache) > 1000:
        cache.clear()
    cache[claims["sub"]] = (time.monotonic(), user)
    return user


async def _load_user(request: Request, claims: dict) -> User:
    async with request.app.state.session_factory() as session:
        user = await session.scalar(select(User).where(User.google_sub == claims["sub"]))
        if user is None:
            await session.execute(
                insert(User)
                .values(
                    google_sub=claims["sub"],
                    email=claims["email"],
                    name=claims.get("name"),
                    avatar_url=claims.get("picture"),
                )
                .on_conflict_do_nothing(index_elements=["google_sub"])
            )
            await session.commit()
            user = await session.scalar(select(User).where(User.google_sub == claims["sub"]))
        return user


CurrentUser = Annotated[User, Depends(current_user)]
