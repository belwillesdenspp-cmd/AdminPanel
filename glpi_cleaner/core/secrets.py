"""Шифрование секретов (SMB-пароль и т.п.)."""

from __future__ import annotations

import base64
import hashlib
import os
from pathlib import Path

from .config_manager import app_dir
from .logger import get_logger


def _key_file() -> Path:
    d = app_dir() / "data"
    d.mkdir(parents=True, exist_ok=True)
    return d / ".secrets_key"


def _fernet_key() -> bytes:
    env = os.environ.get("GLPI_CLEANER_SECRETS_KEY", "").strip()
    if env:
        digest = hashlib.sha256(env.encode("utf-8")).digest()
        return base64.urlsafe_b64encode(digest)
    path = _key_file()
    if path.exists():
        return path.read_bytes().strip()
    try:
        from cryptography.fernet import Fernet

        key = Fernet.generate_key()
    except ImportError:
        # fallback: стабильный ключ от имени машины (слабее, но без зависимости)
        seed = f"{os.environ.get('COMPUTERNAME', '')}|{os.environ.get('USERNAME', '')}|glpi-cleaner"
        key = base64.urlsafe_b64encode(hashlib.sha256(seed.encode()).digest())
        path.write_bytes(key)
        return key
    path.write_bytes(key)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    return key


def encrypt_secret(plain: str) -> str:
    text = str(plain or "")
    if not text:
        return ""
    try:
        from cryptography.fernet import Fernet

        return Fernet(_fernet_key()).encrypt(text.encode("utf-8")).decode("ascii")
    except Exception as exc:
        get_logger().warning("encrypt_secret fallback: %s", type(exc).__name__)
        return "b64:" + base64.urlsafe_b64encode(text.encode("utf-8")).decode("ascii")


def decrypt_secret(cipher: str) -> str:
    raw = str(cipher or "")
    if not raw:
        return ""
    if raw.startswith("b64:"):
        try:
            return base64.urlsafe_b64decode(raw[4:].encode("ascii")).decode("utf-8")
        except Exception:
            return ""
    try:
        from cryptography.fernet import Fernet

        return Fernet(_fernet_key()).decrypt(raw.encode("ascii")).decode("utf-8")
    except Exception as exc:
        get_logger().warning("decrypt_secret failed: %s", type(exc).__name__)
        return ""
