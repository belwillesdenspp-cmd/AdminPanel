#!/usr/bin/env python3
"""Точка входа графического интерфейса GLPI Cleaner."""

from __future__ import annotations

import sys
from pathlib import Path

if getattr(sys, "frozen", False):
    sys.path.insert(0, str(Path(sys.executable).resolve().parent))
else:
    sys.path.insert(0, str(Path(__file__).resolve().parent))

from gui.app import run_app


def main() -> int:
    run_app()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
