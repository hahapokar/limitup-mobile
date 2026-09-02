"""Lightweight post-market stock selection CLI.

This project keeps the core quant factor pipeline, but strips trading, paper-account,
and intraday monitoring logic from the active runtime.
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from quant_system.config import DATA_DIR
from quant_system.core.data_fetcher import data_fetcher
from quant_system.core.scoring import scoring_engine


def main() -> None:
    parser = argparse.ArgumentParser(description="Lightweight post-market stock selection")
    parser.add_argument("command", nargs="?", default="review", choices=["review", "health", "status"], help="Command to execute")
    parser.add_argument("--date", type=str, default=None, help="Trading date YYYY-MM-DD")
    parser.add_argument("--port", type=int, default=3006, help="Legacy web port (kept for compatibility only)")
    args = parser.parse_args()

    if args.command == "health":
        print("\n=== Data sources health ===")
        health = data_fetcher.test_data_sources_health()
        for key, value in health.items():
            print(f"[{value['priority']}] {value['name']} ({value['endpoint']}): {value['status']} - {value['latency_ms']}ms")
        print("========================\n")
        return

    if args.command == "status":
        latest_file = DATA_DIR / "latest_candidates.json"
        if latest_file.exists():
            with open(latest_file, "r", encoding="utf-8") as fh:
                payload = json.load(fh)
            print("\n=== Latest post-market selection ===")
            print(f"trade_date: {payload.get('trade_date')}")
            print(f"candidates_count: {payload.get('candidates_count')}")
            for stock in (payload.get("candidates") or [])[:8]:
                print(f"  - {stock.get('code')} {stock.get('name')} | score={stock.get('quant_score')} | change={stock.get('change_pct')}%")
            print("==============================\n")
        else:
            print("No post-market selection snapshot found.")
        return

    target = args.date or data_fetcher.get_market_session_status().get("latest_trade_date")
    if not target:
        print("No trade date is available; review cannot run.")
        return

    print(f"\nRunning daily post-market review for {target}...")
    result = scoring_engine.run_daily_scoring(target)
    print(f"candidates_count: {result['candidates_count']}")
    for stock in result.get("candidates", [])[:8]:
        print(f"  - [{stock['code']}] {stock['name']} | score={stock['quant_score']:.2f} | sector={stock['sector']}")
    print("\nReview finished.")


if __name__ == "__main__":
    main()
