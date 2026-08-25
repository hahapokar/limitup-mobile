"""
Daily Post-Market Deep Review, Consecutive Board Attribution, and Next-Day Candidate Pool.
Reads from real market data files (candidates, sentiment, limitup, portfolio) — NEVER fabricates
example stocks, fixed sentiment states, or mock performance numbers. If data is missing,
outputs None / empty arrays so the UI can render "—" instead of misleading fake values.
"""

import json
import logging
import datetime
from pathlib import Path
from typing import Dict, Any, List, Optional

from quant_system.config import DATA_DIR, CANDIDATES_SELECT_COUNT
from quant_system.utils.notifier import record_system_log
from quant_system.core.data_fetcher import data_fetcher

logger = logging.getLogger("QuantTrading.ReviewAttribution")
REVIEW_ATTRIBUTION_FILE = DATA_DIR / "review_attribution_latest.json"


def _load_json(path: Path) -> Optional[Any]:
    if not path.exists():
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        logger.warning(f"Failed to load {path}: {e}")
        return None


def _pct(value: Any) -> Optional[float]:
    """Convert a proportion (e.g. 0.15) to percentage (15.0), keeping None as None."""
    if value is None:
        return None
    try:
        return round(float(value) * 100, 2)
    except (TypeError, ValueError):
        return None


class ReviewAttributionEngine:
    """
    Handles Daily Post-Market Deep Review, Attribution Analysis, and Next-Day Candidate Generation.
    All content is derived from real data files under DATA_DIR. No hard-coded tickers / mock data.
    """

    def _resolve_trade_date(self, session: Dict[str, Any]) -> str:
        return session.get("latest_trade_date") or session.get("trade_date") or ""

    def generate_review_and_attribution(self) -> Dict[str, Any]:
        """
        Generate post-market evaluation payload from real data files.
        Falls back to None / empty list when data is unavailable — never prints fake examples.
        """
        session = data_fetcher.get_market_session_status()
        # DATA INTEGRITY: Never fall back to a hard-coded "2026-08-21".
        # If both session and cached files lack a trade_date, keep "" so
        # the output uses only latest_candidates.json / latest_sentiment.json
        # generic filenames and never points at a fabricated snapshot.
        latest_date: str = self._resolve_trade_date(session) or ""
        prev_date = session.get("prev_trade_date") or None
        next_date = session.get("next_trade_date") or None

        # Load real data files for latest_date
        candidates_data = _load_json(DATA_DIR / f"candidates_{latest_date}.json") if latest_date else None
        sentiment_data = _load_json(DATA_DIR / f"sentiment_{latest_date}.json") if latest_date else None
        portfolio = _load_json(DATA_DIR / "portfolio_state.json")

        # ---------- 1. Market summary (real sentiment counts, no hard-coded "退潮/弱势期" etc.) ----------
        market_summary: Dict[str, Any] = {}

        if sentiment_data:
            comps = sentiment_data.get("market_summary") or {}
            mkt_summ_cands = candidates_data.get("market_summary") if isinstance(candidates_data, dict) else None

            total_limit_up = (
                (mkt_summ_cands.get("limit_up_count") if mkt_summ_cands else None)
                or comps.get("limit_up_count")
                or (candidates_data.get("total_limit_up_count") if isinstance(candidates_data, dict) else None)
            )
            total_consecutive = None
            max_boards = None
            if isinstance(candidates_data, dict):
                scored = candidates_data.get("all_scored_stocks") or []
                if isinstance(scored, list) and scored:
                    consecutive_list = [s.get("consecutive_boards") for s in scored
                                        if isinstance(s, dict) and isinstance(s.get("consecutive_boards"), int)]
                    total_consecutive = sum(1 for b in consecutive_list if b and b >= 2) or None
                    max_boards = (max(consecutive_list) if consecutive_list else None) or None

            total_limit_up_count: Optional[int] = None
            if isinstance(total_limit_up, int):
                total_limit_up_count = total_limit_up
            elif isinstance(candidates_data, dict) and isinstance(candidates_data.get("total_limit_up_count"), int):
                total_limit_up_count = candidates_data.get("total_limit_up_count")

            broken_count = comps.get("broken_up_count")
            top4_hit_rate_text = None
            if isinstance(candidates_data, dict):
                passed = candidates_data.get("candidates_count")
                total = total_limit_up_count
                if isinstance(passed, int) and isinstance(total, int):
                    top4_hit_rate_text = (
                        f"{latest_date} 盘后优选 {passed} 只优质标的 "
                        f"(全市场共 {total} 只涨停，筛选通过率 {round(passed * 100.0 / total, 1)}%)"
                    )

            # Portfolio-level floating PnL comes from portfolio_state, not made up
            total_floating_pnl = None
            total_floating_pnl_pct = None
            if isinstance(portfolio, dict):
                holdings = portfolio.get("holdings") or []
                if isinstance(holdings, list) and holdings:
                    pnl_list = [h.get("floating_pnl") for h in holdings if isinstance(h, dict)]
                    pnl_values = [float(p) for p in pnl_list if isinstance(p, (int, float))]
                    if pnl_values:
                        total_floating_pnl = round(sum(pnl_values), 2)
                    cost_list = [h.get("buy_amount") for h in holdings if isinstance(h, dict)]
                    cost_values = [float(c) for c in cost_list if isinstance(c, (int, float)) and float(c) > 0]
                    if cost_values and pnl_values:
                        total_floating_pnl_pct = round(sum(pnl_values) * 100.0 / sum(cost_values), 2)

            market_summary = {
                "sentiment_state": sentiment_data.get("sentiment_state"),
                "sentiment_score": sentiment_data.get("sentiment_score"),
                "total_limit_up_count": total_limit_up_count,
                "consecutive_limit_up_count": total_consecutive,
                "max_consecutive_boards": max_boards,
                "total_limit_down_count": comps.get("limit_down_count"),
                "broken_up_count": broken_count,
                "advance_ratio": comps.get("activity_pct"),
                "up_count": comps.get("up_count"),
                "down_count": comps.get("down_count"),
                "top4_hit_rate": top4_hit_rate_text,
                "total_portfolio_floating_pnl": total_floating_pnl,
                "total_portfolio_floating_pnl_pct": total_floating_pnl_pct,
                "target_position_ratio": sentiment_data.get("target_position_ratio"),
            }

        # ---------- 2. Top candidates evaluations (from candidates + ALL scored data) ----------
        top4_evaluations: List[Dict[str, Any]] = []
        all_scored: List[Dict[str, Any]] = []
        top_candidates: List[Dict[str, Any]] = []
        if isinstance(candidates_data, dict):
            top_candidates = list(candidates_data.get("candidates") or [])
            all_scored = list(candidates_data.get("all_scored_stocks") or [])

        evaluated_stocks = top_candidates if top_candidates else (all_scored[:CANDIDATES_SELECT_COUNT] if all_scored else [])
        for idx, s in enumerate(evaluated_stocks):
            if not isinstance(s, dict):
                continue
            code = s.get("code")
            fb = s.get("factor_breakdown") or {}
            cb = fb.get("consecutive_board_sentiment") or {}
            ss = fb.get("seal_strength") or {}
            cs = fb.get("chip_structure") or {}
            sr = fb.get("sector_resonance") or {}

            analysis_parts: List[str] = []
            if isinstance(s.get("quant_score"), (int, float)):
                analysis_parts.append(f"综合量化打分 {s['quant_score']} (排第 {s.get('rank', idx + 1)} 名)。")
            if ss.get("first_seal_time"):
                analysis_parts.append(f"首次封板 {ss['first_seal_time']}。")
            if isinstance(cs.get("turnover_rate"), (int, float)):
                analysis_parts.append(f"换手率 {cs['turnover_rate']}%。")
            if isinstance(sr.get("sector_zt_count"), int) and isinstance(sr.get("sector_name"), str):
                analysis_parts.append(f"{sr['sector_name']} 板块内 {sr['sector_zt_count']} 家涨停共振。")
            if isinstance(cb.get("sentiment_state"), str):
                analysis_parts.append(f"情绪状态：{cb['sentiment_state']}。")

            top4_evaluations.append({
                "code": code,
                "name": s.get("name"),
                "review_rank": s.get("rank", idx + 1),
                "quant_score": s.get("quant_score"),
                "consecutive_boards": s.get("consecutive_boards"),
                "sector": s.get("sector"),
                "price": s.get("price"),
                "change_pct": s.get("change_pct"),
                "amount": s.get("amount"),
                "float_market_cap": s.get("float_market_cap"),
                "turnover_rate": s.get("turnover_rate"),
                "seal_amount": s.get("seal_amount"),
                "seal_ratio_pct": _pct(s.get("seal_ratio")),
                "first_seal_time": s.get("first_seal_time"),
                "last_seal_time": s.get("last_seal_time"),
                "broken_count": s.get("broken_count"),
                "institution_ratio_pct": _pct(s.get("institution_ratio")),
                "data_source": s.get("data_source"),
                "holding_status": (
                    next(
                        (
                            h.get("status") for h in (portfolio or {}).get("holdings", [])
                            if isinstance(h, dict) and h.get("code") == code
                        ),
                        None,
                    )
                    if isinstance(portfolio, dict) else None
                ),
                "evaluation_verdict": (
                    f"综合量化得分 {s.get('quant_score')} (排名 {s.get('rank', idx + 1)})"
                    if isinstance(s.get("quant_score"), (int, float)) else None
                ),
                "detailed_analysis": "".join(analysis_parts) if analysis_parts else None,
                "factor_breakdown": fb if fb else None,
            })

        # ---------- 3. Consecutive board rejection attribution (edge analysis on lower-ranked scored stocks) ----------
        consecutive_board_attributions: List[Dict[str, Any]] = []
        # Only analyse stocks ranked >=5 with enough factor detail
        if all_scored:
            for s in all_scored:
                if not isinstance(s, dict):
                    continue
                rank = s.get("rank")
                if not isinstance(rank, int) or rank <= CANDIDATES_SELECT_COUNT:
                    continue
                if len(consecutive_board_attributions) >= 5:
                    break
                fb = s.get("factor_breakdown") or {}
                breakdown: Dict[str, Any] = {}
                rejection_reasons: List[str] = []
                for factor_key, label_min in (
                    ("seal_strength", "封板强度"),
                    ("chip_structure", "筹码结构"),
                    ("sector_resonance", "板块共振"),
                    ("consecutive_board_sentiment", "连板阶梯"),
                ):
                    f = fb.get(factor_key) or {}
                    if not isinstance(f, dict):
                        continue
                    score = f.get("score")
                    if isinstance(score, (int, float)) and score < 60:
                        breakdown[factor_key] = {
                            "score": round(float(score), 1),
                            "weight": f.get("weight"),
                            "details": {k: v for k, v in f.items() if k not in ("score", "weight", "weighted_score")},
                        }
                        rejection_reasons.append(f"{label_min}得分仅 {round(float(score), 1)} (低于60门槛)")

                why_text: Optional[str] = None
                if rejection_reasons:
                    why_text = (
                        f"{s.get('name', s.get('code'))} 综合得分 {s.get('quant_score')} (排第 {rank} 名)，"
                        f"主要扣分点：{'；'.join(rejection_reasons)}。"
                    )
                consecutive_board_attributions.append({
                    "code": s.get("code"),
                    "name": s.get("name"),
                    "sector": s.get("sector"),
                    "quant_score": s.get("quant_score"),
                    "rank": rank,
                    "consecutive_boards": s.get("consecutive_boards"),
                    "change_pct": s.get("change_pct"),
                    "factor_rejection_breakdown": breakdown or None,
                    "why_not_in_topN": why_text,
                })

        # ---------- 4. Recommended candidates for the NEXT trading day ----------
        recommended_candidates: List[Dict[str, Any]] = []
        for idx, s in enumerate(evaluated_stocks):
            if not isinstance(s, dict):
                continue
            fb = s.get("factor_breakdown") or {}
            ss = fb.get("seal_strength") or {}
            reason_parts: List[str] = []
            if isinstance(s.get("quant_score"), (int, float)):
                reason_parts.append(f"综合量化得分 {s['quant_score']} (排第 {s.get('rank', idx + 1)} 名)。")
            if ss.get("first_seal_time"):
                reason_parts.append(f"首次封板 {ss['first_seal_time']}。")
            if isinstance(s.get("sector"), str):
                reason_parts.append(f"所属板块：{s['sector']}。")

            recommended_candidates.append({
                "code": s.get("code"),
                "name": s.get("name"),
                "price": s.get("price"),
                "change_pct": s.get("change_pct"),
                "consecutive_boards": s.get("consecutive_boards"),
                "sector": s.get("sector"),
                "quant_score": s.get("quant_score"),
                "turnover_rate": s.get("turnover_rate"),
                "seal_ratio_pct": _pct(s.get("seal_ratio")),
                "first_seal_time": s.get("first_seal_time"),
                "recommend_reason": "".join(reason_parts) if reason_parts else None,
                "operation_guide": None,  # left to execution engine / trader discretion
            })

        # ==========================================================
        # NEW SECTION: T-1 (prev_date) candidates -> T (latest_date)
        # Deep Review + Loss Attribution + Consecutive-Board Success
        # + T+1 Next-Day Prediction
        # ----------------------------------------------------------
        # Strict T-1 alignment (per ExperienceRecall #1008354):
        # We NEVER explain T-1 selection decisions using T-day data.
        # The T-1 factor breakdowns come from candidates_{prev_date}.json.
        # T-day facts (actual PnL, limit-up status, factor deterioration)
        # come only from candidates_{latest_date}.json / limitup_{latest_date}.json
        # / portfolio_state.json (sell logs).
        # ==========================================================
        prev_candidates_data = _load_json(DATA_DIR / f"candidates_{prev_date}.json") if prev_date else None
        today_limitup_list = _load_json(DATA_DIR / f"limitup_{latest_date}.json") if latest_date else None
        today_sentiment_data = sentiment_data
        prev_day_candidates_review = self._build_prev_day_candidates_review(
            prev_date, latest_date, prev_candidates_data, candidates_data, today_limitup_list, portfolio
        )
        closed_positions_attribution = self._build_closed_positions_attribution(
            latest_date, portfolio, prev_candidates_data, candidates_data
        )
        consecutive_board_success = self._build_consecutive_board_success(
            prev_candidates_data, candidates_data
        )
        next_day_prediction = self._build_next_day_prediction(
            today_sentiment_data, candidates_data, market_summary
        )

        payload = {
            "review_date": latest_date,
            "prev_trade_date": prev_date,
            "next_trade_date": next_date,
            "review_time": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "market_summary": market_summary or {
                "sentiment_state": None,
                "sentiment_score": None,
                "total_limit_up_count": None,
            },
            # ---- new deep-review sections ----
            "prev_day_candidates_review": prev_day_candidates_review,
            "closed_positions_attribution": closed_positions_attribution,
            "consecutive_board_success_analysis": consecutive_board_success,
            "next_day_prediction": next_day_prediction,
            # ---- legacy (preserved for server.ts / existing UI) ----
            "top_candidate_evaluations": top4_evaluations,
            "lower_ranked_attributions": consecutive_board_attributions,
            "next_day_recommended_candidates": recommended_candidates,
            "aug21_top4_evaluations": top4_evaluations,
            "aug24_consecutive_board_attributions": consecutive_board_attributions,
            "aug25_recommended_candidates": recommended_candidates,
        }

        try:
            with open(REVIEW_ATTRIBUTION_FILE, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False, indent=2)
            record_system_log("INFO", "ReviewAttribution", f"{latest_date} post-market review generated from real data files")
        except Exception as e:
            logger.error(f"Error saving review attribution file: {e}")

        return payload

    # -----------------------------------------------------------------
    # Helpers: T-1 candidates review, closed positions attribution,
    # consecutive-board success analysis, T+1 prediction
    # -----------------------------------------------------------------
    @staticmethod
    def _find_stock(list_or_obj: Any, code: str) -> Optional[Dict[str, Any]]:
        if isinstance(list_or_obj, list):
            for s in list_or_obj:
                if isinstance(s, dict) and s.get("code") == code:
                    return s
        elif isinstance(list_or_obj, dict):
            for key in ("candidates", "all_scored_stocks"):
                arr = list_or_obj.get(key)
                if isinstance(arr, list):
                    for s in arr:
                        if isinstance(s, dict) and s.get("code") == code:
                            return s
        return None

    def _build_prev_day_candidates_review(
        self,
        prev_date: Optional[str],
        today_date: str,
        prev_candidates: Optional[Dict[str, Any]],
        today_candidates: Optional[Dict[str, Any]],
        today_limitup: Optional[Any],
        portfolio: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """
        For every stock picked on T-1 (prev_date), evaluate what happened on T
        (today_date): actual PnL, whether it limit-up again (consecutive
        board), whether it remained in the top candidates, etc.

        T-1 factor breakdowns are read ONLY from candidates_{prev_date}.json
        (never retroactively explained via T-day data).
        """
        rows: List[Dict[str, Any]] = []
        review_candidates: List[Dict[str, Any]] = []
        # 1) Portfolio DEMO_BUY / BUY entries for prev_date take precedence — these
        #    are the stocks the model actually "bought" for the user on prev_date.
        # Dedupe within portfolio buys by code (keep the first non-empty reason/price entry).
        portfolio_buys_by_code: Dict[str, Dict[str, Any]] = {}
        if isinstance(portfolio, dict):
            buys = [t for t in (portfolio.get("trade_history") or [])
                    if isinstance(t, dict) and t.get("type") == "BUY" and t.get("date") == prev_date]
            for b in buys:
                code = b.get("code")
                if not code:
                    continue
                if code in portfolio_buys_by_code:
                    existing = portfolio_buys_by_code[code]
                    # Prefer non-null values from later entries
                    for k in ("price", "cost_price", "reason", "name"):
                        if existing.get(k) is None and b.get(k) is not None:
                            existing[k] = b.get(k)
                else:
                    portfolio_buys_by_code[code] = dict(b)
        for code, b in portfolio_buys_by_code.items():
            stock = self._find_stock(prev_candidates, code) if prev_candidates else None
            review_candidates.append({
                "code": code,
                "name": b.get("name") or (stock or {}).get("name"),
                "sector": (stock or {}).get("sector"),
                "prev_day_quant_score": None,  # will fill below
                "prev_day_rank": None,
                "prev_day_factor_breakdown": None,
                "prev_day_consecutive_boards": (stock or {}).get("consecutive_boards"),
                "prev_day_close_price": (stock or {}).get("price"),
                "buy_price": b.get("price") or b.get("cost_price"),
                "buy_reason": b.get("reason"),
                "from_portfolio_buy": True,
            })
        # 2) Fallback: supplement with candidates_{prev_date}.json TOP N (dedupe by code)
        seen_codes: set = {r.get("code") for r in review_candidates if r.get("code")}
        if isinstance(prev_candidates, dict):
            cands = prev_candidates.get("candidates") or []
            if isinstance(cands, list) and cands:
                for s in cands[:CANDIDATES_SELECT_COUNT]:
                    if not isinstance(s, dict):
                        continue
                    code = s.get("code")
                    if code in seen_codes:
                        continue
                    seen_codes.add(code)
                    review_candidates.append({
                        "code": code,
                        "name": s.get("name"),
                        "sector": s.get("sector"),
                        "prev_day_quant_score": None,
                        "prev_day_rank": None,
                        "prev_day_factor_breakdown": None,
                        "prev_day_consecutive_boards": s.get("consecutive_boards"),
                        "prev_day_close_price": s.get("price"),
                        "buy_price": None,
                        "buy_reason": (
                            f"{prev_date} TOP{s.get('rank','?')} 候选 (量化{s.get('quant_score','?')}分)，未进入实际建仓记录，仅用于候选表现复盘"
                            if s.get("quant_score") else None
                        ),
                        "from_portfolio_buy": False,
                    })

        # Fill in T-1 factor breakdowns from candidates_{prev_date}.json (strict T-1 alignment)
        for row in review_candidates:
            code = row["code"]
            stock = self._find_stock(prev_candidates, code) if prev_candidates else None
            if stock:
                row["prev_day_quant_score"] = stock.get("quant_score")
                row["prev_day_rank"] = stock.get("rank")
                row["prev_day_factor_breakdown"] = stock.get("factor_breakdown")
                if row["prev_day_close_price"] is None:
                    row["prev_day_close_price"] = stock.get("price")
                if row["prev_day_consecutive_boards"] is None:
                    row["prev_day_consecutive_boards"] = stock.get("consecutive_boards")
                if row.get("sector") is None:
                    row["sector"] = stock.get("sector")
                if row.get("name") is None:
                    row["name"] = stock.get("name")

            # T-day facts only (never read these from prev_date)
            today_stock = self._find_stock(today_candidates, code) if today_candidates else None
            today_limitup_stock = self._find_stock(today_limitup, code) if today_limitup else None
            today_price = None
            today_change_pct = None
            today_consecutive_boards = None
            today_rank = None
            today_seal_ratio = None
            today_turnover = None
            today_broken_count = None
            today_first_seal_time = None
            today_factor_breakdown = None
            for src in (today_stock, today_limitup_stock):
                if not isinstance(src, dict):
                    continue
                if today_price is None and isinstance(src.get("price"), (int, float)):
                    today_price = src.get("price")
                if today_change_pct is None and isinstance(src.get("change_pct"), (int, float)):
                    today_change_pct = src.get("change_pct")
                if today_consecutive_boards is None and isinstance(src.get("consecutive_boards"), int):
                    today_consecutive_boards = src.get("consecutive_boards")
                if today_seal_ratio is None and isinstance(src.get("seal_ratio"), (int, float)):
                    today_seal_ratio = src.get("seal_ratio")
                if today_turnover is None and isinstance(src.get("turnover_rate"), (int, float)):
                    today_turnover = src.get("turnover_rate")
                if today_broken_count is None and isinstance(src.get("broken_count"), int):
                    today_broken_count = src.get("broken_count")
                if today_first_seal_time is None and src.get("first_seal_time"):
                    today_first_seal_time = src.get("first_seal_time")
            if isinstance(today_stock, dict):
                today_rank = today_stock.get("rank")
                today_factor_breakdown = today_stock.get("factor_breakdown")

            # Holding / PnL from portfolio
            holding = None
            exit_logs: List[Dict[str, Any]] = []
            if isinstance(portfolio, dict):
                holding = next((h for h in (portfolio.get("holdings") or [])
                               if isinstance(h, dict) and h.get("code") == code), None)
                for sell in (portfolio.get("recent_sell_alerts") or []):
                    if isinstance(sell, dict) and sell.get("code") == code and sell.get("date") in (today_date, prev_date):
                        exit_logs.append(sell)
                for trade in (portfolio.get("trade_history") or []):
                    if (isinstance(trade, dict) and trade.get("type") == "SELL"
                            and trade.get("code") == code and trade.get("date") == today_date):
                        # Avoid double-counting recent_sell_alerts entries already appended
                        if not any(a.get("time") == trade.get("time") and a.get("sell_price") == trade.get("price")
                                   for a in exit_logs):
                            exit_logs.append({
                                "time": trade.get("time"),
                                "sell_price": trade.get("price"),
                                "realized_pnl": trade.get("realized_pnl"),
                                "realized_pnl_pct": trade.get("realized_pnl_pct"),
                                "rule_type": trade.get("rule_type"),
                                "reason": trade.get("reason"),
                                "details": trade.get("details") or {},
                            })

            # Calculate PnL
            pnl_pct: Optional[float] = None
            pnl_amount: Optional[float] = None
            outcome: Optional[str] = None
            if holding and isinstance(holding, dict):
                unrealized = holding.get("unrealized_pnl")
                unrealized_pct = holding.get("unrealized_pnl_pct")
                if isinstance(unrealized, (int, float)):
                    pnl_amount = round(float(unrealized), 2)
                if isinstance(unrealized_pct, (int, float)):
                    pnl_pct = round(float(unrealized_pct), 2)
            realized_list = [e for e in exit_logs if isinstance(e.get("realized_pnl"), (int, float))]
            if realized_list:
                r_total = sum(float(e["realized_pnl"]) for e in realized_list)
                # Weighted realized pct (rough, by sign)
                r_pct_total = 0.0
                r_pct_n = 0
                for e in realized_list:
                    if isinstance(e.get("realized_pnl_pct"), (int, float)):
                        r_pct_total += float(e["realized_pnl_pct"])
                        r_pct_n += 1
                realized_pnl_pct = round(r_pct_total / r_pct_n, 2) if r_pct_n else None
                if pnl_amount is None:
                    pnl_amount = round(r_total, 2)
                else:
                    pnl_amount = round(float(pnl_amount) + r_total, 2)
                if realized_pnl_pct is not None:
                    pnl_pct = realized_pnl_pct if pnl_pct is None else round((pnl_pct + realized_pnl_pct) / 2, 2)

            # Outcome classification
            prev_cb = row["prev_day_consecutive_boards"]
            today_cb = today_consecutive_boards
            if not row.get("from_portfolio_buy"):
                outcome = "WATCHLIST_ONLY"
            elif isinstance(prev_cb, int) and isinstance(today_cb, int) and today_cb > prev_cb:
                outcome = "SUCCESS_CONSECUTIVE_BOARD"
            elif today_limitup_stock or (isinstance(today_change_pct, (int, float)) and today_change_pct >= 9.5):
                outcome = "SUCCESS_LIMIT_UP" if outcome is None else outcome
            elif isinstance(pnl_pct, (int, float)) and pnl_pct < 0:
                outcome = "LOSS_EXIT"
            elif isinstance(today_change_pct, (int, float)) and today_change_pct < 3:
                outcome = "UNDERPERFORM_WEAK"
            else:
                outcome = "HOLDING_NORMAL"

            # PnL / Outcome summary text
            outcome_text_map = {
                "WATCHLIST_ONLY": "未建仓候选 / 仅作复盘",
                "SUCCESS_CONSECUTIVE_BOARD": "成功连板晋级",
                "SUCCESS_LIMIT_UP": "T 日再次涨停",
                "LOSS_EXIT": "止损/止盈亏损离场",
                "UNDERPERFORM_WEAK": "T 日表现偏弱（<3%）未涨停",
                "HOLDING_NORMAL": "仍持有中 / 正常波动",
            }
            outcome_cn = outcome_text_map.get(outcome or "HOLDING_NORMAL", outcome or "—")

            buy_price = row.get("buy_price")
            ref_price = today_price if today_price is not None else (row.get("prev_day_close_price") or buy_price)
            simple_pnl_pct: Optional[float] = None
            if row.get("from_portfolio_buy") and isinstance(buy_price, (int, float)) and float(buy_price) > 0 and isinstance(ref_price, (int, float)):
                simple_pnl_pct = round((float(ref_price) - float(buy_price)) * 100.0 / float(buy_price), 2)
            if row.get("from_portfolio_buy") and pnl_pct is None:
                pnl_pct = simple_pnl_pct

            row.update({
                "today_close_price": today_price,
                "today_change_pct": today_change_pct,
                "today_consecutive_boards": today_consecutive_boards,
                "today_rank_in_candidates": today_rank,
                "today_seal_ratio_pct": _pct(today_seal_ratio),
                "today_turnover_rate": today_turnover,
                "today_broken_count": today_broken_count,
                "today_first_seal_time": today_first_seal_time,
                "today_factor_breakdown": today_factor_breakdown,
                "pnl_amount": pnl_amount,
                "pnl_pct": pnl_pct,
                "outcome": outcome,
                "outcome_cn": outcome_cn,
                "still_holding": holding is not None,
                "exit_logs": exit_logs if exit_logs else None,
            })
            rows.append(row)

        # Summary stats
        n = len(rows)
        wins = sum(1 for r in rows if isinstance(r.get("pnl_pct"), (int, float)) and r["pnl_pct"] > 0)
        losses = sum(1 for r in rows if isinstance(r.get("pnl_pct"), (int, float)) and r["pnl_pct"] < 0)
        success_cb = sum(1 for r in rows if r.get("outcome") == "SUCCESS_CONSECUTIVE_BOARD")
        hit_rate = round(wins * 100.0 / n, 1) if n > 0 else None
        avg_pnl_pct: Optional[float] = None
        pnls = [float(r["pnl_pct"]) for r in rows if isinstance(r.get("pnl_pct"), (int, float))]
        if pnls:
            avg_pnl_pct = round(sum(pnls) / len(pnls), 2)

        return {
            "prev_trade_date": prev_date,
            "review_trade_date": today_date,
            "total_reviewed": n,
            "success_consecutive_board_count": success_cb,
            "win_count": wins,
            "loss_count": losses,
            "hit_rate_pct": hit_rate,
            "avg_pnl_pct": avg_pnl_pct,
            "items": rows,
        }

    def _build_closed_positions_attribution(
        self,
        today_date: str,
        portfolio: Optional[Dict[str, Any]],
        prev_candidates: Optional[Dict[str, Any]],
        today_candidates: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """
        For each stock SOLD on T-day (today_date) from the portfolio,
        build a structured attribution of *why* it under-performed,
        especially when it had scored high on T-1.

        Attribution rule order (root cause first):
          1. T-day seal broken many times (broken_count >= 2) → weak seal
          2. T-day seal_ratio < 0.1 (seal strength collapsed)
          3. T-day turnover rate surge > 15% (chip structure overheated)
          4. T-day consecutive_boards plateaued or fell (space leader exhaustion)
          5. T-day rank dropped outside TOP10 → no longer in candidates
          6. Sector resonance loss on T-day (sector_zt_count fell or no true_resonance)
        """
        items: List[Dict[str, Any]] = []
        if not isinstance(portfolio, dict):
            return {"attribution_date": today_date, "items": items}

        # Index T-day stocks by code for fast lookup
        today_by_code: Dict[str, Dict[str, Any]] = {}
        if isinstance(today_candidates, dict):
            for key in ("candidates", "all_scored_stocks"):
                arr = today_candidates.get(key) or []
                if isinstance(arr, list):
                    for s in arr:
                        if isinstance(s, dict) and s.get("code"):
                            today_by_code[s["code"]] = s
        prev_by_code: Dict[str, Dict[str, Any]] = {}
        if isinstance(prev_candidates, dict):
            for key in ("candidates", "all_scored_stocks"):
                arr = prev_candidates.get(key) or []
                if isinstance(arr, list):
                    for s in arr:
                        if isinstance(s, dict) and s.get("code"):
                            prev_by_code[s["code"]] = s

        exits: List[Dict[str, Any]] = []
        for a in (portfolio.get("recent_sell_alerts") or []):
            if isinstance(a, dict) and a.get("date") == today_date:
                exits.append(a)
        for trade in (portfolio.get("trade_history") or []):
            if (isinstance(trade, dict) and trade.get("type") == "SELL"
                    and trade.get("date") == today_date):
                if not any(e.get("time") == trade.get("time") and e.get("sell_price", trade.get("price")) == trade.get("price")
                           for e in exits):
                    exits.append({
                        "code": trade.get("code"),
                        "name": trade.get("name"),
                        "date": trade.get("date"),
                        "time": trade.get("time"),
                        "sell_price": trade.get("price"),
                        "realized_pnl": trade.get("realized_pnl"),
                        "realized_pnl_pct": trade.get("realized_pnl_pct"),
                        "rule_type": trade.get("rule_type"),
                        "reason": trade.get("reason"),
                        "details": trade.get("details") or {},
                    })

        for exit_obj in exits:
            code = exit_obj.get("code")
            if not code:
                continue
            prev = prev_by_code.get(code)
            today = today_by_code.get(code)
            prev_score = prev.get("quant_score") if prev else None
            prev_rank = prev.get("rank") if prev else None
            prev_fb = prev.get("factor_breakdown") if prev else None
            today_fb = today.get("factor_breakdown") if isinstance(today, dict) else None
            is_loss = isinstance(exit_obj.get("realized_pnl_pct"), (int, float)) and exit_obj["realized_pnl_pct"] < 0

            reasons: List[str] = []
            evidence: Dict[str, Any] = {}
            # ---- attribution root-cause chain ----
            broken = (today or {}).get("broken_count")
            if isinstance(broken, int) and broken >= 2:
                reasons.append(f"T 日封板被砸开 {broken} 次，资金接力意愿弱")
                evidence["broken_count"] = broken
            seal_ratio = (today or {}).get("seal_ratio") or (((today_fb or {}).get("seal_strength") or {}).get("seal_ratio"))
            if isinstance(seal_ratio, (int, float)) and seal_ratio < 0.1:
                reasons.append(f"T 日收盘封成比仅 {round(float(seal_ratio) * 100, 2)}%（<10% 门槛），封板强度坍塌")
                evidence["today_seal_ratio"] = seal_ratio
            turnover = (today or {}).get("turnover_rate")
            if isinstance(turnover, (int, float)) and turnover >= 15:
                reasons.append(f"T 日换手率飙升至 {turnover}%（≥15% 阈值），筹码结构过热兑现")
                evidence["today_turnover_rate"] = turnover
            prev_cb = (prev or {}).get("consecutive_boards")
            today_cb = (today or {}).get("consecutive_boards")
            if isinstance(prev_cb, int) and isinstance(today_cb, int) and today_cb <= prev_cb and today_cb >= 4:
                reasons.append(f"T-1 已 {prev_cb} 连板（高连板梯队），T 日连板空间耗尽（今日 {today_cb} 板见顶回落）")
                evidence["prev_consecutive_boards"] = prev_cb
                evidence["today_consecutive_boards"] = today_cb
            if today is None:
                reasons.append("T 日未能进入涨停池，已脱离连板接力候选池")
                evidence["today_in_limit_up_pool"] = False
            else:
                evidence["today_in_limit_up_pool"] = True
                t_rank = (today or {}).get("rank")
                if isinstance(t_rank, int) and t_rank > 10:
                    reasons.append(f"T 日在全市场量化排名跌至第 {t_rank} 名，已跌出 TOP10 观察池")
                    evidence["today_rank"] = t_rank
                # Sector resonance deterioration
                prev_sr = (prev_fb or {}).get("sector_resonance") or {}
                today_sr = (today_fb or {}).get("sector_resonance") or {}
                if (isinstance(prev_sr.get("sector_zt_count"), int)
                        and isinstance(today_sr.get("sector_zt_count"), int)
                        and today_sr["sector_zt_count"] < prev_sr["sector_zt_count"]):
                    reasons.append(
                        f"所属板块由 T-1 的 {prev_sr['sector_zt_count']} 家涨停共振，萎缩至 T 日仅 {today_sr['sector_zt_count']} 家，板块退潮"
                    )
                    evidence["prev_sector_zt_count"] = prev_sr["sector_zt_count"]
                    evidence["today_sector_zt_count"] = today_sr["sector_zt_count"]

            if prev_score is not None and is_loss and len(reasons) == 0:
                # No obvious structural deterioration — classify as normal rule-based exit
                reasons.append("T-1 综合量化打分高，但 T 日因盘中移动止盈/止损规则正常退出，结构性因子无明显恶化")

            items.append({
                "code": code,
                "name": exit_obj.get("name") or (prev or {}).get("name"),
                "sell_time": exit_obj.get("time"),
                "sell_price": exit_obj.get("sell_price"),
                "realized_pnl": exit_obj.get("realized_pnl"),
                "realized_pnl_pct": exit_obj.get("realized_pnl_pct"),
                "exit_rule_type": exit_obj.get("rule_type"),
                "exit_reason": exit_obj.get("reason"),
                "prev_day_quant_score": prev_score,
                "prev_day_rank": prev_rank,
                "prev_day_factor_breakdown_snapshot": prev_fb,
                "today_factor_breakdown_snapshot": today_fb,
                "is_loss_exit": is_loss,
                "evidence": evidence,
                "attribution_reasons": reasons,
                "attribution_summary": (
                    (
                        f"{'【亏损离场归因】' if is_loss else '【离场复盘】'}"
                        f"{exit_obj.get('name') or code}（T-1 得分 {prev_score if prev_score is not None else '—'}"
                        f"{' / 排名第 ' + str(prev_rank) if prev_rank is not None else ''}）"
                        f" → T 日 {exit_obj.get('time','')} 因 {exit_obj.get('rule_type','')} 以 ¥{exit_obj.get('sell_price')} 平仓"
                        f"（PnL {exit_obj.get('realized_pnl_pct') if isinstance(exit_obj.get('realized_pnl_pct'),(int,float)) else '—'}%）。"
                        f"{' 根因：'+'；'.join(reasons)+'。' if reasons else ''}"
                    ) if code else None
                ),
            })

        loss_count = sum(1 for it in items if it["is_loss_exit"])
        return {
            "attribution_date": today_date,
            "total_exits": len(items),
            "loss_exit_count": loss_count,
            "items": items,
        }

    def _build_consecutive_board_success(
        self,
        prev_candidates: Optional[Dict[str, Any]],
        today_candidates: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """
        For each stock in the T-1 candidate pool that SUCCESSFULLY advanced
        its consecutive-board count on T-day, detail T-day's 4-factor metrics.
        """
        items: List[Dict[str, Any]] = []
        prev_by_code: Dict[str, Dict[str, Any]] = {}
        if isinstance(prev_candidates, dict):
            for key in ("candidates", "all_scored_stocks"):
                arr = prev_candidates.get(key) or []
                if isinstance(arr, list):
                    for s in arr:
                        if isinstance(s, dict) and s.get("code"):
                            prev_by_code[s["code"]] = s
        today_by_code: Dict[str, Dict[str, Any]] = {}
        if isinstance(today_candidates, dict):
            for key in ("candidates", "all_scored_stocks"):
                arr = today_candidates.get(key) or []
                if isinstance(arr, list):
                    for s in arr:
                        if isinstance(s, dict) and s.get("code"):
                            today_by_code[s["code"]] = s

        for code, prev in prev_by_code.items():
            today = today_by_code.get(code)
            if not isinstance(today, dict):
                continue
            prev_cb = prev.get("consecutive_boards")
            today_cb = today.get("consecutive_boards")
            if not (isinstance(prev_cb, int) and isinstance(today_cb, int) and today_cb > prev_cb):
                continue
            fb = today.get("factor_breakdown") or {}
            cb = fb.get("consecutive_board_sentiment") or {}
            ss = fb.get("seal_strength") or {}
            cs = fb.get("chip_structure") or {}
            sr = fb.get("sector_resonance") or {}
            items.append({
                "code": code,
                "name": today.get("name") or prev.get("name"),
                "sector": today.get("sector") or prev.get("sector"),
                "prev_day_consecutive_boards": prev_cb,
                "today_consecutive_boards": today_cb,
                "board_advancement": f"{prev_cb} → {today_cb} 连板",
                "today_quant_score": today.get("quant_score"),
                "today_rank": today.get("rank"),
                "today_price": today.get("price"),
                "today_change_pct": today.get("change_pct"),
                "today_amount": today.get("amount"),
                "today_turnover_rate": today.get("turnover_rate"),
                "today_seal_ratio_pct": _pct(today.get("seal_ratio")),
                "today_first_seal_time": today.get("first_seal_time"),
                "today_last_seal_time": today.get("last_seal_time"),
                "today_broken_count": today.get("broken_count"),
                "today_institution_ratio_pct": _pct(today.get("institution_ratio")),
                "factor_scores_today": {
                    "consecutive_board_sentiment": cb.get("score"),
                    "seal_strength": ss.get("score"),
                    "chip_structure": cs.get("score"),
                    "sector_resonance": sr.get("score"),
                },
                "factor_details_today": {
                    "is_spatial_leader": cb.get("is_spatial_leader"),
                    "sentiment_adjustment": cb.get("sentiment_adjustment"),
                    "sentiment_state": cb.get("sentiment_state"),
                    "seal_ratio": ss.get("seal_ratio"),
                    "first_seal_time": ss.get("first_seal_time"),
                    "turnover_rate": cs.get("turnover_rate"),
                    "high_60d_breakout": cs.get("high_60d_breakout"),
                    "broken_count": cs.get("broken_count"),
                    "sector_name": sr.get("sector_name"),
                    "sector_zt_count": sr.get("sector_zt_count"),
                    "has_true_resonance": sr.get("has_true_resonance"),
                },
                "verdict": (
                    f"T-1 {prev_cb} 连板 → T 日 {today_cb} 连板成功晋级"
                    f"（今日量化得分 {today.get('quant_score') if today.get('quant_score') is not None else '—'}，"
                    f"排第 {today.get('rank') if today.get('rank') is not None else '—'} 名）"
                ),
            })

        items.sort(key=lambda x: (-(x.get("today_consecutive_boards") or 0), -(x.get("today_quant_score") or 0)))
        return {
            "total_success": len(items),
            "items": items,
        }

    def _build_next_day_prediction(
        self,
        today_sentiment: Optional[Dict[str, Any]],
        today_candidates: Optional[Dict[str, Any]],
        market_summary: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        For the T-day TOP4 candidates (the ones system will monitor on T+1
        morning), produce a T+1 directional prediction with confidence.

        Prediction rules (rules-based + data-driven, no ML fabrication):
          - BULLISH (strong):
              * sentiment_state == 主升/强势期  AND
              * consecutive_boards >= 3 AND
              * seal_strength >= 70 AND
              * chip_structure >= 70
          - BULLISH (moderate):
              * sentiment_state positive AND seal_strength >= 60 AND sector_resonance == true_resonance
          - NEUTRAL:
              * sentiment == 震荡/分化期  OR  broken_count >= 2  OR  turnover >= 18%
          - BEARISH:
              * seal_strength < 50 AND turnover >= 20% AND rank dropped from previous day
          - Confidence weighting:
              * >= 3 strong factors → HIGH (75-90%)
              * 2 strong factors → MEDIUM (55-70%)
              * 1 or zero → LOW (35-50%)
        """
        predictions: List[Dict[str, Any]] = []
        sentiment_state = today_sentiment.get("sentiment_state") if isinstance(today_sentiment, dict) else None
        sentiment_score = today_sentiment.get("sentiment_score") if isinstance(today_sentiment, dict) else None
        cands: List[Dict[str, Any]] = []
        if isinstance(today_candidates, dict):
            cands = list(today_candidates.get("candidates") or [])

        for idx, s in enumerate(cands):
            if not isinstance(s, dict):
                continue
            code = s.get("code")
            fb = s.get("factor_breakdown") or {}
            cb = fb.get("consecutive_board_sentiment") or {}
            ss = fb.get("seal_strength") or {}
            cs = fb.get("chip_structure") or {}
            sr = fb.get("sector_resonance") or {}

            cb_score = cb.get("score")
            ss_score = ss.get("score")
            cs_score = cs.get("score")
            sr_score = sr.get("score")
            consecutive = s.get("consecutive_boards")
            broken = s.get("broken_count")
            turnover = s.get("turnover_rate")
            seal_ratio = s.get("seal_ratio")
            has_true_resonance = sr.get("has_true_resonance")

            strong_factors = 0
            weak_factors = 0

            if isinstance(ss_score, (int, float)) and ss_score >= 70:
                strong_factors += 1
            elif isinstance(ss_score, (int, float)) and ss_score < 50:
                weak_factors += 1
            if isinstance(cs_score, (int, float)) and cs_score >= 70:
                strong_factors += 1
            elif isinstance(cs_score, (int, float)) and cs_score < 50:
                weak_factors += 1
            if isinstance(cb_score, (int, float)) and cb_score >= 80:
                strong_factors += 1
            if isinstance(sr_score, (int, float)) and sr_score >= 80 and has_true_resonance:
                strong_factors += 1
            if isinstance(broken, int) and broken >= 2:
                weak_factors += 1
            if isinstance(turnover, (int, float)) and turnover >= 18:
                weak_factors += 1
            if isinstance(consecutive, int) and consecutive >= 3:
                strong_factors += 1

            # Direction determination
            direction: str
            confidence_level: str
            confidence_pct: int
            operation_guide: str

            sentiment_is_strong = sentiment_state in ("主升/强势期", "启动/回暖期")
            sentiment_is_weak = sentiment_state in ("退潮/弱势期", "冰点/恐慌期")

            if (sentiment_is_strong and strong_factors >= 3 and weak_factors <= 1):
                direction = "偏强看涨"
                confidence_level = "HIGH"
                confidence_pct = min(90, 70 + strong_factors * 5 - weak_factors * 5)
                operation_guide = (
                    "T+1 若竞价高开 ≤3% 且承接有力（09:25 封单≥昨日封单 50%），"
                    "可视为超预期强连板持有；若竞价低开或盘中开板需盯紧移动止盈。"
                )
            elif (strong_factors >= 2 and weak_factors <= 1) or (sentiment_is_strong and strong_factors >= 2):
                direction = "谨慎看涨"
                confidence_level = "MEDIUM"
                confidence_pct = min(70, 55 + strong_factors * 5 - weak_factors * 3)
                operation_guide = (
                    "T+1 预期震荡分歧，以 3% 移动止盈 + 5% 硬止损双带持有；"
                    "若早盘冲高 ≥5% 但快速回落开板 → 视为弱转强失败，止盈优先。"
                )
            elif sentiment_is_weak or weak_factors >= 2:
                direction = "偏弱观望"
                confidence_level = "MEDIUM"
                confidence_pct = max(35, 55 - weak_factors * 8)
                operation_guide = (
                    "情绪偏弱或因子薄弱，不建议 T+1 开盘追入；若已有持仓则以开盘后 30 分钟不翻红为离场信号。"
                )
            else:
                direction = "震荡中性"
                confidence_level = "LOW"
                confidence_pct = 45
                operation_guide = (
                    "信号分歧，T+1 以持有观望为主；若连板 >3 且封板保持稳定可持有，否则逢高止盈。"
                )

            # Build key-drivers text
            drivers: List[str] = []
            if isinstance(consecutive, int) and consecutive >= 1:
                drivers.append(f"T 日 {consecutive} 连板")
            if isinstance(ss_score, (int, float)):
                drivers.append(f"封板强度 {round(ss_score,1)} 分（{'强' if ss_score >= 70 else ('中' if ss_score >= 50 else '弱')}）")
            if isinstance(cs_score, (int, float)):
                drivers.append(f"筹码结构 {round(cs_score,1)} 分")
            if isinstance(sr.get("sector_zt_count"), int):
                drivers.append(f"板块 {sr.get('sector_zt_count')} 家涨停共振")
            if isinstance(broken, int) and broken >= 1:
                drivers.append(f"T 日炸板 {broken} 次（风险）")
            if isinstance(turnover, (int, float)) and turnover >= 15:
                drivers.append(f"换手率 {turnover}%（偏高）")

            predictions.append({
                "code": code,
                "name": s.get("name"),
                "sector": s.get("sector"),
                "rank": s.get("rank", idx + 1),
                "today_quant_score": s.get("quant_score"),
                "today_consecutive_boards": consecutive,
                "today_close_price": s.get("price"),
                "today_change_pct": s.get("change_pct"),
                "direction": direction,
                "confidence_level": confidence_level,
                "confidence_pct": confidence_pct,
                "key_drivers": drivers,
                "today_factor_scores": {
                    "consecutive_board_sentiment": cb_score,
                    "seal_strength": ss_score,
                    "chip_structure": cs_score,
                    "sector_resonance": sr_score,
                },
                "risk_flags": {
                    "broken_count": broken if isinstance(broken, int) and broken >= 1 else None,
                    "high_turnover": turnover if isinstance(turnover, (int, float)) and turnover >= 18 else None,
                    "low_seal_ratio": seal_ratio if isinstance(seal_ratio, (int, float)) and seal_ratio < 0.1 else None,
                },
                "operation_guide": operation_guide,
                "prediction_summary": (
                    f"{s.get('name') or code} T+1 预测【{direction}】 (置信度 {confidence_pct}%)"
                    f"——关键因子: {'；'.join(drivers)}。操作建议: {operation_guide}"
                ),
            })

        # Market-level T+1 sentiment summary
        market_pred: Optional[str] = None
        if isinstance(sentiment_score, (int, float)):
            if sentiment_score >= 70:
                market_pred = "情绪进入主升/强势区，T+1 开盘整体预期偏强，关注高连板龙头（≥4 板）的连板延续性。"
            elif sentiment_score >= 50:
                market_pred = "情绪处于震荡/分化区，T+1 预期结构化行情，封板结构健康 + 板块共振的标的更容易延续。"
            elif sentiment_score >= 35:
                market_pred = "情绪偏弱区，T+1 宜防守 —— 优先规避 ≥5 连板高标见顶回落风险，关注首板/2 板补涨。"
            else:
                market_pred = "情绪接近冰点，T+1 无明显强势主线时不建议开新仓，已有持仓以逢高止盈为主。"

        return {
            "prediction_for_trade_date": market_summary.get("target_date") or "T+1（下一交易日）",
            "prevailing_sentiment_state": sentiment_state,
            "prevailing_sentiment_score": sentiment_score,
            "market_level_prediction": market_pred,
            "item_predictions": predictions,
        }

    def get_review_and_attribution(self) -> Dict[str, Any]:
        """Fetch existing review from disk or freshly generate from real data files."""
        if REVIEW_ATTRIBUTION_FILE.exists():
            try:
                with open(REVIEW_ATTRIBUTION_FILE, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                logger.warning(f"Error loading existing review attribution: {e}")
        return self.generate_review_and_attribution()

    # Compatibility aliases preserved for server.ts endpoints that call the old aug24 symbols
    generate_aug24_review_and_attribution = generate_review_and_attribution
    get_aug24_review_and_attribution = get_review_and_attribution


review_attribution_engine = ReviewAttributionEngine()
