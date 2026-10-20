"""Запуск и остановка фонового демона (без GUI)."""

from __future__ import annotations

import os
import signal
import subprocess
import sys
from pathlib import Path

from .config_manager import app_dir
from .logger import get_logger

PID_FILE = "glpi-cleaner-daemon.pid"


def pid_path() -> Path:
    return app_dir() / PID_FILE


def _is_pid_running(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        if os.name == "nt":
            import ctypes

            kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
            SYNCHRONIZE = 0x00100000
            handle = kernel32.OpenProcess(SYNCHRONIZE, False, pid)
            if handle:
                kernel32.CloseHandle(handle)
                return True
            return False
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def read_daemon_pid() -> int | None:
    path = pid_path()
    if not path.exists():
        return None
    try:
        pid = int(path.read_text(encoding="utf-8").strip())
    except (ValueError, OSError):
        return None
    if _is_pid_running(pid):
        return pid
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass
    return None


def is_daemon_running() -> bool:
    return read_daemon_pid() is not None


def resolve_cli_command() -> list[str]:
    """Команда запуска CLI в режиме --daemon."""
    base = app_dir()
    if getattr(sys, "frozen", False):
        # Рядом с GUI-exe должен лежать glpi-cleaner-cli.exe
        cli_exe = base / "glpi-cleaner-cli.exe"
        if cli_exe.exists():
            return [str(cli_exe), "--daemon"]
        # Fallback: тот же бинарник не подходит (GUI windowed). Ищем cli.
        for name in ("glpi-cleaner-cli.exe", "glpi-cleaner-cli"):
            candidate = base / name
            if candidate.exists():
                return [str(candidate), "--daemon"]
        raise FileNotFoundError(
            "Не найден glpi-cleaner-cli.exe рядом с программой. "
            "Скопируйте его в ту же папку, что и GLPI_Cleaner.exe."
        )
    cli_py = base / "cli.py"
    return [sys.executable, str(cli_py), "--daemon"]


def start_daemon() -> int:
    """Запускает демон в отдельном процессе. Возвращает PID."""
    log = get_logger()
    existing = read_daemon_pid()
    if existing:
        log.info("Фоновый демон уже работает (PID %s)", existing)
        return existing

    cmd = resolve_cli_command()
    kwargs: dict = {
        "cwd": str(app_dir()),
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
        "stdin": subprocess.DEVNULL,
    }
    if os.name == "nt":
        # Без окна консоли, отвязка от GUI
        CREATE_NO_WINDOW = 0x08000000
        DETACHED_PROCESS = 0x00000008
        CREATE_NEW_PROCESS_GROUP = 0x00000200
        kwargs["creationflags"] = CREATE_NO_WINDOW | DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
        kwargs["close_fds"] = True
    else:
        kwargs["start_new_session"] = True

    proc = subprocess.Popen(cmd, **kwargs)
    pid_path().write_text(str(proc.pid), encoding="utf-8")
    log.info("Фоновый демон запущен (PID %s): %s", proc.pid, " ".join(cmd))
    return proc.pid


def stop_daemon() -> bool:
    """Останавливает демон по PID-файлу. True если был остановлен или уже не работал."""
    log = get_logger()
    pid = read_daemon_pid()
    path = pid_path()
    if pid is None:
        log.info("Фоновый демон не запущен")
        return True
    try:
        if os.name == "nt":
            subprocess.run(
                ["taskkill", "/PID", str(pid), "/F"],
                check=False,
                capture_output=True,
                creationflags=0x08000000 if hasattr(subprocess, "CREATE_NO_WINDOW") else 0,
            )
        else:
            os.kill(pid, signal.SIGTERM)
        log.info("Фоновый демон остановлен (PID %s)", pid)
    except OSError as exc:
        log.warning("Не удалось остановить PID %s: %s", pid, exc)
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass
    return True


def daemon_status_text() -> str:
    pid = read_daemon_pid()
    if pid:
        return f"Фон: работает (PID {pid})"
    return "Фон: не запущен"
