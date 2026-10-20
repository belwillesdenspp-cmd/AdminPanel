"""CLI: python analyze.py --config config.json --output report.xlsx"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from core.config_manager import load_config
from core.logger import build_logger
from core.runner import run_analysis


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="SLA заявок GLPI по рабочему календарю")
    parser.add_argument("--config", default="config.json")
    parser.add_argument("--output", default="")
    parser.add_argument("--since", type=int, default=None, help="Период в днях вместо месяцев из конфига")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument("--fail-on-sla", action="store_true")
    args = parser.parse_args(argv)
    log = build_logger(verbose=args.verbose)
    try:
        cfg = load_config(args.config)
        result = run_analysis(
            cfg,
            log,
            since_days=args.since,
            dry_run=args.dry_run,
            output=args.output or None,
        )
    except Exception as err:
        log.error("%s", err)
        return 1
    if args.fail_on_sla and not args.dry_run and int(result.get("over_count") or 0) > 0:
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
