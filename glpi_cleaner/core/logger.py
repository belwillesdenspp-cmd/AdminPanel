"""Настройка логирования с ротацией файлов."""

from __future__ import annotations

import logging
from logging.handlers import RotatingFileHandler
from typing import Callable

from .config_manager import logs_dir

_configured = False
_gui_handlers: list[Callable[[str], None]] = []


class GuiLogHandler(logging.Handler):
    """Передаёт строки лога в GUI (если подписан)."""

    def emit(self, record: logging.LogRecord) -> None:
        try:
            msg = self.format(record)
            for cb in list(_gui_handlers):
                try:
                    cb(msg)
                except Exception:
                    pass
        except Exception:
            self.handleError(record)


def subscribe_gui(callback: Callable[[str], None]) -> None:
    if callback not in _gui_handlers:
        _gui_handlers.append(callback)


def unsubscribe_gui(callback: Callable[[str], None]) -> None:
    if callback in _gui_handlers:
        _gui_handlers.remove(callback)


def setup_logging(level: str = "INFO", max_bytes: int = 5_000_000, backup_count: int = 5) -> logging.Logger:
    global _configured
    logger = logging.getLogger("glpi_cleaner")
    logger.setLevel(getattr(logging, str(level).upper(), logging.INFO))
    logger.propagate = False

    if _configured:
        return logger

    fmt = logging.Formatter(
        "%(asctime)s | %(levelname)-7s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    log_file = logs_dir() / "glpi_cleaner.log"
    file_handler = RotatingFileHandler(
        log_file,
        maxBytes=max_bytes,
        backupCount=backup_count,
        encoding="utf-8",
    )
    file_handler.setFormatter(fmt)
    logger.addHandler(file_handler)

    console = logging.StreamHandler()
    console.setFormatter(fmt)
    logger.addHandler(console)

    gui_handler = GuiLogHandler()
    gui_handler.setFormatter(fmt)
    logger.addHandler(gui_handler)

    _configured = True
    return logger


def get_logger() -> logging.Logger:
    if not _configured:
        return setup_logging()
    return logging.getLogger("glpi_cleaner")
