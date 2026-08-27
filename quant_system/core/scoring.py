"""
Post-Market 4-Factor Quant Scoring & Stock Picking Model.
Applies Hard Exclusion Filters, calculates Percentile Ranks, and generates candidate list.
"""

import json
import logging
import datetime
from typing import List, Dict, Any, Optional, Tuple

try:
    import numpy as np
    HAS_NUMPY = True
except ImportError:
    np = None
    HAS_NUMPY = False

from quant_system.config import (
    FACTOR_WEIGHTS,
    EXCLUDE_ST,
    MIN_FLOAT_MARKET_CAP,
    MAX_FLOAT_MARKET_CAP,
    MAX_INSTITUTION_RATIO,
    MIN_PRICE,
    MAX_PRICE,
    CANDIDATES_SELECT_COUNT,
    DATA_DIR
)
from quant_system.core.data_fetcher import data_fetcher
from quant_system.utils.notifier import record_system_log, send_notification
from quant_system.core.sentiment import sentiment_engine

logger = logging.getLogger("QuantTrading.Scoring")


def compute_percentile_rank(values: List[Any], ascending: bool = True) -> List[float]:
    """
    Compute percentile rank (0 to 100) with robust average-rank tie-handling.
    Works 100% self-contained in pure Python without requiring external packages.

    None/missing values are excluded from ranking and assigned a neutral 50.0 score.
    This avoids inventing fake numbers while still giving the stock a baseline
    (not penalized, not rewarded) on that factor dimension.
    """
    if not values:
        return []

    n = len(values)
    # Split valid vs None indices
    valid_pairs = [(i, v) for i, v in enumerate(values) if v is not None]
    result: List[float] = [50.0] * n  # neutral default for missing entries

    if not valid_pairs:
        return result
    if len(valid_pairs) == 1:
        only_idx = valid_pairs[0][0]
        result[only_idx] = 100.0
        return result

    nv = len(valid_pairs)
    # Check equality on valid subset only
    first_val = valid_pairs[0][1]
    all_equal = all(v == first_val for _, v in valid_pairs)
    if all_equal:
        for i, _ in valid_pairs:
            result[i] = 50.0
        return result

    indexed = sorted(valid_pairs, key=lambda x: x[1] if ascending else -x[1])
    local_ranks: Dict[int, float] = {}
    i = 0
    while i < nv:
        j = i
        while j < nv and indexed[j][1] == indexed[i][1]:
            j += 1
        avg_rank_local = (i + j - 1) / 2.0
        pct = (avg_rank_local / (nv - 1.0)) * 100.0 if nv > 1 else 100.0
        for k in range(i, j):
            orig_idx = indexed[k][0]
            local_ranks[orig_idx] = round(float(pct), 2)
        i = j
    for idx, val in local_ranks.items():
        result[idx] = val
    return result


class ScoringEngine:
    """
    Evaluates Limit-up stocks using Percentile-Ranked Multi-Factor Quantitative Model
    with Consecutive Board & Sentiment Linkage.
    """

    def run_daily_scoring(self, trade_date: Optional[str] = None) -> Dict[str, Any]:
        """
        Execute post-market scoring on real limit-up pool.
        Filters stocks, calculates 4-factor percentile scores (with sentiment linkage), picks top candidates, and saves JSON.
        """
        effective_date = data_fetcher.get_effective_date(trade_date)
        record_system_log("INFO", "Scoring", f"Executing 4-factor quant scoring for {effective_date}")

        # 1. Fetch genuine limit up pool
        raw_pool = data_fetcher.get_limit_up_pool(effective_date)
        if not raw_pool:
            raise ValueError(f"Limit up pool for {effective_date} is empty.")

        # 2. Hard Exclusion Filtering (基础排雷)
        filtered_pool, filter_stats = self._apply_hard_filters(raw_pool)
        record_system_log("INFO", "Scoring", f"Pool filtered: {len(raw_pool)} -> {len(filtered_pool)} stocks (ST, Cap, Price, Inst filters applied)")

        if not filtered_pool:
            record_system_log("WARNING", "Scoring", "No stocks passed complete-data and hard-risk filters; no candidates published")
            raise ValueError(f"No complete eligible stocks for {effective_date}")

        # 3. Determine current Market Sentiment State
        sentiment_state = self._get_current_sentiment_state(effective_date)
        record_system_log("INFO", "Scoring", f"Linking sentiment state: '{sentiment_state}' to consecutive board factor")

        # 4. Analyze Sector Distribution for Sector Resonance Factor
        sector_stats = self._analyze_sector_resonance(raw_pool)

        # 5. Determine Market-wide Max Consecutive Boards (空间高度龙头)
        market_max_boards = max([item.get("consecutive_boards", 1) for item in raw_pool] + [1])

        # 6. Multi-Factor Scoring with Consecutive Board & Sentiment Linkage
        scored_stocks = self._compute_factor_scores(
            stocks=filtered_pool,
            sector_stats=sector_stats,
            sentiment_state=sentiment_state,
            market_max_boards=market_max_boards
        )

        # 7. Multi-Tier Sorting (主排序：量化总分；次排序：首封时间早晚；三级排序：封单占比)
        scored_stocks.sort(
            key=lambda x: (
                float(x.get("quant_score", 0.0)),
                -float(self._time_to_minutes(x.get("first_seal_time", "15:00:00"))),
                float(x.get("seal_ratio") or 0.0)
            ),
            reverse=True
        )

        for idx, s in enumerate(scored_stocks):
            s["rank"] = idx + 1

        # 8. Select Top Candidates
        top_candidates = scored_stocks[:CANDIDATES_SELECT_COUNT]

        # Structure final result payload
        result_payload = {
            "trade_date": effective_date,
            "snapshot_status": "FINAL",
            "snapshot_generated_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "generate_time": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "sentiment_state": sentiment_state,
            "total_limit_up_count": len(raw_pool),
            "passed_filter_count": len(filtered_pool),
            "filter_stats": filter_stats,
            "candidates_count": len(top_candidates),
            "candidates": top_candidates,
            "all_scored_stocks": scored_stocks[:20]  # Store top 20 for in-depth analysis
        }
        # Persist to JSON
        self._save_candidates(effective_date, result_payload)

        # Send notifications
        candidate_summary = ", ".join([f"{c['name']}({c['code']}, {c['quant_score']}分)" for c in top_candidates])
        send_notification(
            f"🎯 盘后打板量化选股完成 ({effective_date})",
            f"市场情绪状态: [{sentiment_state}]，共分析 {len(raw_pool)} 只涨停标的，排雷筛选后推荐 Top {len(top_candidates)}:\n{candidate_summary}"
        )

        return result_payload

    def _get_current_sentiment_state(self, trade_date: str) -> str:
        """Fetch or calculate current market sentiment state.

        The sentiment state MUST be anchored to `trade_date` (the closing date).
        Priority:
          1) Exact sentiment_<trade_date>.json  (当日收盘情绪快照)
          2) Real-time recalculation via sentiment_engine.calculate_sentiment(trade_date)

        We NEVER fall back to `latest_sentiment.json` from a different date,
        nor do we fabricate a bogus "震荡/分化期" default. If the calculation
        genuinely fails, we raise so upstream can surface the problem instead
        of scoring with an incorrect sentiment state.
        """
        # 1) Try exact-date cached sentiment file first
        sentiment_file = DATA_DIR / f"sentiment_{trade_date}.json"
        if sentiment_file.exists():
            try:
                with open(sentiment_file, "r", encoding="utf-8") as f:
                    s_data = json.load(f)
                    saved_date = s_data.get("trade_date")
                    if saved_date and saved_date != trade_date:
                        logger.warning(
                            f"Sentiment file '{sentiment_file.name}' has mismatched trade_date "
                            f"({saved_date} != {trade_date}); ignoring it to avoid cross-date contamination."
                        )
                    elif "sentiment_state" in s_data:
                        return s_data["sentiment_state"]
            except Exception as e:
                logger.warning(f"Failed to read exact sentiment file for {trade_date}: {e}")

        # 2) Always compute on the fly for the EXACT trade_date (not latest)
        try:
            logger.info(f"Recomputing sentiment state for trade_date={trade_date} (no usable cache)")
            res = sentiment_engine.calculate_sentiment(trade_date)
            state = res.get("sentiment_state")
            if state:
                return state
            raise RuntimeError(f"sentiment_engine returned no sentiment_state for {trade_date}")
        except Exception as e:
            raise RuntimeError(
                f"Failed to determine sentiment state for trade_date {trade_date}. "
                f"Cannot score stocks under unknown sentiment (would produce misleading rankings). "
                f"Reason: {e}"
            ) from e

    def _apply_hard_filters(self, pool: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], Dict[str, int]]:
        """Apply mandatory risk exclusion rules.

        Principle: a filter is only applied when its data is TRULY present.
        If a value is missing (None), we do NOT fabricate it, and do NOT
        exclude the stock based on unknown information. Unknowns are tracked
        separately via *_unknown stats.
        """
        passed = []
        stats = {
            "total": len(pool),
            "st_excluded": 0,
            "cap_out_of_range": 0,
            "cap_unknown": 0,
            "price_out_of_range": 0,
            "price_unknown": 0,
            "inst_ratio_high": 0,
            "inst_ratio_unknown": 0,
            "incomplete_data": 0,
            "passed": 0
        }

        for stock in pool:
            required_fields = ("price", "float_market_cap", "turnover_rate", "seal_ratio", "consecutive_boards", "sector")
            if any(stock.get(field) is None for field in required_fields):
                stats["incomplete_data"] += 1
                continue

            # 1. ST filter (non-numeric; safe to apply directly)
            if EXCLUDE_ST and stock.get("is_st", False):
                stats["st_excluded"] += 1
                continue

            # 2. Float market cap filter (1.5B - 15B RMB)
            f_cap = stock.get("float_market_cap")
            if f_cap is None or f_cap <= 0:
                stats["cap_unknown"] += 1
                # Do not exclude — unknown data is not a risk signal
            elif f_cap < MIN_FLOAT_MARKET_CAP or f_cap > MAX_FLOAT_MARKET_CAP:
                stats["cap_out_of_range"] += 1
                continue

            # 3. Price filter (5 - 50 RMB)
            price = stock.get("price")
            if price is None or price <= 0:
                stats["price_unknown"] += 1
            elif price < MIN_PRICE or price > MAX_PRICE:
                stats["price_out_of_range"] += 1
                continue

            # 4. Institutional holding ratio filter (<= 15%)
            #    If unknown, assume nothing: let it pass (no fake 0.05 default).
            inst_ratio = stock.get("institution_ratio")
            if inst_ratio is None:
                stats["inst_ratio_unknown"] += 1
            elif inst_ratio > MAX_INSTITUTION_RATIO:
                stats["inst_ratio_high"] += 1
                continue

            passed.append(stock)

        stats["passed"] = len(passed)
        return passed, stats

    def _analyze_sector_resonance(self, full_pool: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
        """Calculate sector limit-up clustering with REAL resonance (not just raw counts).

        NEW LOGIC (aligned with actual A-share next-day premium behavior):
          - "板块过热 (Over-crowded, >6 ZTs)"  →  BAD. Usually means the theme is
            already crowded on T-day. T+1 most back-row members break, while the
            top leader often opens at a non-buyable one-word lock. These stocks
            receive a SECTOR_OVERCROWD penalty.
          - "板块独立妖股 (Solo leader, 1-2 ZTs in sector + stock height ≥ market_max-1)"
            →  GOOD. These high-conviction isolated leaders survive sentiment
            swings and reliably carry 1-2 extra boards.
          - "健康梯队共振 (Healthy echelon, 3-5 ZTs AND has ≥2-consecutive board)"
            →  GOOD. This is the true definition of "follower resonance": a
            sector has enough depth that a 2nd board echelon exists, not just
            5 random first-board stocks nobody will follow.
          - "有板无梯队 (Floating ZTs without height, count=3-5 but all 1-board)"
            →  NEUTRAL. Count bonus is reduced because a pile of 1st-board stocks
            with zero height means pure random theme rotation, not real momentum.
        """
        sector_counts: Dict[str, int] = {}
        sector_stocks: Dict[str, List[Dict[str, Any]]] = {}

        for s in full_pool:
            sec = s.get("sector", "通用板块")
            sector_counts[sec] = sector_counts.get(sec, 0) + 1
            if sec not in sector_stocks:
                sector_stocks[sec] = []
            sector_stocks[sec].append(s)

        # --- We do NOT use sector-count percentile anymore ---
        # Because percentile rank punished 1-stock sectors (solo leaders) the
        # most, which is exactly backwards. We now score each sector by the
        # explicit "crowd / echelon quality" categories above.

        res: Dict[str, Dict[str, Any]] = {}
        for sec in sector_counts:
            cnt = sector_counts[sec]
            items = sector_stocks[sec]
            max_board_in_sector = max([int(item.get("consecutive_boards", 1)) for item in items] + [1])
            height_2plus_count = sum(1 for item in items if int(item.get("consecutive_boards", 1)) >= 2)
            # True resonance = 至少 1 只 ≥2 连板（形成梯队）+ 首板数量≥1（有跟风接棒）
            has_true_resonance = height_2plus_count >= 1 and (cnt - height_2plus_count) >= 1
            res[sec] = {
                "count": cnt,
                "max_board": max_board_in_sector,
                "height_2plus_count": height_2plus_count,
                "has_true_resonance": has_true_resonance,
                "is_overcrowded": cnt >= 7,           # ≥7 只板块过热
                "is_solo_zone": 1 <= cnt <= 2,        # 1-2 只 = 独立妖股区（需要结合个股高度单独加分）
            }
        return res

    def _compute_factor_scores(
        self,
        stocks: List[Dict[str, Any]],
        sector_stats: Dict[str, Dict[str, Any]],
        sentiment_state: str,
        market_max_boards: int
    ) -> List[Dict[str, Any]]:
        """Calculate 4 individual factor scores and composite quant score.

        Missing values (None) never get fabricated stand-ins:
          - Percentile arrays receive None, compute_percentile_rank neutralizes them to 50.
          - Scalar sub-factors receive a neutral midpoint (50 / 50th percentile weight)
            so they neither contribute to nor detract from the final ranking.
        """
        n = len(stocks)
        if n == 0:
            return []

        # Arrays for percentile ranking — pass raw Nones, function will neutralize
        seal_ratios: List[Any] = [s.get("seal_ratio") for s in stocks]               # NO 0.1 fallback
        seal_ratio_percentiles = compute_percentile_rank(seal_ratios, ascending=True)

        turnover_rates: List[Any] = [s.get("turnover_rate") for s in stocks]         # NO 5.0 fallback

        results = []
        for i, s in enumerate(stocks):
            consec_raw = s.get("consecutive_boards")
            if consec_raw is None or int(consec_raw) < 1:
                # Unknown board height: use neutral value 1 (doesn't reward or punish)
                consec = 1
            else:
                consec = int(consec_raw)

            # -------------------------------------------------------------
            # Factor 1: 连板阶梯与情绪联动 (Consecutive Board & Sentiment Linkage - 30%)
            # -------------------------------------------------------------
            if consec >= 5:
                base_board_score = 100.0
            elif consec in (3, 4):
                # WIDEN GAP vs 1-board (was 75, now 85). A confirmed 3-4 board
                # stock has already survived 2+ days of real selling pressure
                # and carries vastly more alpha than a random first-board.
                base_board_score = 85.0
            elif consec == 2:
                base_board_score = 70.0
            else:
                base_board_score = 45.0  # 1-board is the FLOOR (was 50, neutral midpoint)

            sentiment_adj = 0.0
            is_spatial_leader = (consec >= market_max_boards and market_max_boards > 1)

            # 退潮期避险：若处于"退潮/弱势期"或熔断，中位股(3-4板)重罚，低位股(1-2板)避险加分
            if sentiment_state in ("退潮/弱势期", "熔断状态"):
                if consec in (3, 4):
                    sentiment_adj -= 30.0
                elif consec in (1, 2):
                    sentiment_adj += 10.0
            # 主升期加成：空间龙头额外 bonus
            elif sentiment_state == "主升/强势期":
                if is_spatial_leader:
                    sentiment_adj += 18.0
            # 震荡/分化期（最常命中的状态）：
            #   分歧中走出来的空间龙头 = 真龙头，确定性最高 → +12 bonus
            #   2 连板刚确立辨识度 → +3 小幅鼓励接力
            elif sentiment_state == "震荡/分化期":
                if is_spatial_leader:
                    sentiment_adj += 12.0
                elif consec == 2:
                    sentiment_adj += 3.0

            factor_consecutive_board = round(max(0.0, min(100.0, base_board_score + sentiment_adj)), 2)

# -------------------------------------------------------------
            # Factor 2: 封板强度因子 (Seal Strength - 25%)
            # -------------------------------------------------------------
            seal_pct_score = seal_ratio_percentiles[i]  # already neutralized to 50 if missing
            fst = s.get("first_seal_time")
            time_score = self._score_seal_time(fst) if fst else 50.0
            factor_seal = round(min(100.0, seal_pct_score * 0.6 + time_score * 0.4), 2)

            # 🔴【新增烂板/假强板风控惩罚】
            # 封成比 < 10% 且 非高位龙头 (连板 < 4板) 直接扣除 30 分封板强度分
            seal_ratio_val = s.get("seal_ratio")
            if seal_ratio_val is not None and seal_ratio_val < 0.10 and consec < 4:
                factor_seal = max(0.0, factor_seal - 30.0)

            # -------------------------------------------------------------
            # Factor 3: 筹码结构与炸板惩罚 (Chip Structure & Broken Penalty - 25%)
            # -------------------------------------------------------------
            turnover = turnover_rates[i]
            if turnover is None or turnover < 0:
                # Unknown turnover → neutral 60 midpoint (between 90 ideal and 30 worst)
                turnover_score = 60.0
            elif 5.0 <= turnover <= 18.0:
                turnover_score = 90.0 - abs(turnover - 10.0) * 1.5
            elif 3.0 <= turnover < 5.0:
                turnover_score = 65.0
            elif 18.0 < turnover <= 28.0:
                turnover_score = 60.0 - (turnover - 18.0) * 2.0
            else:
                turnover_score = 30.0

            breakout_bonus = 20.0 if s.get("high_60d_breakout", False) else 0.0
            chip_subtotal = min(100.0, turnover_score * 0.8 + breakout_bonus)

            broken_cnt_raw = s.get("broken_count")
            broken_cnt = int(broken_cnt_raw) if broken_cnt_raw is not None else 0
            if broken_cnt == 0:
                broken_penalty_score = 100.0
            elif broken_cnt == 1:
                broken_penalty_score = 60.0
            elif broken_cnt == 2:
                broken_penalty_score = 30.0
            else:
                broken_penalty_score = 10.0

            factor_chip = round(chip_subtotal * 0.6 + broken_penalty_score * 0.4, 2)

            # -------------------------------------------------------------
            # Factor 4: 板块共振因子 (Sector Resonance - 20%)
            #   NEW LOGIC — replaced the old "sector-count percentile + has_follower"
            #   which punished solo leaders (1 ZT sector = low percentile) and
            #   rewarded crowded sectors (6+ random ZTs = high percentile).
            #
            #   Real-world next-day premium hierarchy (highest → lowest):
            #     1. SOLO LEADER bonus   (sector 1-2 ZTs + stock close to market height)
            #     2. TRUE ECHELON        (3-5 ZTs AND ≥2-board stock exists in sector)
            #     3. NEUTRAL / shallow
            #     4. OVERCROWDED         (≥7 ZTs — theme overheated, back-row breaks)
            # -------------------------------------------------------------
            sector_key = s.get("sector")
            sec_info = None
            if sector_key and sector_key in sector_stats:
                sec_info = sector_stats[sector_key]

            if sec_info is None:
                sec_quality_score = 50.0
            else:
                cnt = int(sec_info.get("count", 0) or 0)
                overcrowded = bool(sec_info.get("is_overcrowded", False))
                solo_zone = bool(sec_info.get("is_solo_zone", False))
                true_resonance = bool(sec_info.get("has_true_resonance", False))

                if overcrowded:
                    sec_quality_score = 30.0   # 板块过热：大幅减分
                elif solo_zone:
                    if consec >= max(2, market_max_boards - 1):
                        # 独立妖股板块 + 个股本身接近市场最高高度 = 最稀缺品种
                        sec_quality_score = 95.0
                    else:
                        # 独立首板（没有高度，solo zone但只是1板）：中性，不奖不罚
                        sec_quality_score = 55.0
                elif true_resonance:
                    # 健康梯队（3-5 只 + 有 2 连板高度接棒）：良性共振
                    sec_quality_score = 88.0
                else:
                    # 有板无梯队（3-5 只但全是首板，纯随机主题）：中性
                    sec_quality_score = 58.0

            factor_sector = round(max(0.0, min(100.0, sec_quality_score)), 2)

            # -------------------------------------------------------------
            # Composite Weighted Quant Score
            # -------------------------------------------------------------
            w1 = FACTOR_WEIGHTS.get("consecutive_board_sentiment", 0.30)
            w2 = FACTOR_WEIGHTS.get("seal_strength", 0.25)
            w3 = FACTOR_WEIGHTS.get("chip_structure", 0.25)
            w4 = FACTOR_WEIGHTS.get("sector_resonance", 0.20)

            total_quant_score = round(
                factor_consecutive_board * w1 +
                factor_seal * w2 +
                factor_chip * w3 +
                factor_sector * w4,
                2
            )

            scored_item = {
                **s,
                "quant_score": total_quant_score,
                "factor_breakdown": {
                    "consecutive_board_sentiment": {
                        "score": factor_consecutive_board,
                        "weight": w1,
                        "weighted_score": round(factor_consecutive_board * w1, 2),
                        "consecutive_boards": consec,
                        "base_board_score": base_board_score,
                        "sentiment_state": sentiment_state,
                        "sentiment_adjustment": sentiment_adj,
                        "is_spatial_leader": is_spatial_leader
                    },
                    "seal_strength": {
                        "score": factor_seal,
                        "weight": w2,
                        "weighted_score": round(factor_seal * w2, 2),
                        # Report raw values truthfully — None if missing (UI shows "--").
                        "seal_ratio": round(s["seal_ratio"], 4) if s.get("seal_ratio") is not None else None,
                        "first_seal_time": s.get("first_seal_time")
                    },
                    "chip_structure": {
                        "score": factor_chip,
                        "weight": w3,
                        "weighted_score": round(factor_chip * w3, 2),
                        "turnover_rate": round(turnover, 2) if turnover is not None else None,
                        "high_60d_breakout": bool(s.get("high_60d_breakout", False)),
                        "broken_count": broken_cnt
                    },
                    "sector_resonance": {
                        "score": factor_sector,
                        "weight": w4,
                        "weighted_score": round(factor_sector * w4, 2),
                        "sector_name": sector_key,
                        "sector_zt_count": sec_info.get("count") if sec_info else None,
                        # Upgraded from boolean "has_follower" → true_resonance flag
                        # (see _analyze_sector_resonance docstring for definition).
                        "has_true_resonance": bool(sec_info.get("has_true_resonance", False)) if sec_info else False,
                        "is_overcrowded": bool(sec_info.get("is_overcrowded", False)) if sec_info else False,
                        "is_solo_zone": bool(sec_info.get("is_solo_zone", False)) if sec_info else False,
                    }
                }
            }
            results.append(scored_item)

        return results

    def _score_seal_time(self, time_str: str) -> float:
        """First seal time score: 09:45前 (100分), 09:45-10:30 (80分), 10:30-14:00 (50分), 14:00后 (20分)."""
        minute_of_day = self._time_to_minutes(time_str)
        if minute_of_day <= 9 * 60 + 45:      # <= 09:45
            return 100.0
        elif minute_of_day <= 10 * 60 + 30:   # 09:45 - 10:30
            return 80.0
        elif minute_of_day <= 14 * 60:        # 10:30 - 14:00
            return 50.0
        else:                                 # After 14:00
            return 20.0

    def _time_to_minutes(self, time_str: str) -> int:
        """Convert time string (e.g., '09:30:00', '09:30', '093000') to minute of day."""
        try:
            clean_time = time_str.strip()
            parts = clean_time.split(":")
            if len(parts) >= 2:
                hh, mm = int(parts[0]), int(parts[1])
            elif len(clean_time) == 6 and clean_time.isdigit():
                hh, mm = int(clean_time[:2]), int(clean_time[2:4])
            else:
                hh, mm = 10, 0
            return hh * 60 + mm
        except Exception:
            return 10 * 60

    def _save_candidates(self, trade_date: str, payload: Dict[str, Any]) -> None:
        """Persist candidates payload to candidates_YYYYMMDD.json and latest_candidates.json."""
        try:
            target_file = DATA_DIR / f"candidates_{trade_date}.json"
            with open(target_file, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False, indent=2)

            latest_file = DATA_DIR / "latest_candidates.json"
            with open(latest_file, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.error(f"Failed to persist candidates JSON: {e}")


# Global singleton instance
scoring_engine = ScoringEngine()