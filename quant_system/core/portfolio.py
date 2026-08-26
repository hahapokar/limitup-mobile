"""
Real-Market Driven Paper Trading & Portfolio Management Engine.
Manages positions, enforces T+1 buy rules, Anti-Shakeout Stops, Trailing Exits, and NAV accounting.
"""

import json
import logging
import datetime
from typing import List, Dict, Any, Optional
from pathlib import Path

from quant_system.config import (
    INITIAL_CAPITAL,
    MAX_POSITIONS,
    BUY_FRICTION_RATE,
    SELL_FRICTION_RATE,
    SKIP_ONE_WORD_ZT_OPEN_PCT,
    SKIP_WEAK_OPEN_PCT,
    SKIP_HIGH_CHASE_OPEN_PCT,
    SKIP_BUY_IF_INDEX_OPEN_PCT_BELOW,
    SKIP_BUY_IF_SENTIMENT_IN,
    BUY_CANDIDATE_MAX_RANK,
    REBREAK_LIMIT_TOLERANCE_PCT,
    PULLBACK_MIN_CHANGE_PCT,
    PULLBACK_MAX_CHANGE_PCT,
    PULLBACK_FROM_HIGH_PCT,
    TRAILING_STOP_PCT,
    HARD_STOP_PCT,
    ANTI_SHAKEOUT_TIME_WINDOW_MINS,
    ANTI_SHAKEOUT_VOLUME_RATIO,
    T2_FORCED_EXIT_TIME,
    PORTFOLIO_FILE,
    DATA_DIR
)
from quant_system.config import snapshot_manifest_file
from quant_system.core.data_fetcher import data_fetcher
from quant_system.utils.calendar import normalize_to_trade_day, get_prev_trade_day, get_next_trade_day
from quant_system.utils.notifier import record_system_log, send_notification

logger = logging.getLogger("QuantTrading.Portfolio")


class PortfolioEngine:
    """
    Simulated Paper Trading Engine driven 100% by real exchange quotes.
    Handles order execution, friction accounting, trailing take-profits, and anti-whipsaw stops.
    """

    def __init__(self):
        self.state_file = PORTFOLIO_FILE
        self._ensure_state_exists()

    def _ensure_state_exists(self) -> None:
        """Initialize paper trading state file if not present."""
        if not self.state_file.exists():
            self.reset_account(INITIAL_CAPITAL)

    def load_state(self) -> Dict[str, Any]:
        """Read portfolio state from JSON."""
        try:
            with open(self.state_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Failed to read portfolio state: {e}")
            return self.reset_account(INITIAL_CAPITAL)

    def save_state(self, state: Dict[str, Any]) -> None:
        """Persist portfolio state to JSON atomically to prevent corruption on unexpected shutdown."""
        try:
            state["last_update"] = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            temp_file = self.state_file.with_suffix(".tmp")
            with open(temp_file, "w", encoding="utf-8") as f:
                json.dump(state, f, ensure_ascii=False, indent=2)
            temp_file.replace(self.state_file)
        except Exception as e:
            logger.error(f"Failed to save portfolio state: {e}")

    def reset_account(self, capital: float = INITIAL_CAPITAL) -> Dict[str, Any]:
        """Reset paper trading account to pristine initial capital (¥100,000) waiting for next open day."""
        session = data_fetcher.get_market_session_status()
        # DATA INTEGRITY: Never fall back to "2026-08-21" / "2026-08-24".
        # If get_market_session_status() cannot determine dates, leave them as
        # empty strings so the UI renders "—" instead of misleading anchors.
        latest_date: str = session.get("latest_trade_date") or ""
        next_date: str = session.get("next_trade_date") or ""

        initial_state = {
            "initial_capital": float(capital),
            "cash": float(capital),
            "market_value": 0.0,
            "total_asset": float(capital),
            "nav": 1.0000,
            "daily_pnl": 0.0,
            "total_pnl": 0.0,
            "current_step": "WAITING_NEXT_OPEN",
            "current_step_name": f"空仓就绪 · 监控下一个开盘日 ({next_date}) 集合竞价与开盘撮合",
            "holdings": [],
            "trade_history": [],
            "nav_history": [
                {
                    "date": latest_date,
                    "total_asset": float(capital),
                    "nav": 1.0000,
                    "cash": float(capital),
                    "market_value": 0.0
                }
            ],
            "recent_sell_alerts": [],
            "last_update": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }
        self.save_state(initial_state)
        record_system_log("INFO", "Portfolio", f"Account reset to pristine ¥{capital:,.2f}, ready for next trading day ({next_date})")
        return initial_state

    def setup_aug24_portfolio_state(self) -> Dict[str, Any]:
        """
        Demo entry point invoked via the "一键建仓 TOP4 模拟盘 (Aug 24)" UI button.

        DATA INTEGRITY: NEVER hard-code 博汇股份 / 日科化学 / 肯特股份 / 达意隆 or any
        specific ticker here. Instead:
          1. Read latest_candidates.json / candidates_<latest>.json
          2. Take the TOP candidates (up to CANDIDATES_SELECT_COUNT)
          3. Price them at their POST-MARKET CLOSE (candidate "price") because we do not
             have the next trading day's true opening auction tape.
          4. Compute friction from real BUY_FRICTION_RATE, split capital equally, round to
             round lots (100 shares) — all math is real for the reference price we use.
          5. Any "intraday high / current_price / unrealized_pnl / seal_ratio intraday"
             fields stay None because there is no tape; fabricating a +16% locked gain
             misleads the user into thinking a real T+0 simulation has run.
        """
        import json as _json
        from quant_system.config import (
            MAX_POSITIONS, CANDIDATES_SELECT_COUNT,
            BUY_FRICTION_RATE, DATA_DIR, INITIAL_CAPITAL, HARD_STOP_PCT, TRAILING_STOP_PCT,
        )

        init_cap = float(INITIAL_CAPITAL)
        session = data_fetcher.get_market_session_status()
        # DATA INTEGRITY: Never hard-code a fake session date (e.g. "2026-08-21").
        # If data_fetcher cannot answer, use empty string and fall back to
        # latest_candidates.json by name rather than by a fabricated date.
        latest_date: str = session.get("latest_trade_date") or ""
        next_date: str = session.get("next_trade_date") or ""

        # --- Locate candidates payload (contains real top-4 with factor scores) ---
        candidates_path = DATA_DIR / f"candidates_{latest_date}.json"
        candidates: List[Dict[str, Any]] = []
        if candidates_path.exists():
            try:
                with open(candidates_path, "r", encoding="utf-8") as f:
                    payload = _json.load(f)
                if payload.get("trade_date") != latest_date:
                    payload = {}
                candidates = list(payload.get("candidates") or [])
                if not candidates:
                    all_scored = payload.get("all_scored_stocks") or []
                    if isinstance(all_scored, list):
                        candidates = all_scored[:CANDIDATES_SELECT_COUNT]
            except Exception as pe:
                logger.warning(f"setup_demo_portfolio failed to read {candidates_path}: {pe}")
        if not isinstance(candidates, list):
            candidates = []
        # Cap at MAX_POSITIONS (never invent more slots)
        candidates = [c for c in candidates if isinstance(c, dict)][: min(CANDIDATES_SELECT_COUNT, MAX_POSITIONS)]

        trades: List[Dict[str, Any]] = []
        holdings: List[Dict[str, Any]] = []

        if candidates:
            equal_alloc = init_cap / len(candidates)
            remaining_cash = init_cap
            for idx, cand in enumerate(candidates):
                code = cand.get("code")
                name = cand.get("name")
                ref_price_raw = cand.get("price")
                if not code or not isinstance(ref_price_raw, (int, float)) or float(ref_price_raw) <= 0:
                    continue
                ref_price = float(ref_price_raw)

                slots_left = len(candidates) - idx
                alloc = min(equal_alloc, remaining_cash / slots_left) if slots_left > 0 else remaining_cash
                gross_lots = alloc / (ref_price * (1.0 + BUY_FRICTION_RATE))
                shares = int(gross_lots // 100) * 100
                if shares < 100:
                    continue

                gross = round(shares * ref_price, 2)
                friction = round(gross * BUY_FRICTION_RATE, 4)
                cost_total = round(gross + friction, 2)
                if cost_total > remaining_cash:
                    continue
                remaining_cash = round(remaining_cash - cost_total, 2)
                cost_per_share = round(cost_total / shares, 3)
                order_id = f"DEMO_BUY_{code}_{next_date.replace('-', '')}_{idx:02d}"

                reason_bits: List[str] = []
                if isinstance(cand.get("quant_score"), (int, float)):
                    reason_bits.append(
                        f"{latest_date} TOP{cand.get('rank', idx + 1)} (量化{cand['quant_score']}分)"
                    )
                if isinstance(cand.get("sector"), str):
                    reason_bits.append(f"板块：{cand['sector']}")
                reason_bits.append(
                    f"以 {latest_date} 盘后收盘 ¥{ref_price:.2f} 作为参考价建仓 "
                    f"(无真实开盘撮合数据，仅供演示等权分配)"
                )

                trades.append({
                    "order_id": order_id,
                    "type": "BUY",
                    "code": code,
                    "name": name,
                    "date": next_date,
                    "time": "09:30:00",
                    "price": ref_price,
                    "shares": shares,
                    "amount": gross,
                    "friction": friction,
                    "cost_price": cost_per_share,
                    "reason": " · ".join(reason_bits),
                })

                hard_stop = round(ref_price * (1.0 + HARD_STOP_PCT), 2)
                trail_stop = round(ref_price * (1.0 - TRAILING_STOP_PCT), 2)
                holdings.append({
                    "code": code,
                    "name": name,
                    "shares": shares,
                    "entry_price": ref_price,
                    "cost_price": cost_per_share,
                    "entry_date": next_date,
                    "holding_days": 0,
                    "can_sell": False,
                    "t1_lock_text": f"T+0 当日买入锁仓 (下一交易日可卖)",
                    "sell_available_date": get_next_trade_day(next_date) if next_date else "",
                    "high_price": None,       # no intraday tape => null
                    "current_price": None,    # no intraday tape => null (do NOT fabricate +16% ZT)
                    "market_value": None,     # unknown without current_price
                    "unrealized_pnl": None,
                    "unrealized_pnl_pct": None,
                    "anti_shakeout_count": 0,
                    "hard_stop_price": hard_stop,
                    "sector": cand.get("sector"),
                    "change_pct": None,
                    "turnover_rate": cand.get("turnover_rate"),
                    "seal_ratio_pct": (
                        round(float(cand["seal_ratio"]) * 100, 2)
                        if isinstance(cand.get("seal_ratio"), (int, float)) else None
                    ),
                    "pullback_pct": None,
                    "trailing_stop_price": trail_stop,
                    "status_tag": "LOCKED",
                })

        total_market_value = 0.0
        cash_after = init_cap
        for h in holdings:
            if isinstance(h.get("entry_price"), (int, float)) and isinstance(h.get("shares"), int):
                mv = float(h["entry_price"]) * int(h["shares"])
                h["market_value"] = round(mv, 2)  # at entry reference price
                total_market_value += mv
        # Sum friction / gross properly from trades list
        total_gross = sum(float(t["amount"]) for t in trades)
        total_friction = sum(float(t.get("friction", 0.0)) for t in trades)
        cash_after = round(init_cap - (total_gross + total_friction), 2)
        # If holdings have no current_market_value => use entry-based MV for total-asset book value
        book_mv = sum(
            float(h["entry_price"]) * int(h["shares"])
            for h in holdings
            if isinstance(h.get("entry_price"), (int, float)) and isinstance(h.get("shares"), int)
        )
        total_asset = round(cash_after + book_mv, 2)
        nav = round(total_asset / init_cap, 4) if init_cap else 1.0
        daily_pnl = round(total_asset - init_cap, 2)

        nav_history: List[Dict[str, Any]] = [
            {"date": latest_date, "total_asset": init_cap, "nav": 1.0, "cash": init_cap, "market_value": 0.0},
        ]
        # Only append next-day nav row if we actually deployed cash
        if holdings:
            nav_history.append({
                "date": next_date,
                "total_asset": total_asset,
                "nav": nav,
                "cash": cash_after,
                "market_value": round(book_mv, 2),
            })

        state = {
            "initial_capital": init_cap,
            "cash": cash_after,
            "market_value": round(book_mv, 2),
            "total_asset": total_asset,
            "nav": nav,
            "daily_pnl": daily_pnl,
            "total_pnl": daily_pnl,
            "current_step": "DEMO_TOP4_BOUGHT",
            "current_step_name": (
                f"参考 {latest_date} 盘后候选 TOP{len(holdings)} 等权建仓演示 "
                f"(无真实 {next_date} 开盘撮合数据) · T+0 当日锁仓"
            ),
            "holdings": holdings,
            "trade_history": trades,
            "nav_history": nav_history,
            "recent_sell_alerts": [],
            "last_update": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        }
        self.save_state(state)
        record_system_log(
            "INFO", "Portfolio",
            f"DEMO TOP{len(holdings)} portfolio built from {candidates_path.name}: "
            f"deployed ¥{init_cap - cash_after:,.2f} of ¥{init_cap:,.2f}",
        )
        return state

    def advance_to_aug25_state(self) -> Dict[str, Any]:
        """
        Advance the demo portfolio one day forward: unlock holdings to T+1 (可卖).

        DATA INTEGRITY: NEVER invent specific sell actions (达意隆跌破止损 / 肯特股份移动止盈 /
        博汇股份冲击连板 etc.) because we do not have real T+1 tape. The ONLY safe transition
        is to flip holding_days=1 + can_sell=True and let the real sell-execution engine
        (auto_sync_and_trade) drive exits when/if real market quotes are available.
        """
        state = self.load_state()
        holdings = state.get("holdings") or []
        # If the user pressed "T+1 unlock" before ever buying anything, build demo first.
        if not holdings:
            fresh = self.setup_aug24_portfolio_state()
            holdings = fresh.get("holdings", [])
            state = fresh

        session = data_fetcher.get_market_session_status()
        # DATA INTEGRITY: Never fall back to a hard-coded "2026-08-25".
        # Without a real next-session date, use empty string so the step text
        # still warns "no real T+1 tape available".
        next_date: str = session.get("next_trade_date") or ""

        for h in holdings:
            if not isinstance(h, dict):
                continue
            h["holding_days"] = 1
            h["can_sell"] = True
            h["t1_lock_text"] = "T+1 已解除锁仓 · 可触发卖出风控 (若无真实行情则不伪造成交)"
            # Intentionally NOT inventing current_price / unrealized_pnl here either.
            # They remain None until real quotes flow in via auto_sync_and_trade.

        state["current_step"] = "DEMO_T1_UNLOCKED"
        state["current_step_name"] = (
            f"下一交易日 ({next_date}) T+1 解锁：持仓已升级为可卖状态，"
            f"卖出信号需真实行情驱动 (本步骤不伪造任何止损/止盈成交)"
        )
        state["last_update"] = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        self.save_state(state)
        record_system_log(
            "INFO", "Portfolio",
            f"Demo portfolio unlocked to T+1 for next trading day {next_date}; no fabricated sell trades",
        )
        return state

    # -------------------------------------------------------------------------
    # 1. T+1 BUY EXECUTION (09:30 Opening Call)
    # -------------------------------------------------------------------------
    def execute_t1_buys(self, trade_date: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Execute T+1 simulated purchases based on yesterday's candidate JSON.
        Applies One-Word ZT skip filter, Weak/Chase open skip filter,
        global index crash skip filter, and sentiment skip filter.

        KEY RULE (per user request: 买入决策只在前一天 15:30 盘后产物基础上做，
        盘中心跳不重算情绪分 / 选股 / 涨停池):
          - Sentiment inputs (sentiment_state, target_position_ratio,
            sentiment_circuit_breaker) come ONLY from
            sentiment_{prev_date}.json (the previous day's 15:30 artifact).
            We NEVER call sentiment_engine.calculate_sentiment() here because
            the current day's sentiment file isn't produced until 15:30.
          - This function is a NO-OP outside the 09:30-09:50 opening window;
            calling it every heartbeat is wasteful (it reads candidates + 3
            index quotes + candidate quotes) so we return [] immediately.
        """
        effective_date = data_fetcher.get_effective_date(trade_date)

        # ---------- TIME-WINDOW GUARD ------------------------------------------
        _now_bj = datetime.datetime.utcnow() + datetime.timedelta(hours=8)
        _bj_min = _now_bj.hour * 60 + _now_bj.minute
        _OPEN_START = 9 * 60 + 28   # 09:28 (allow ~2 min pre-open drift)
        _OPEN_END   = 9 * 60 + 50   # 09:50 (hard stop; post-open opportunity gone)
        _in_open_window = _OPEN_START <= _bj_min <= _OPEN_END
        _in_continuous_window = (9 * 60 + 50 < _bj_min < 11 * 60 + 30) or (13 * 60 <= _bj_min <= 15 * 60)
        if not (_in_open_window or _in_continuous_window):
            return []

        prev_date = get_prev_trade_day(effective_date)
        state = self.load_state()

        # -------------------------------------------------------------
        # GLOBAL KILL-SWITCH 1: Sentiment Phase Skip + Target Position
        #   Reads the PREVIOUS trade day's sentiment file (emitted at T-1
        #   15:30). T's end-of-day sentiment won't exist until 15:30 today,
        #   so calling calculate_sentiment() here is both slow AND wrong.
        # -------------------------------------------------------------
        sentiment_state_val: Optional[str] = None
        target_pos_ratio = 0.0
        is_circuit_breaker = True

        def _try_read_sentiment_file(path) -> Optional[Dict[str, Any]]:
            if not path.exists():
                return None
            try:
                with open(path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                return None

        s_data = _try_read_sentiment_file(DATA_DIR / f"sentiment_{prev_date}.json")

        manifest = _try_read_sentiment_file(snapshot_manifest_file(prev_date))
        if not manifest or manifest.get("trade_date") != prev_date or manifest.get("snapshot_status") != "FINAL":
            record_system_log(
                "WARNING", "Portfolio",
                f"T-1 快照 {prev_date} 未完成 FINAL 发布，禁止使用旧/半成品数据建仓。"
            )
            return []

        if s_data is not None and s_data.get("trade_date") == prev_date and s_data.get("snapshot_status") == "FINAL":
            sentiment_state_val = s_data.get("sentiment_state")
            if s_data.get("sentiment_circuit_breaker", False):
                record_system_log(
                    "WARNING", "Portfolio",
                    f"Circuit Breaker ACTIVE (from {prev_date} sentiment)! New buy orders FROZEN."
                )
                return []
            tpr = s_data.get("target_position_ratio")
            if isinstance(tpr, (int, float)) and 0.0 <= float(tpr) <= 1.0:
                target_pos_ratio = float(tpr)
                is_circuit_breaker = False
            else:
                record_system_log(
                    "WARNING", "Portfolio",
                    f"target_position_ratio missing in {prev_date} sentiment; treating buys as unsafe (0% cap)."
                )
                target_pos_ratio = 0.0
                is_circuit_breaker = True
        else:
            # No sentiment file at all (fresh install or first day of a run).
            # Avoid deploying uninformed → target 0% / circuit_breaker on.
            record_system_log(
                "WARNING", "Portfolio",
                f"No sentiment file for {prev_date} (15:30盘后产物尚未生成)，跳过今日自动建仓。"
            )
            return []

        if sentiment_state_val and sentiment_state_val in SKIP_BUY_IF_SENTIMENT_IN:
            record_system_log(
                "WARNING", "Portfolio",
                f"今日情绪阶段=[{sentiment_state_val}]∈弱势/退潮集合 {sorted(SKIP_BUY_IF_SENTIMENT_IN)}, 跳过建仓 (资金优先控回撤)"
            )
            return []

        # -------------------------------------------------------------
        # GLOBAL KILL-SWITCH 2: Broad Market Index Open Skip (NEW)
        #   If the 3 major A-share indices (上证/深证/创业板) collectively
        #   open poorly, skip all buys — individual stock quality cannot
        #   fight a macro tape crash.
        #
        #   CAUTION: We DO NOT use normalize_symbol(["000001"]) because
        #   that produces sz000001 = Ping An Bank (个股), not 上证指数.
        #   We directly inject the sh/sz prefixed composite index symbols.
        # -------------------------------------------------------------
        index_symbols = {
            "上证指数": "sh000001",
            "深证成指": "sz399001",
            "创业板指": "sz399006",
        }
        try:
            import requests as _req
            _idx_url = f"https://qt.gtimg.cn/q={','.join(index_symbols.values())}"
            _idx_resp = data_fetcher.session.get(_idx_url, timeout=3)
            bad_idx_count = 0
            index_lines = [l for l in _idx_resp.text.split(";") if l.strip()]
            for line in index_lines:
                parts = line.split("~")
                if len(parts) <= 5:
                    continue
                idx_name = parts[1]
                idx_pc = float(parts[4] or 0)
                idx_op = float(parts[5] or 0)
                if idx_pc > 0 and idx_op > 0:
                    idx_open_pct = (idx_op - idx_pc) / idx_pc * 100.0
                    if idx_open_pct < SKIP_BUY_IF_INDEX_OPEN_PCT_BELOW:
                        bad_idx_count += 1
                    record_system_log(
                        "INFO", "Portfolio",
                        f"[买入前指数审查] {idx_name}: 开{idx_open_pct:+.2f}% (阈值{SKIP_BUY_IF_INDEX_OPEN_PCT_BELOW}%)"
                    )
            # 2 out of 3 indices open weak → whole tape is bad → no buys today
            if bad_idx_count >= 2:
                record_system_log(
                    "WARNING", "Portfolio",
                    f"⛔ 3大指数中 {bad_idx_count} 个低开 < {SKIP_BUY_IF_INDEX_OPEN_PCT_BELOW}% (大盘系统性弱势), 跳过今日所有建仓"
                )
                return []
        except Exception as e2:
            logger.warning(f"SSE composite index lookup failed (non-fatal, proceeding): {e2}")

        # Locate the previous trading day's post-market ranking. New candidates
        # are only eligible on the next opening call; same-day released cash is
        # deliberately not reused for intraday chasing.
        candidates_file = DATA_DIR / f"candidates_{prev_date}.json"

        if not candidates_file.exists():
            record_system_log("INFO", "Portfolio", f"No candidates file found for {prev_date}. Skipping buy execution.")
            return []

        try:
            with open(candidates_file, "r", encoding="utf-8") as f:
                c_payload = json.load(f)
                if c_payload.get("trade_date") != prev_date:
                    record_system_log(
                        "WARNING", "Portfolio",
                        f"Candidate file {candidates_file.name} is not the previous trading day's artifact; skipping buys."
                    )
                    return []
                if c_payload.get("snapshot_status") != "FINAL":
                    record_system_log(
                        "WARNING", "Portfolio",
                        f"候选快照 {prev_date} 尚未标记 FINAL，禁止使用未完成数据建仓。"
                    )
                    return []
                candidates = c_payload.get("all_scored_stocks") or c_payload.get("candidates", [])
        except Exception as e:
            logger.error(f"Failed to read candidates file: {e}")
            return []

        if not candidates:
            return []

        # Preserve model rank so failed fills naturally advance to the next
        # ranked stock instead of stopping at the published Top 4.
        candidates = sorted(
            [candidate for candidate in candidates if isinstance(candidate, dict) and candidate.get("code")],
            key=lambda candidate: candidate.get("rank", 10**9),
        )[:BUY_CANDIDATE_MAX_RANK]

        # Extract codes and fetch live real-time quotes
        codes = [c["code"] for c in candidates]
        quotes = data_fetcher.get_realtime_quotes(codes)

        # Persist observations across the short-lived Python sync processes so
        # a limit-up break and subsequent re-break can be distinguished.
        entry_observations = state.setdefault("entry_observations", {})
        for candidate in candidates:
            code = candidate["code"]
            quote = quotes.get(code)
            if not quote:
                continue
            prev_close = float(quote.get("prev_close") or candidate.get("price") or 0)
            current_price = float(quote.get("price") or 0)
            if prev_close <= 0 or current_price <= 0:
                continue
            limit_rate = 0.05 if candidate.get("is_st") else (0.20 if code.startswith(("300", "688")) else 0.10)
            limit_price = round(prev_close * (1.0 + limit_rate), 2)
            observation = entry_observations.setdefault(code, {
                "date": effective_date,
                "was_limit_up": False,
                "was_broken": False,
                "rebreak_ready": False,
            })
            if observation.get("date") != effective_date:
                observation.clear()
                observation.update({
                    "date": effective_date,
                    "was_limit_up": False,
                    "was_broken": False,
                    "rebreak_ready": False,
                })
            if current_price >= limit_price - 0.01:
                if observation.get("was_broken"):
                    observation["rebreak_ready"] = True
                observation["was_limit_up"] = True
            elif observation.get("was_limit_up"):
                observation["was_broken"] = True
            observation["last_price"] = current_price
            observation["last_volume_lots"] = float(quote.get("volume_lots") or 0)
        self.save_state(state)

        # Check available cash and slots
        current_holdings = state.get("holdings", [])
        open_codes = {h["code"] for h in current_holdings}
        available_slots = max(0, MAX_POSITIONS - len(current_holdings))
        
        if available_slots <= 0 or state["cash"] < 10000.0:
            record_system_log("INFO", "Portfolio", f"No available position slots ({len(current_holdings)}/{MAX_POSITIONS}) or insufficient cash (¥{state['cash']:,.2f})")
            return []

        # Check market sentiment target position ratio
        # -------------------------------------------------------------
        # Values were already read from the PREV trading day's 15:30 sentiment
        # file at the top of this function. We NEVER run a live
        # sentiment_engine.calculate_sentiment() in the buy path because:
        #   (a) today's sentiment file is not produced until 15:30, and
        #   (b) re-running scoring/sentiment/limitup on each heartbeat is
        #       exactly what the user asked us to avoid.
        # -------------------------------------------------------------
        if is_circuit_breaker or target_pos_ratio <= 0.0:
            record_system_log(
                "WARNING", "Portfolio",
                f"情绪仓位限制(前一日盘后): target_position_ratio={target_pos_ratio*100:.0f}%，跳过建仓。"
            )
            return []

        # Calculate max deployable budget under sentiment position cap
        total_asset = float(state.get("total_asset", state.get("cash", INITIAL_CAPITAL)))
        max_allowed_stock_value = total_asset * target_pos_ratio
        current_stock_value = sum([float(h.get("market_value", 0.0)) for h in current_holdings])
        available_budget = max(0.0, min(state["cash"], max_allowed_stock_value - current_stock_value))

        if available_budget < 10000.0:
            record_system_log("INFO", "Portfolio", f"Available buying budget (¥{available_budget:,.2f}) below threshold under target position ratio {target_pos_ratio*100:.0f}%")
            return []

        executed_orders = []

        for cand in candidates:
            code = cand["code"]
            name = cand["name"]
            
            if code in open_codes:
                continue

            # Dynamically calculate capital allocation based on remaining open slots
            remaining_slots = available_slots - len(executed_orders)
            if remaining_slots <= 0 or state["cash"] < 10000.0:
                break

            alloc_per_position = min(state["cash"], available_budget / remaining_slots)

            q = quotes.get(code)
            if not q:
                continue

            open_price = float(q.get("open", q.get("price", 0)))
            prev_close = float(q.get("prev_close", cand.get("price", open_price)))
            current_price = float(q.get("price", open_price))
            
            if open_price <= 0 or prev_close <= 0:
                continue

            open_pct = ((open_price - prev_close) / prev_close) * 100.0
            current_pct = ((current_price - prev_close) / prev_close) * 100.0
            intraday_high = float(q.get("high", current_price) or current_price)
            limit_rate = 0.05 if cand.get("is_st") else (0.20 if code.startswith(("300", "688")) else 0.10)
            limit_price = round(prev_close * (1.0 + limit_rate), 2)
            observation = entry_observations.get(code, {})

            if _in_open_window:
                strategy = "OPENING"
                strategy_name = "开盘竞价买入"
            elif (
                observation.get("rebreak_ready")
                and current_price >= limit_price * (1.0 - REBREAK_LIMIT_TOLERANCE_PCT / 100.0)
                and float(q.get("sell1_vol") or 0) > 0
            ):
                strategy = "REBREAK"
                strategy_name = "炸板回封买入"
            elif (
                PULLBACK_MIN_CHANGE_PCT <= current_pct <= PULLBACK_MAX_CHANGE_PCT
                and (intraday_high - current_price) / intraday_high * 100.0 >= PULLBACK_FROM_HIGH_PCT
                and current_price > open_price
            ):
                strategy = "PULLBACK"
                strategy_name = "强势回踩买入"
            else:
                continue

            execution_price = open_price if strategy == "OPENING" else current_price

            # -------------------------------------------------------------
            # Risk Filter 1: 一字板无法买入 (Open >= 9.8% with heavy buy lock)
            # -------------------------------------------------------------
            is_chinext_or_star = code.startswith("300") or code.startswith("688")
            zt_threshold = 19.5 if is_chinext_or_star else SKIP_ONE_WORD_ZT_OPEN_PCT
            
            if strategy == "OPENING" and open_pct >= zt_threshold:
                record_system_log("WARNING", "Portfolio", f"⛔ 标的 [{name}({code})] 开盘涨幅 +{open_pct:.2f}% (一字涨停无法买入)，跳过建仓")
                continue

            # -------------------------------------------------------------
            # Risk Filter 2: 追高开盘放弃 (Open >= +6% NEW)
            #   Avoids the classic "high-open-then-fade" trap where T-day
            #   limit-up euphoria causes T+1 gap-up >6%, then sellers dump.
            # -------------------------------------------------------------
            if strategy == "OPENING" and open_pct >= SKIP_HIGH_CHASE_OPEN_PCT:
                record_system_log("WARNING", "Portfolio", f"⛔ 标的 [{name}({code})] 开盘高开 +{open_pct:.2f}% (≥{SKIP_HIGH_CHASE_OPEN_PCT}%追高阈值)，跳过避免高开低走")
                continue

            # -------------------------------------------------------------
            # Risk Filter 3: 极弱开盘放弃 (Open < -2.5% — tightened from -4.5)
            # -------------------------------------------------------------
            if strategy == "OPENING" and open_pct < SKIP_WEAK_OPEN_PCT:
                record_system_log("WARNING", "Portfolio", f"⛔ 标的 [{name}({code})] 开盘低开 {open_pct:.2f}% (≤{SKIP_WEAK_OPEN_PCT}%弱开盘阈值)，不及预期跳过")
                continue

            # -------------------------------------------------------------
            # Execute Buy Order
            # -------------------------------------------------------------
            # Shares rounded down to 100 (1 lot)
            shares = int((alloc_per_position / (execution_price * (1.0 + BUY_FRICTION_RATE))) // 100) * 100
            if shares < 100:
                continue

            gross_amount = shares * execution_price
            friction_cost = gross_amount * BUY_FRICTION_RATE
            net_amount = gross_amount + friction_cost

            if net_amount > state["cash"]:
                continue

            # Update State
            state["cash"] -= net_amount
            
            # Extract live metrics for watchlist
            turnover = float(q.get("turnover_rate", 8.5))
            vol_lots = float(q.get("volume_lots", 10000))
            buy1_lots = float(q.get("buy1_vol", 0))
            seal_rat = round((buy1_lots / vol_lots * 100.0), 2) if vol_lots > 0 else 0.0

            holding_entry = {
                "code": code,
                "name": name,
                "shares": shares,
                "entry_price": execution_price,
                "cost_price": round(net_amount / shares, 3),
                "entry_date": effective_date,
                "holding_days": 0,  # 0 on T+0 buy day, 1 on T+1, 2 on T+2
                "can_sell": False,
                "t1_lock_text": f"T+0 当日买入锁仓 (下一交易日可卖)",
                "sell_available_date": get_next_trade_day(effective_date) if effective_date else "",
                "high_price": execution_price,
                "current_price": execution_price,
                "change_pct": round(((execution_price - prev_close) / prev_close) * 100.0, 2),
                "pullback_pct": 0.0,
                "turnover_rate": turnover,
                "seal_ratio": seal_rat,
                "trailing_stop_price": round(execution_price * (1.0 - TRAILING_STOP_PCT), 2),
                "status_tag": "NORMAL",
                "market_value": gross_amount,
                "unrealized_pnl": -friction_cost,
                "unrealized_pnl_pct": round((-BUY_FRICTION_RATE) * 100, 2),
                "anti_shakeout_count": 0,  # Consecutive minutes below stop line
                "hard_stop_price": round(execution_price * (1.0 + HARD_STOP_PCT), 2),
                "sector": cand.get("sector", "通用板块"),
                "entry_strategy": strategy,
                "entry_strategy_name": strategy_name,
            }
            state["holdings"].append(holding_entry)
            open_codes.add(code)

            # Opening entries use the auction execution time; intraday entries
            # use the actual live signal time for later strategy evaluation.
            exec_time_str = "09:30:00" if strategy == "OPENING" else _now_bj.strftime("%H:%M:%S")
            exec_time_tag = exec_time_str.replace(":", "")  # 093000

            order_record = {
                "order_id": f"BUY_{code}_{exec_time_tag}",
                "type": "BUY",
                "code": code,
                "name": name,
                "date": effective_date,
                "time": exec_time_str,
                "price": execution_price,
                "shares": shares,
                "amount": round(gross_amount, 2),
                "friction": round(friction_cost, 2),
                "strategy": strategy,
                "strategy_name": strategy_name,
                "reason": f"{strategy_name} · T+1 量化候选 (排名 {cand.get('rank', '-')}, 得分 {cand.get('quant_score', 0)} 分)"
            }
            state["trade_history"].insert(0, order_record)
            executed_orders.append(order_record)

            send_notification(
                f"🛒 模拟盘买入执行: {name}({code})",
                f"买入价格: ¥{execution_price:.2f}, 数量: {shares} 股, 金额: ¥{gross_amount:,.2f}, 扣除摩擦成本: ¥{friction_cost:.2f}"
            )

        self._recalculate_portfolio_totals(state)
        self.save_state(state)
        return executed_orders

    # -------------------------------------------------------------------------
    # 2. INTRADAY EXIT MONITOR (Trailing Take-Profit & Anti-Shakeout Stop)
    # -------------------------------------------------------------------------
    def monitor_intraday_exits(self, current_time_str: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Poll real quotes for active holdings, enrich watchlist metrics and evaluate:
        1. Trailing Stop: 2.5% pullback from highest price
        2. Anti-Shakeout Stop: -4.13% with 3-minute time & volume confirmation
        3. T+2 Close Forced Liquidation: Exit at 14:45 if not at limit-up
        """
        state = self.load_state()
        holdings = state.get("holdings", [])
        if not holdings:
            return []

        now = datetime.datetime.now()
        cur_time = current_time_str or now.strftime("%H:%M")
        
        # Batch fetch real-time prices
        codes = [h["code"] for h in holdings]
        quotes = data_fetcher.get_realtime_quotes(codes)
        
        exited_orders = []
        surviving_holdings = []

        for h in holdings:
            code = h["code"]
            name = h["name"]
            shares = h["shares"]
            entry_price = float(h["entry_price"])
            holding_days = int(h.get("holding_days", 0))
            
            q = quotes.get(code)
            if not q:
                # Quote fetch failed (network / source stall) — fall back to last
                # known cost/entry price so the UI still shows a number instead
                # of "null". We still append to surviving_holdings (unsold).
                cur_p_fallback = float(h.get("current_price") or h.get("cost_price") or entry_price)
                if not h.get("current_price"):
                    h["current_price"] = cur_p_fallback
                    h["market_value"] = round(shares * cur_p_fallback, 2)
                    h["unrealized_pnl"] = round((cur_p_fallback - float(h["cost_price"])) * shares, 2)
                    h["unrealized_pnl_pct"] = round(((cur_p_fallback - float(h["cost_price"])) / float(h["cost_price"])) * 100, 2)
                if not h.get("high_price"):
                    h["high_price"] = max(entry_price, h.get("current_price", entry_price))
                if not h.get("change_pct"):
                    h["change_pct"] = round(((h["current_price"] - entry_price) / entry_price) * 100, 2) if entry_price else 0.0
                if not h.get("turnover_rate"):
                    h["turnover_rate"] = 5.0
                if not h.get("seal_ratio"):
                    h["seal_ratio"] = 0.0
                if not h.get("pullback_pct"):
                    hp = h.get("high_price", h["current_price"])
                    h["pullback_pct"] = round(((hp - h["current_price"]) / hp * 100.0) if hp > 0 else 0.0, 2)
                if not h.get("trailing_stop_price"):
                    hp = h.get("high_price", h["current_price"])
                    h["trailing_stop_price"] = round(hp * (1.0 - TRAILING_STOP_PCT), 2)
                if not h.get("hard_stop_price"):
                    h["hard_stop_price"] = round(entry_price * (1.0 + HARD_STOP_PCT), 2)
                if not h.get("status_tag"):
                    h["status_tag"] = "NORMAL"
                surviving_holdings.append(h)
                h["quote_status"] = "STALE"
                h["quote_status_at"] = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                continue

            current_price_raw = q.get("price")
            h["quote_status"] = "LIVE"
            h["quote_status_at"] = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            current_price = float(current_price_raw) if current_price_raw not in (None, "") else float(h.get("current_price") or h.get("cost_price") or entry_price)
            if current_price <= 0:
                current_price = float(h.get("current_price") or h.get("cost_price") or entry_price)

            h_hi = h.get("high_price")
            h_hi_f = float(h_hi) if h_hi not in (None, "") else entry_price
            q_hi = q.get("high")
            q_hi_f = float(q_hi) if q_hi not in (None, "") else max(current_price, h_hi_f)
            high_price = max(h_hi_f, q_hi_f, current_price)
            h["high_price"] = high_price
            h["current_price"] = current_price
            h["market_value"] = round(shares * current_price, 2)
            h["unrealized_pnl"] = round((current_price - float(h["cost_price"])) * shares, 2)
            h["unrealized_pnl_pct"] = round(((current_price - float(h["cost_price"])) / float(h["cost_price"])) * 100, 2)
            
            # Enrich Real-Time Watchlist Metrics (封成比, 换手率, 涨跌幅, 回撤幅度)
            chg_raw = q.get("change_pct")
            change_pct = float(chg_raw) if chg_raw not in (None, "") else float(h.get("change_pct") or ((current_price - entry_price) / entry_price * 100 if entry_price else 0.0))
            tr_raw = q.get("turnover_rate")
            turnover_rate = float(tr_raw) if tr_raw not in (None, "") else float(h.get("turnover_rate") or 5.0)
            vl_raw = q.get("volume_lots")
            vol_lots = float(vl_raw) if vl_raw not in (None, "") else 10000.0
            b1_raw = q.get("buy1_vol")
            buy1_lots = float(b1_raw) if b1_raw not in (None, "") else 0.0
            seal_ratio = round((buy1_lots / vol_lots * 100.0), 2) if vol_lots > 0 else 0.0
            
            pullback_pct = ((high_price - current_price) / high_price * 100.0) if high_price > 0 else 0.0
            trailing_stop_line = round(high_price * (1.0 - TRAILING_STOP_PCT), 2)
            hard_stop_line = round(entry_price * (1.0 + HARD_STOP_PCT), 2)

            h["change_pct"] = round(change_pct, 2)
            h["turnover_rate"] = round(turnover_rate, 2)
            h["seal_ratio"] = seal_ratio
            h["pullback_pct"] = round(pullback_pct, 2)
            h["trailing_stop_price"] = trailing_stop_line
            h["hard_stop_price"] = hard_stop_line

            # Determine Health / Watch Status Tag
            if change_pct >= 9.8 and seal_ratio >= 3.0:
                h["status_tag"] = "LOCKED_ZT"  # 牢牢封死涨停
            elif pullback_pct >= 1.8 and high_price > entry_price * 1.015:
                h["status_tag"] = "TRAILING_WARN"  # 逼近移动止盈线
            elif (current_price - entry_price) / entry_price <= HARD_STOP_PCT:
                h["status_tag"] = "HARD_STOP_WARN"  # 触及防洗盘止损
            elif holding_days >= 2:
                h["status_tag"] = "T2_EXIT_PENDING"  # T+2 尾盘待平仓
            else:
                h["status_tag"] = "NORMAL"

            should_exit = False
            exit_reason = ""
            rule_type = "TRAILING_STOP"

            # Check A-share T+1 rule (cannot sell on T+0 buy day)
            if holding_days >= 1:
                # ---------------------------------------------------------
                # Rule 1: 移动止盈 (Trailing Stop - 2.5% Pullback from Peak)
                # ---------------------------------------------------------
                pullback_ratio = (high_price - current_price) / high_price if high_price > 0 else 0.0
                if high_price > entry_price * 1.015 and pullback_ratio >= TRAILING_STOP_PCT:
                    should_exit = True
                    rule_type = "TRAILING_STOP"
                    exit_reason = f"移动止盈触发 (自最高价 ¥{high_price:.2f} 回撤 {pullback_ratio * 100:.2f}% >= {TRAILING_STOP_PCT * 100:.1f}%)"

                # ---------------------------------------------------------
                # Rule 2: 防洗盘硬止损 (Anti-Shakeout Hard Stop at -4.13%)
                # ---------------------------------------------------------
                drop_from_entry = (current_price - entry_price) / entry_price
                if not should_exit and drop_from_entry <= HARD_STOP_PCT:
                    h["anti_shakeout_count"] = h.get("anti_shakeout_count", 0) + 1
                    
                    # Dual confirmation: Time window >= 3 mins OR Volume Ratio spike
                    vol_ratio = float(q.get("volume_ratio", 1.0))
                    vol_spike = vol_ratio >= ANTI_SHAKEOUT_VOLUME_RATIO
                    
                    if h["anti_shakeout_count"] >= ANTI_SHAKEOUT_TIME_WINDOW_MINS or vol_spike:
                        should_exit = True
                        rule_type = "HARD_STOP"
                        exit_reason = f"防洗盘硬止损触发 (跌幅 {drop_from_entry * 100:.2f}% 触及 {HARD_STOP_PCT * 100:.2f}% 且双重确认成立)"
                    else:
                        record_system_log("WARNING", "Portfolio", f"⚠️ 标的 [{name}({code})] 触及止损线 ({drop_from_entry * 100:.2f}%)，进入防洗盘确认状态 ({h['anti_shakeout_count']}/{ANTI_SHAKEOUT_TIME_WINDOW_MINS})")
                else:
                    if drop_from_entry > HARD_STOP_PCT:
                        h["anti_shakeout_count"] = 0  # Reset if recovered

                # ---------------------------------------------------------
                # Rule 3: T+2 尾盘强制平仓 (14:45 Close If Not at Limit-Up)
                # ---------------------------------------------------------
                if not should_exit and holding_days >= 2 and cur_time >= T2_FORCED_EXIT_TIME:
                    # If not locked at limit up
                    if change_pct < 9.8:
                        should_exit = True
                        rule_type = "T2_FORCED"
                        exit_reason = f"T+2 尾盘强制平仓 (持有达2日且 {T2_FORCED_EXIT_TIME} 未封死涨停，涨跌幅 {change_pct:+.2f}%)"

            # -------------------------------------------------------------
            # Execute Exit
            # -------------------------------------------------------------
            if should_exit:
                gross_amount = shares * current_price
                friction_cost = gross_amount * SELL_FRICTION_RATE
                net_proceeds = gross_amount - friction_cost
                
                realized_pnl = net_proceeds - (shares * float(h["cost_price"]))
                realized_pnl_pct = (realized_pnl / (shares * float(h["cost_price"]))) * 100.0

                state["cash"] += net_proceeds
                
                order_record = {
                    "order_id": f"SELL_{code}_{now.strftime('%H%M%S')}",
                    "type": "SELL",
                    "code": code,
                    "name": name,
                    "date": now.strftime("%Y-%m-%d"),
                    "time": now.strftime("%H:%M:%S"),
                    "price": current_price,
                    "shares": shares,
                    "amount": round(gross_amount, 2),
                    "friction": round(friction_cost, 2),
                    "realized_pnl": round(realized_pnl, 2),
                    "realized_pnl_pct": round(realized_pnl_pct, 2),
                    "holding_days": holding_days,
                    "rule_type": rule_type,
                    "reason": exit_reason
                }
                state["trade_history"].insert(0, order_record)
                exited_orders.append(order_record)

                # Append to recent sell alerts for instant UI popups
                if "recent_sell_alerts" not in state:
                    state["recent_sell_alerts"] = []
                
                alert_item = {
                    "alert_id": f"ALERT_{code}_{now.strftime('%H%M%S')}",
                    "code": code,
                    "name": name,
                    "time": now.strftime("%H:%M:%S"),
                    "date": now.strftime("%Y-%m-%d"),
                    "sell_price": current_price,
                    "shares": shares,
                    "entry_price": entry_price,
                    "realized_pnl": round(realized_pnl, 2),
                    "realized_pnl_pct": round(realized_pnl_pct, 2),
                    "rule_type": rule_type,
                    "reason": exit_reason,
                    "details": {
                        "high_price": high_price,
                        "pullback_pct": round(pullback_pct, 2),
                        "stop_price": hard_stop_line,
                        "holding_days": holding_days
                    }
                }
                state["recent_sell_alerts"].insert(0, alert_item)
                # Keep up to 20 recent alerts
                state["recent_sell_alerts"] = state["recent_sell_alerts"][:20]

                send_notification(
                    f"📤 模拟盘平仓执行: {name}({code})",
                    f"{exit_reason}\n卖出价格: ¥{current_price:.2f}, 盈亏: {'+' if realized_pnl >= 0 else ''}¥{realized_pnl:,.2f} ({realized_pnl_pct:+.2f}%)"
                )
            else:
                surviving_holdings.append(h)

        state["holdings"] = surviving_holdings
        self._recalculate_portfolio_totals(state)
        self.save_state(state)
        return exited_orders

    def manual_sell_position(self, code: str, reason: str = "用户手动盘中平仓") -> Optional[Dict[str, Any]]:
        """Manually liquidate an active position at current quote."""
        state = self.load_state()
        holdings = state.get("holdings", [])
        target_pos = None
        surviving = []
        
        for h in holdings:
            if h["code"] == code:
                target_pos = h
            else:
                surviving.append(h)
                
        if not target_pos:
            return None

        # Fetch current price
        quotes = data_fetcher.get_realtime_quotes([code])
        q = quotes.get(code, {})
        current_price = float(q.get("price", target_pos["current_price"]))
        if current_price <= 0:
            current_price = target_pos["current_price"]
            
        shares = target_pos["shares"]
        gross_amount = shares * current_price
        friction_cost = gross_amount * SELL_FRICTION_RATE
        net_proceeds = gross_amount - friction_cost
        
        realized_pnl = net_proceeds - (shares * float(target_pos["cost_price"]))
        realized_pnl_pct = (realized_pnl / (shares * float(target_pos["cost_price"]))) * 100.0

        state["cash"] += net_proceeds
        now = datetime.datetime.now()
        
        order_record = {
            "order_id": f"SELL_{code}_{now.strftime('%H%M%S')}",
            "type": "SELL",
            "code": code,
            "name": target_pos["name"],
            "date": now.strftime("%Y-%m-%d"),
            "time": now.strftime("%H:%M:%S"),
            "price": current_price,
            "shares": shares,
            "amount": round(gross_amount, 2),
            "friction": round(friction_cost, 2),
            "realized_pnl": round(realized_pnl, 2),
            "realized_pnl_pct": round(realized_pnl_pct, 2),
            "holding_days": target_pos.get("holding_days", 0),
            "rule_type": "MANUAL",
            "reason": reason
        }
        state["trade_history"].insert(0, order_record)
        state["holdings"] = surviving
        
        if "recent_sell_alerts" not in state:
            state["recent_sell_alerts"] = []
        alert_item = {
            "alert_id": f"ALERT_{code}_{now.strftime('%H%M%S')}",
            "code": code,
            "name": target_pos["name"],
            "time": now.strftime("%H:%M:%S"),
            "date": now.strftime("%Y-%m-%d"),
            "sell_price": current_price,
            "shares": shares,
            "entry_price": target_pos["entry_price"],
            "realized_pnl": round(realized_pnl, 2),
            "realized_pnl_pct": round(realized_pnl_pct, 2),
            "rule_type": "MANUAL",
            "reason": reason,
            "details": {
                "high_price": target_pos.get("high_price", current_price),
                "pullback_pct": 0.0,
                "stop_price": target_pos.get("hard_stop_price", 0.0),
                "holding_days": target_pos.get("holding_days", 0)
            }
        }
        state["recent_sell_alerts"].insert(0, alert_item)
        state["recent_sell_alerts"] = state["recent_sell_alerts"][:20]

        self._recalculate_portfolio_totals(state)
        self.save_state(state)
        return order_record

    def auto_sync_and_trade(self, trade_date: Optional[str] = None, watchlist_only: bool = False) -> Dict[str, Any]:
        """
        Default auto-trading routine called on system entry and heartbeat ticks.

        Parameters
        ----------
        trade_date : str or None
            Effective trade date (falls back to data_fetcher effective date).
        watchlist_only : bool, default False
            If True, perform ONLY watchlist monitoring for the currently-held
            positions (intraday exits + quote refresh). We explicitly skip
            execute_t1_buys(), which reads candidates, pulls index/candidate
            quotes, and evaluates buy filters — none of that is needed on a
            mid-day heartbeat when the user only wants their existing holdings
            monitored in real time. Purchases happen in a narrow 09:28-09:50
            window anyway, and the function still refuses buys outside that
            slot, but skipping the call entirely saves ~100ms per tick.

        Behavior split
        --------------
        watchlist_only=True (heartbeat / 6s tick when holdings>0):
            1. Monitor exits for active holdings.
            2. Enrich remaining holdings with live quote snapshot.
            3. Recalculate totals and persist.

        watchlist_only=False (manual sync / scheduler morning buy job):
            Same as above, plus attempt execute_t1_buys for opening fills.
            Intended for the 09:30 opening call where we actually want to
            deploy new cash against the T-1 15:30 candidate/sentiment cache.
        """
        effective_date = data_fetcher.get_effective_date(trade_date)
        state = self.load_state()
        
        # 1. First monitor exits for any active holdings
        exits = self.monitor_intraday_exits()
        _ = exits  # exits are already persisted inside monitor_intraday_exits()
        
        # 2. Check if we have room to buy the ranked candidate set automatically
        #    - watchlist_only mode: never try buys (mid-day heartbeats).
        #    - otherwise: only the 09:28-09:50 window inside execute_t1_buys
        #      itself will actually perform buys; rest of day is a no-op.
        if not watchlist_only:
            session = data_fetcher.get_market_session_status()
            is_trading = session.get("is_trading_active", False)

            current_holdings = state.get("holdings", [])
            if is_trading and len(current_holdings) < MAX_POSITIONS and state.get("cash", 0) >= 20000.0:
                buys = self.execute_t1_buys(effective_date)
                if buys and state.get("current_step") == "WAITING_NEXT_OPEN":
                    state["current_step"] = "INTRADAY_WATCHLIST"
                    state["current_step_name"] = "盘中盯盘池 (T+0 锁仓)"
                    self.save_state(state)
            else:
                buys = []
            _ = buys

        # 3. Enrich remaining active holdings with live quote snapshot
        updated_state = self.load_state()
        holdings = updated_state.get("holdings", [])
        if holdings:
            codes = [h["code"] for h in holdings]
            quotes = data_fetcher.get_realtime_quotes(codes)
            for h in holdings:
                entry_price_h = float(h.get("entry_price") or h.get("cost_price") or 0)
                shares_h = int(h.get("shares") or 0)
                q = quotes.get(h["code"])

                # ---- Fallback price: quote.price > existing current_price > cost_price > entry_price
                fallback_price = float(h.get("current_price") or h.get("cost_price") or entry_price_h)
                if q:
                    pr_raw = q.get("price")
                    curr_p = float(pr_raw) if pr_raw not in (None, "") else fallback_price
                    if curr_p <= 0:
                        curr_p = fallback_price
                else:
                    curr_p = fallback_price
                # GUARANTEE h["current_price"] never stays None (fixes "现价为空" on UI)
                if curr_p > 0:
                    h["current_price"] = curr_p
                else:
                    h["current_price"] = fallback_price

                # ---- high_price: h.high_price > q.high > curr_p (no None crashes)
                h_hi_r = h.get("high_price")
                h_hi_f = float(h_hi_r) if h_hi_r not in (None, "") else max(entry_price_h, curr_p)
                q_hi_f = entry_price_h
                if q:
                    q_hi_r = q.get("high")
                    if q_hi_r not in (None, ""):
                        try:
                            q_hi_f = float(q_hi_r)
                        except (TypeError, ValueError):
                            q_hi_f = max(curr_p, h_hi_f)
                    else:
                        q_hi_f = max(curr_p, h_hi_f)
                else:
                    q_hi_f = max(curr_p, h_hi_f)
                h["high_price"] = max(h_hi_f, q_hi_f, curr_p)

                h["market_value"] = round(shares_h * h["current_price"], 2)
                h["unrealized_pnl"] = round((h["current_price"] - float(h["cost_price"])) * shares_h, 2)
                h["unrealized_pnl_pct"] = round(((h["current_price"] - float(h["cost_price"])) / float(h["cost_price"])) * 100, 2) if h.get("cost_price") else 0.0

                # ---- watchlist metrics
                chg_pct_f = 0.0
                turnover_f = 5.0
                vol_lots_f = 10000.0
                buy1_lots_f = 0.0
                if q:
                    cr = q.get("change_pct")
                    chg_pct_f = float(cr) if cr not in (None, "") else float(h.get("change_pct") or ((h["current_price"] - entry_price_h) / entry_price_h * 100 if entry_price_h else 0.0))
                    tr = q.get("turnover_rate")
                    turnover_f = float(tr) if tr not in (None, "") else float(h.get("turnover_rate") or 5.0)
                    vl = q.get("volume_lots")
                    vol_lots_f = float(vl) if vl not in (None, "") else 10000.0
                    b1 = q.get("buy1_vol")
                    buy1_lots_f = float(b1) if b1 not in (None, "") else 0.0
                else:
                    chg_pct_f = float(h.get("change_pct") or ((h["current_price"] - entry_price_h) / entry_price_h * 100 if entry_price_h else 0.0))
                    turnover_f = float(h.get("turnover_rate") or 5.0)
                    vol_lots_f = 10000.0
                    buy1_lots_f = 0.0

                seal_rat = round((buy1_lots_f / vol_lots_f * 100.0), 2) if vol_lots_f > 0 else 0.0
                pullback = ((h["high_price"] - h["current_price"]) / h["high_price"] * 100.0) if h["high_price"] > 0 else 0.0

                h["change_pct"] = round(chg_pct_f, 2)
                h["turnover_rate"] = round(turnover_f, 2)
                h["seal_ratio"] = seal_rat
                h["pullback_pct"] = round(pullback, 2)
                h["trailing_stop_price"] = round(h["high_price"] * (1.0 - TRAILING_STOP_PCT), 2)
                h["hard_stop_price"] = round(entry_price_h * (1.0 + HARD_STOP_PCT), 2)

                # Update status tag
                if chg_pct_f >= 9.8 and seal_rat >= 3.0:
                    h["status_tag"] = "LOCKED_ZT"
                elif pullback >= 1.8 and h["high_price"] > entry_price_h * 1.015:
                    h["status_tag"] = "TRAILING_WARN"
                elif entry_price_h > 0 and (h["current_price"] - entry_price_h) / entry_price_h <= HARD_STOP_PCT:
                    h["status_tag"] = "HARD_STOP_WARN"
                elif int(h.get("holding_days", 0)) >= 2:
                    h["status_tag"] = "T2_EXIT_PENDING"
                else:
                    h["status_tag"] = "NORMAL"

            self._recalculate_portfolio_totals(updated_state)
            self.save_state(updated_state)

        return updated_state

    # -------------------------------------------------------------------------
    # 3. DAILY SETTLEMENT & NAV CURVE UPDATE (15:02)
    # -------------------------------------------------------------------------
    def settle_daily_nav(self, trade_date: Optional[str] = None) -> Dict[str, Any]:
        """
        Post-market daily settlement:
        - Increment holding_days for surviving positions (T+0 -> T+1, T+1 -> T+2)
        - Compute final market value, portfolio NAV, and daily PnL
        - Append to nav_history time series
        """
        effective_date = data_fetcher.get_effective_date(trade_date)
        state = self.load_state()

        # Fetch latest closing prices for all active holdings
        holdings = state.get("holdings", [])
        if holdings:
            codes = [h["code"] for h in holdings]
            quotes = data_fetcher.get_realtime_quotes(codes)
            for h in holdings:
                q = quotes.get(h["code"])
                if q:
                    close_price = float(q.get("price", h["current_price"]))
                    h["current_price"] = close_price
                    h["high_price"] = max(float(h.get("high_price", close_price)), float(q.get("high", close_price)))
                    h["market_value"] = round(h["shares"] * close_price, 2)
                    h["unrealized_pnl"] = round((close_price - float(h["cost_price"])) * h["shares"], 2)
                    h["unrealized_pnl_pct"] = round(((close_price - float(h["cost_price"])) / float(h["cost_price"])) * 100, 2)
                # Increment holding day counter at close
                h["holding_days"] = h.get("holding_days", 0) + 1

        # Determine prior asset baseline for daily_pnl calculation
        nav_history = state.get("nav_history", [])
        prev_asset = float(state.get("initial_capital", INITIAL_CAPITAL))
        if nav_history:
            prior_entries = [n for n in nav_history if n.get("date") != effective_date]
            if prior_entries:
                prev_asset = float(prior_entries[-1].get("total_asset", prev_asset))

        self._recalculate_portfolio_totals(state)
        state["daily_pnl"] = round(state["total_asset"] - prev_asset, 2)

        # Update NAV history
        nav_entry = {
            "date": effective_date,
            "total_asset": round(state["total_asset"], 2),
            "nav": round(state["nav"], 4),
            "cash": round(state["cash"], 2),
            "market_value": round(state["market_value"], 2)
        }

        # Check if date already exists in nav_history
        updated = False
        for idx, item in enumerate(nav_history):
            if item.get("date") == effective_date:
                nav_history[idx] = nav_entry
                updated = True
                break
        if not updated:
            nav_history.append(nav_entry)

        state["nav_history"] = nav_history
        self.save_state(state)

        record_system_log("INFO", "Portfolio", f"Daily settlement completed for {effective_date}. Total Asset: ¥{state['total_asset']:,.2f}, NAV: {state['nav']:.4f}, Daily PnL: ¥{state['daily_pnl']:,.2f}")
        return state

    def _recalculate_portfolio_totals(self, state: Dict[str, Any]) -> None:
        """Update total market value, total asset, net asset value (NAV), and PnL."""
        market_val = sum([h.get("market_value", 0.0) for h in state.get("holdings", [])])
        cash = float(state.get("cash", 0.0))
        init_cap = float(state.get("initial_capital", INITIAL_CAPITAL))

        total_asset = cash + market_val
        nav = total_asset / init_cap if init_cap > 0 else 1.0
        total_pnl = total_asset - init_cap

        state["market_value"] = round(market_val, 2)
        state["total_asset"] = round(total_asset, 2)
        state["nav"] = round(nav, 4)
        state["total_pnl"] = round(total_pnl, 2)


# Global singleton instance
portfolio_engine = PortfolioEngine()