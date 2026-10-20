"""Доступ к локальным и UNC-путям (опционально с SMB-учёткой)."""

from __future__ import annotations

import os
import subprocess
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

from .logger import get_logger
from .secrets import decrypt_secret


def _is_unc(path: str) -> bool:
    p = str(path or "").replace("/", "\\")
    return p.startswith("\\\\")


def _unc_share_root(path: str) -> str:
    """\\\\server\\share из полного UNC."""
    p = str(path).replace("/", "\\").rstrip("\\")
    parts = p.split("\\")
    # ['', '', server, share, ...]
    if len(parts) >= 4 and parts[0] == "" and parts[1] == "":
        return f"\\\\{parts[2]}\\{parts[3]}"
    return p


def test_path_access(path: str, config: dict[str, Any]) -> tuple[bool, str]:
    try:
        with ensure_writable_path(path, config) as resolved:
            probe = Path(resolved) / ".glpi_cleaner_write_test"
            probe.write_text("ok", encoding="utf-8")
            probe.unlink(missing_ok=True)
        return True, f"Доступ есть: {path}"
    except Exception as exc:
        return False, f"Нет доступа: {exc}"


@contextmanager
def ensure_writable_path(path: str, config: dict[str, Any]) -> Iterator[str]:
    """
    Гарантирует доступ к каталогу. Для UNC при необходимости выполняет net use.
    Пароль не логируется.
    """
    log = get_logger()
    target = str(path or "").strip()
    if not target:
        raise RuntimeError("Путь не задан")

    smb = (config.get("export") or {}).get("smb") or {}
    username = str(smb.get("username") or "").strip()
    password = decrypt_secret(str(smb.get("password_enc") or ""))
    domain = str(smb.get("domain") or "").strip()
    mounted = False
    share = ""

    try:
        if _is_unc(target) and username and password and os.name == "nt":
            share = _unc_share_root(target)
            user = f"{domain}\\{username}" if domain else username
            # net use \\server\share /user:... password
            cmd = ["net", "use", share, password, f"/user:{user}"]
            log.info("Подключение к сетевой папке %s (user=%s)", share, user)
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                encoding="oem",
                errors="replace",
                creationflags=0x08000000 if hasattr(subprocess, "CREATE_NO_WINDOW") else 0,
            )
            if result.returncode != 0:
                err = (result.stderr or result.stdout or "").strip()
                # уже подключено — часто код 1219/2 — пробуем продолжить
                if "1219" not in err and "already" not in err.lower() and "уже" not in err.lower():
                    raise RuntimeError(f"SMB connect failed (code {result.returncode})")
            else:
                mounted = True
                log.info("SMB: подключение успешно")

        path_obj = Path(target)
        path_obj.mkdir(parents=True, exist_ok=True)
        yield str(path_obj.resolve() if not _is_unc(target) else path_obj)
    finally:
        if mounted and share and os.name == "nt":
            try:
                subprocess.run(
                    ["net", "use", share, "/delete", "/y"],
                    capture_output=True,
                    creationflags=0x08000000 if hasattr(subprocess, "CREATE_NO_WINDOW") else 0,
                )
                log.info("SMB: отключение %s", share)
            except Exception:
                pass
