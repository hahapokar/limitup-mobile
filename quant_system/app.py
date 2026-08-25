"""
A-Share Limit-Up Quant Trading System - Main Entry Point & Daemon.
Supports CLI commands (review, trade, status, health, daemon) and automated scheduling.
"""

import os
import sys
import time
import argparse
import logging
from pathlib import Path

# Add project root to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from quant_system.config import START_DATE, DATA_DIR, PORTFOLIO_FILE
from quant_system.utils.calendar import normalize_to_trade_day, is_trade_day
from quant_system.utils.notifier import record_system_log, send_notification
from quant_system.core.data_fetcher import data_fetcher
from quant_system.core.sentiment import sentiment_engine
from quant_system.core.scoring import scoring_engine
from quant_system.core.portfolio import portfolio_engine
from quant_system.scheduler.engine import quant_scheduler
from quant_system.web_server import start_web_server, WEB_PORT

logger = logging.getLogger("QuantTrading.Main")


def run_init_bootstrap() -> None:
    """Initialize missing data, or catch up a missed post-market run on startup."""
    session = data_fetcher.get_market_session_status()
    current_trade_date = session.get("latest_trade_date") or normalize_to_trade_day(START_DATE)

    latest_candidates_date = ""
    latest_candidates_file = DATA_DIR / "latest_candidates.json"
    if latest_candidates_file.exists():
        try:
            import json
            with open(latest_candidates_file, "r", encoding="utf-8") as f:
                latest_candidates_date = str((json.load(f) or {}).get("trade_date") or "")
        except (OSError, ValueError, TypeError):
            latest_candidates_date = ""

    # A daemon started after 15:30 must not wait until the next trading day
    # to produce the pool for tomorrow.
    if (
        latest_candidates_date != current_trade_date
        and session.get("session_phase") == "CLOSED"
        and session.get("today_date") == current_trade_date
    ):
        record_system_log("INFO", "Bootstrap", f"Detected stale candidate pool ({latest_candidates_date or 'missing'}); catching up {current_trade_date} post-market review")
        quant_scheduler.trigger_manual_review(current_trade_date)
        return

    if latest_candidates_date:
        record_system_log("INFO", "Bootstrap", f"Keeping existing candidate pool for {latest_candidates_date}; no bootstrap overwrite")
        return

    effective_date = normalize_to_trade_day(START_DATE)
    record_system_log("INFO", "Bootstrap", f"Initializing missing baseline data with anchor date: {START_DATE} -> Normalized: {effective_date}")
    
    # 1. Market Sentiment & Timing
    sentiment = sentiment_engine.calculate_sentiment(effective_date)
    
    # 2. 4-Factor Percentile Scoring
    scoring = scoring_engine.run_daily_scoring(effective_date)
    
    # 3. Portfolio Settle
    portfolio_engine.settle_daily_nav(effective_date)
    
    record_system_log("INFO", "Bootstrap", f"System bootstrap completed successfully for {effective_date}.")


def main():
    parser = argparse.ArgumentParser(description="A-Share Limit-Up Quant Trading System")
    parser.add_argument("command", nargs="?", default="daemon", choices=["daemon", "web", "review", "trade", "status", "health", "reset"], help="Command to execute")
    parser.add_argument("--date", type=str, default=None, help="Target trading date YYYY-MM-DD")
    parser.add_argument("--capital", type=float, default=1000000.0, help="Initial capital for account reset")
    parser.add_argument("--port", type=int, default=WEB_PORT, help="Port for web dashboard")
    
    args = parser.parse_args()
    
    if args.command == "health":
        print("\n=== Data Sources Health Probe ===")
        health = data_fetcher.test_data_sources_health()
        for k, v in health.items():
            print(f"[{v['priority']}] {v['name']} ({v['endpoint']}): {v['status']} - Latency: {v['latency_ms']}ms")
        print("=================================\n")
        return

    elif args.command == "review":
        target = args.date or data_fetcher.get_market_session_status().get("latest_trade_date")
        if not target:
            print("No current market session date is available; review was not run.")
            return
        effective = normalize_to_trade_day(target)
        print(f"\n🚀 Running Daily Review for {effective}...")
        res = quant_scheduler.trigger_manual_review(effective)
        print(f"Market Sentiment: {res['sentiment']['sentiment_score']} ({res['sentiment']['sentiment_level']})")
        print(f"Circuit Breaker: {res['sentiment']['sentiment_circuit_breaker']}")
        print(f"Candidates Picked: {len(res['scoring']['candidates'])}")
        for c in res['scoring']['candidates']:
            print(f"  - [{c['code']}] {c['name']} (Score: {c['quant_score']:.2f}) | Sector: {c['sector']}")
        return

    elif args.command == "trade":
        target = args.date or data_fetcher.get_market_session_status().get("latest_trade_date")
        if not target:
            print("No current market session date is available; trading was not run.")
            return
        effective = normalize_to_trade_day(target)
        print(f"\n🛒 Running Paper Trading Routine for {effective}...")
        res = quant_scheduler.trigger_manual_trading(effective)
        print(f"Executed Buys: {len(res['buys_executed'])}")
        print(f"Executed Exits: {len(res['exits_executed'])}")
        print(f"Current NAV: {res['portfolio_state']['nav']:.4f}, Total Asset: ¥{res['portfolio_state']['total_asset']:,.2f}")
        return

    elif args.command == "reset":
        portfolio_engine.reset_account(args.capital)
        print(f"Account successfully reset to ¥{args.capital:,.2f}")
        return

    elif args.command == "status":
        state = portfolio_engine.load_state()
        print("\n=== Portfolio State ===")
        print(f"NAV: {state.get('nav', 1.0):.4f}")
        print(f"Total Asset: ¥{state.get('total_asset', 0):,.2f}")
        print(f"Cash: ¥{state.get('cash', 0):,.2f}")
        print(f"Market Value: ¥{state.get('market_value', 0):,.2f}")
        print(f"Open Positions: {len(state.get('holdings', []))}")
        for h in state.get('holdings', []):
            print(f"  * {h['name']}({h['code']}): {h['shares']} shares @ ¥{h['entry_price']:.2f} -> Now ¥{h['current_price']:.2f} ({h['unrealized_pnl_pct']:+.2f}%)")
        print("=======================\n")
        return

    elif args.command == "web":
        print(f"\n=======================================================")
        print(f"  Starting Port {args.port} Web Monitoring Server")
        print(f"=======================================================")
        run_init_bootstrap()
        print(f"🚀 Web Dashboard active: http://localhost:{args.port}")
        start_web_server(port=args.port, background=False)
        return

    elif args.command == "daemon":
        print("\n=======================================================")
        print(f"  A-Share Limit-Up Quant Trading System Daemon (Port {args.port})")
        print("=======================================================")
        run_init_bootstrap()

        # 完整多 Tab 界面由 Node/Vite (server.ts) 占用 3006；Python 简易 HTML 看板仅作兜底
        if os.environ.get("QUANT_SKIP_WEB") != "1":
            start_web_server(port=args.port, background=True)
            print(f"🌐 Legacy HTML dashboard live at http://localhost:{args.port}")
        else:
            print("🌐 3006 交给 AI Studio 前端 (npm run dev / server.ts)")
        
        quant_scheduler.start()
        print("Scheduler active. Press Ctrl+C to terminate.")
        try:
            while True:
                time.sleep(1)
        except (KeyboardInterrupt, SystemExit):
            print("\nShutting down scheduler...")
            quant_scheduler.stop()


if __name__ == "__main__":
    main()
