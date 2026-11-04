"""Envelope encryption for secrets at rest (docs/SCHEMA.md §4, ARCHITECTURE §8.3).

Each secret gets its own random data key (DEK). The secret is encrypted with the
DEK (AES-256-GCM); the DEK is encrypted with the master key from the environment.
Both encryptions are bound to `user_id|site|kind` (AAD), so a ciphertext copied
to another user, site, or kind fails to decrypt.
"""

import base64
import json
import os
import uuid
from dataclasses import dataclass
from typing import Any

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

KEY_VERSION = 1


class VaultKeyError(RuntimeError):
    pass


@dataclass
class Sealed:
    ciphertext: bytes
    nonce: bytes
    encrypted_dek: bytes
    dek_nonce: bytes
    key_version: int = KEY_VERSION

    def columns(self) -> dict[str, Any]:
        return {
            "ciphertext": self.ciphertext,
            "nonce": self.nonce,
            "encrypted_dek": self.encrypted_dek,
            "dek_nonce": self.dek_nonce,
            "key_version": self.key_version,
        }


def load_master_key(value: str | None) -> bytes:
    if not value:
        raise VaultKeyError("VAULT_MASTER_KEY is not set (see .env.example)")
    try:
        key = base64.b64decode(value, validate=True)
    except ValueError as exc:
        raise VaultKeyError("VAULT_MASTER_KEY must be base64") from exc
    if len(key) != 32:
        raise VaultKeyError("VAULT_MASTER_KEY must decode to 32 bytes")
    return key


def aad(user_id: uuid.UUID, site: str, kind: str) -> bytes:
    return f"{user_id}|{site}|{kind}".encode()


class Vault:
    def __init__(self, master_key: bytes) -> None:
        self._master = AESGCM(master_key)

    def seal(self, value: Any, *, user_id: uuid.UUID, site: str, kind: str) -> Sealed:
        bound = aad(user_id, site, kind)
        dek = AESGCM.generate_key(bit_length=256)
        nonce, dek_nonce = os.urandom(12), os.urandom(12)
        plaintext = json.dumps(value, separators=(",", ":")).encode()
        return Sealed(
            ciphertext=AESGCM(dek).encrypt(nonce, plaintext, bound),
            nonce=nonce,
            encrypted_dek=self._master.encrypt(dek_nonce, dek, bound),
            dek_nonce=dek_nonce,
        )

    def open(self, row: Any, *, user_id: uuid.UUID, site: str, kind: str) -> Any:
        """Decrypt a row with the encryption columns. Raises InvalidTag if tampered or moved."""
        if row.key_version != KEY_VERSION:
            raise VaultKeyError(f"unknown key_version {row.key_version}")
        bound = aad(user_id, site, kind)
        dek = self._master.decrypt(row.dek_nonce, row.encrypted_dek, bound)
        return json.loads(AESGCM(dek).decrypt(row.nonce, row.ciphertext, bound))
