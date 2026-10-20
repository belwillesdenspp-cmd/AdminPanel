"""Журнал без токенов и паролей."""

from __future__ import annotations

import logging
import re

_SECRET = re.compile(r"(app_token|user_token|session_token|authorization)\s*[:=]\s*\S+", re.I)


class RedactFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            record.msg = _SECRET.sub(r"\1=<скрыто>", record.msg)
        return True


def build_logger(name: str = "glpi_sla", verbose: bool = False) -> logging.Logger:
    log = logging.getLogger(name)
    log.setLevel(logging.DEBUG if verbose else logging.INFO)
    log.addFilter(RedactFilter())
    if not log.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
        handler.addFilter(RedactFilter())
        log.addHandler(handler)
    return log
