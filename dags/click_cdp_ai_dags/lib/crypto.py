#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Decrypt integration secrets that the Node app stored AES-256-GCM encrypted.

Mirrors server/lib/encryption.js. Encrypted values look like
``enc:v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>`` (AES-256-GCM, 12-byte IV,
16-byte auth tag). The key is the ``cdp_ai_integration_encryption_key`` Airflow
Variable (falling back to the ``INTEGRATION_ENCRYPTION_KEY`` env var) - the SAME
value the Node app uses. A 64-char hex key is used raw; any other string is
scrypt-derived with the shared salt (matching Node's crypto.scryptSync defaults:
N=16384, r=8, p=1).

``decrypt`` passes plaintext through unchanged, so it is safe to call on any
stored field whether or not it was encrypted at rest.
"""

import hashlib
import os
import re

from dags.click_cdp_ai_dags.lib import config as ga_config

_PREFIX = "enc:v1:"
_HEX64 = re.compile(r"^[0-9a-fA-F]{64}$")


def is_encrypted(value):
    return isinstance(value, str) and value.startswith(_PREFIX)


def _key():
    raw = ga_config._get_variable("cdp_ai_integration_encryption_key", None) \
        or os.environ.get("INTEGRATION_ENCRYPTION_KEY")
    if not raw:
        raise RuntimeError(
            "Encryption key not set (cdp_ai_integration_encryption_key Airflow "
            "Variable or INTEGRATION_ENCRYPTION_KEY env)."
        )
    if _HEX64.match(raw):
        return bytes.fromhex(raw)
    return hashlib.scrypt(
        raw.encode("utf-8"), salt=b"capsuite-cdp-v1", n=16384, r=8, p=1, dklen=32
    )


def decrypt(value):
    """Return plaintext for an ``enc:v1:`` value; pass anything else through."""
    if not is_encrypted(value):
        return value
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    parts = value[len(_PREFIX):].split(":")
    if len(parts) != 3:
        raise ValueError(
            f"Malformed encrypted value (expected 3 parts, got {len(parts)})"
        )
    iv, tag, body = (bytes.fromhex(p) for p in parts)
    return AESGCM(_key()).decrypt(iv, body + tag, None).decode("utf-8")
