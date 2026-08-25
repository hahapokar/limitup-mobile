"""
Top-Level Market Sentiment & Circuit Breaker Engine.
Calculates composite market sentiment score (0-100) and triggers the ice-point circuit breaker.
"""

import json
import logging
from typing import Dict, Any, Optional, List, Tuple, Callable
from pathlib import Path

from quant_system.config import (
    SENTIMENT_WEIGHTS,
    CIRCUIT_BREAKER_THRESHOLD,
    SENTIMENT_WEAK_THRESHOLD,
    SENTIMENT_STRONG_THRESHOLD,
    DATA_DIR
)
from quant_system.core.data_fetcher import data_fetcher
from quant_system.utils.calendar import normalize_to_trade_day, get_prev_trade_day
from quant_system.utils.notifier import record_system_log, send_notification

logger = logging.getLogger("QuantTrading.Sentiment")


class SentimentEngine:
    """
    Evaluates top-level market sentiment across four core quantitative dimensions.
    Enforces the Ice-Point Circuit Breaker and dynamic position sizing controls.
    """

    def calculate_sentiment(self, trade_date: Optional[str] = None) -> Dict[str, Any]:
        """
        Compute market sentiment for `trade_date` (收盘日期).
        Returns sentiment score, component scores, circuit breaker status, and suggested position limit.

        Sentiment is strictly anchored to `trade_date` — no cross-date fallback, no mocked
        latest_*.json. Missing numeric values receive a neutral 50-point score WITHOUT
        inventing a fake raw number (the component's raw_value field will be null instead).
        """
        effective_date = data_fetcher.get_effective_date(trade_date)
        prev_date = get_prev_trade_day(effective_date)

        record_system_log("INFO", "Sentiment", f"Calculating market sentiment for trading date: {effective_date} (Prev: {prev_date})")

        # 1. Fetch limit up pool and broken limit up pool
        today_zt_pool = data_fetcher.get_limit_up_pool(effective_date)
        today_broken_pool = data_fetcher.get_broken_limit_up_pool(effective_date)

        # 2. Fetch market overview (advancing/declining/limit-down)
        market_overview = data_fetcher.get_market_overview(effective_date)

        # -------------------------------------------------------------
        # Factor 1: Yesterday's Limit-Up Today's Average Premium (35%)
        #   Note: raw can be None → scoring neutralizes to 50, raw_value stays None (not a lie).
        # -------------------------------------------------------------
        yesterday_premium_pct = self._calculate_yesterday_zt_premium(prev_date, effective_date, today_zt_pool)
        score_premium = self._score_yesterday_premium(yesterday_premium_pct)

        # -------------------------------------------------------------
        # Factor 2: Market Limit-Down Count (25%)
        #   Do NOT plug 0 when missing; forward None so neutral score applies.
        # -------------------------------------------------------------
        if "limit_down_count" in market_overview and market_overview["limit_down_count"] is not None:
            try:
                limit_down_count: Optional[int] = int(market_overview["limit_down_count"])
            except (TypeError, ValueError):
                limit_down_count = None
        else:
            limit_down_count = None
        score_limit_down = self._score_limit_down_count(limit_down_count)

        # -------------------------------------------------------------
        # Factor 3: Max Consecutive Boards & Real Broken Board Rate (25%)
        # -------------------------------------------------------------
        max_boards, broken_rate_pct = self._calculate_board_metrics(today_zt_pool, today_broken_pool)
        score_board_height = self._score_board_height(max_boards)
        score_broken_rate = self._score_broken_rate(broken_rate_pct)
        score_boards_combined = score_board_height * 0.5 + score_broken_rate * 0.5

        # -------------------------------------------------------------
        # Factor 4: Whole Market Advance / Decline Ratio (15%)
        #   Do NOT default to 50.0 when missing; forward None.
        # -------------------------------------------------------------
        if "advance_ratio" in market_overview and market_overview["advance_ratio"] is not None:
            try:
                advance_ratio: Optional[float] = float(market_overview["advance_ratio"])
            except (TypeError, ValueError):
                advance_ratio = None
        else:
            advance_ratio = None
        score_advance = self._score_advance_ratio(advance_ratio)

        # -------------------------------------------------------------
        # Composite Weighted Sentiment Score (0 - 100)
        # -------------------------------------------------------------
        w_prem = SENTIMENT_WEIGHTS["yesterday_zt_premium"]
        w_ld = SENTIMENT_WEIGHTS["market_limit_down"]
        w_board = SENTIMENT_WEIGHTS["max_consecutive_boards"]
        w_adv = SENTIMENT_WEIGHTS["advance_decline_ratio"]

        total_score = (
            score_premium * w_prem +
            score_limit_down * w_ld +
            score_boards_combined * w_board +
            score_advance * w_adv
        )
        total_score = round(max(0.0, min(100.0, total_score)), 2)

        # Circuit breaker trigger & Dynamic Position Scaling (阶梯式仓位打折控制)
        circuit_breaker = total_score < CIRCUIT_BREAKER_THRESHOLD

        if circuit_breaker:
            sentiment_state = "熔断状态"
            target_position_ratio = 0.0
        elif total_score < SENTIMENT_WEAK_THRESHOLD:
            sentiment_state = "退潮/弱势期"
            target_position_ratio = 0.35  # 弱势退潮期严格防守，最大持仓上限 35%
        elif total_score > SENTIMENT_STRONG_THRESHOLD:
            sentiment_state = "主升/强势期"
            target_position_ratio = 1.00  # 主升期满仓尽揽
        else:
            sentiment_state = "震荡/分化期"
            target_position_ratio = 0.65  # 震荡分化期半仓试错

        sentiment_level = (
            "极度狂热" if total_score >= 80 else (
                "偏暖积极" if total_score >= 60 else (
                    "震荡分化" if total_score >= 40 else (
                        "冰点低迷" if total_score >= 30 else "极度冰点(熔断)"
                    )
                )
            )
        )

        def _rounded_or_none(v: Any, digits: int = 2) -> Any:
            """Preserve None for the JSON output instead of printing a misleading numeric."""
            if v is None:
                return None
            try:
                return round(float(v), digits)
            except (TypeError, ValueError):
                return None

        up_count = market_overview.get("up_count")
        down_count = market_overview.get("down_count")
        activity_pct = market_overview.get("market_activity_pct")

        result = {
            "trade_date": effective_date,
            "sentiment_score": total_score,
            "sentiment_state": sentiment_state,
            "sentiment_level": sentiment_level,
            "sentiment_circuit_breaker": circuit_breaker,
            "target_position_ratio": target_position_ratio,
            "components": {
                "yesterday_zt_premium": {
                    "raw_value": _rounded_or_none(yesterday_premium_pct, 2),
                    "score": round(score_premium, 1),
                    "weight": w_prem,
                    "weighted_score": round(score_premium * w_prem, 2),
                    "unit": "%",
                    "description": "昨日涨停个股今日平均溢价率"
                },
                "market_limit_down": {
                    "raw_value": limit_down_count,
                    "score": round(score_limit_down, 1),
                    "weight": w_ld,
                    "weighted_score": round(score_limit_down * w_ld, 2),
                    "unit": "家",
                    "description": "全市场跌停家数 (>15家重度扣分)"
                },
                "max_consecutive_boards": {
                    "raw_value": max_boards,
                    "broken_rate_pct": _rounded_or_none(broken_rate_pct, 2),
                    "score": round(score_boards_combined, 1),
                    "weight": w_board,
                    "weighted_score": round(score_boards_combined * w_board, 2),
                    "unit": "连板",
                    "description": (
                        f"最高连板高度({max_boards}板)"
                        f"与真实炸板率({_rounded_or_none(broken_rate_pct, 1) if broken_rate_pct is not None else 'N/A'}%)"
                    )
                },
                "advance_decline_ratio": {
                    "raw_value": _rounded_or_none(advance_ratio, 2),
                    "score": round(score_advance, 1),
                    "weight": w_adv,
                    "weighted_score": round(score_advance * w_adv, 2),
                    "unit": "%",
                    "description": "全市场红盘上涨家数占比"
                }
            },
            "market_summary": {
                "limit_up_count": len(today_zt_pool),
                "broken_up_count": len(today_broken_pool),
                "limit_down_count": limit_down_count,
                # Don't fabricate 0 when missing — show None (unknown) so it doesn't look like 0 up/down days.
                "up_count": up_count,
                "down_count": down_count,
                "activity_pct": _rounded_or_none(activity_pct, 2)
            }
        }
        
        # Save to local JSON
        self._save_sentiment_file(effective_date, result)
        
        # Broadcast alert if circuit breaker active
        if circuit_breaker:
            send_notification(
                "🚨 市场情绪冰点熔断预警",
                f"当前综合情绪得分仅为 {total_score} 分 (低于熔断线 {CIRCUIT_BREAKER_THRESHOLD}分)，触发次日建仓熔断限制，明日目标持仓比例锁定为 0%！"
            )
        else:
            record_system_log("INFO", "Sentiment", f"Market sentiment score: {total_score} ({sentiment_level}), Target Position Limit: {int(target_position_ratio*100)}%")

        return result

    def _calculate_yesterday_zt_premium(self, prev_date: str, today_date: str, today_zt_pool: List[Dict[str, Any]]) -> Optional[float]:
        """Calculate today's average premium from all yesterday's limit-up stocks.

        Returns None if the value cannot be genuinely determined.
        NEVER fabricate a value from thin air (e.g. the old multi_ratio*5.0-1.0 formula).
        """
        try:
            prev_cache = DATA_DIR / f"limitup_{prev_date}.json"
            if prev_cache.exists():
                with open(prev_cache, "r", encoding="utf-8") as f:
                    prev_pool = json.load(f)
                if prev_pool:
                    codes = [item["code"] for item in prev_pool if "code" in item]
                    if codes:
                        quotes = data_fetcher.get_realtime_quotes(codes)
                        if quotes:
                            premiums = [q["change_pct"] for q in quotes.values() if "change_pct" in q]
                            if premiums:
                                return round(sum(premiums) / len(premiums), 4)
        except Exception as e:
            logger.debug(f"Calculate yesterday premium from cache failed: {e}")

        # No fabricated fallback. If unknown → None, caller neutralizes to 50-score midpoint.
        return None

    def _safe_component(
        self,
        raw: Any,
        scorer: Callable[[Any], float],
        fallback_raw: Any,
        fallback_score: float = 50.0,
    ) -> Tuple[Any, float]:
        """Return (raw_value, scored_value). For unknown input, use fallback_raw+fallback_score.

        Score-fallback only kicks in when raw is None/missing — raw numeric values always
        pass through the real scorer so valid signals are never watered down.
        """
        if raw is None:
            return fallback_raw, fallback_score
        try:
            return raw, float(scorer(raw))
        except Exception as exc:
            logger.warning(f"Scorer failed for input {raw!r}; applying neutral fallback {fallback_score}: {exc}")
            return fallback_raw, fallback_score

    def _score_yesterday_premium(self, premium_pct: Optional[float]) -> float:
        """Score yesterday's limit up premium rate (0 - 100). None → neutral 50."""
        if premium_pct is None:
            return 50.0
        if premium_pct >= 4.0:
            return 100.0
        elif premium_pct >= 2.5:
            return 85.0
        elif premium_pct >= 1.0:
            return 70.0
        elif premium_pct >= 0.0:
            return 50.0
        elif premium_pct >= -2.0:
            return 30.0
        elif premium_pct >= -4.0:
            return 15.0
        else:
            return 0.0

    def _score_limit_down_count(self, count: Optional[int]) -> float:
        """Score limit down count: <15 is normal, >15 penalizes heavily. None → 50 neutral."""
        if count is None:
            return 50.0
        if count <= 2:
            return 100.0
        elif count <= 6:
            return 85.0
        elif count <= 10:
            return 70.0
        elif count <= 15:
            return 50.0
        elif count <= 25:
            return 25.0
        elif count <= 40:
            return 10.0
        else:
            return 0.0

    def _calculate_board_metrics(
        self, zt_pool: List[Dict[str, Any]], broken_pool: List[Dict[str, Any]]
    ) -> Tuple[int, Optional[float]]:
        """Extract maximum consecutive board height and true market broken board rate.

        Broken rate is None if total_attempts == 0 (no data to measure) —
        old hardcoded 20.0 has been removed.
        """
        if zt_pool:
            actual_consecs = [
                int(item["consecutive_boards"])
                for item in zt_pool
                if item.get("consecutive_boards") is not None and int(item["consecutive_boards"]) >= 1
            ]
            max_boards = max(actual_consecs) if actual_consecs else 1
        else:
            max_boards = 1

        sealed_count = len(zt_pool)
        broken_count = len(broken_pool)
        total_attempts = sealed_count + broken_count

        if total_attempts > 0:
            broken_rate = round((broken_count / total_attempts) * 100.0, 4)
        else:
            broken_rate = None  # ← No bogus 20.0 stand-in
        return max_boards, broken_rate

    def _score_board_height(self, max_boards: int) -> float:
        """Score consecutive board height."""
        if max_boards >= 6:
            return 100.0
        elif max_boards == 5:
            return 90.0
        elif max_boards == 4:
            return 80.0
        elif max_boards == 3:
            return 65.0
        elif max_boards == 2:
            return 50.0
        else:
            return 30.0

    def _score_broken_rate(self, broken_rate_pct: Optional[float]) -> float:
        """Score broken board rate. None → neutral 50 score (midpoint of 0-100)."""
        if broken_rate_pct is None:
            return 50.0
        if broken_rate_pct <= 12.0:
            return 100.0
        elif broken_rate_pct <= 20.0:
            return 85.0
        elif broken_rate_pct <= 30.0:
            return 65.0
        elif broken_rate_pct <= 40.0:
            return 40.0
        elif broken_rate_pct <= 55.0:
            return 20.0
        else:
            return 5.0

    def _score_advance_ratio(self, advance_ratio: Optional[float]) -> float:
        """Score market advancing percentage. None → 50 neutral."""
        if advance_ratio is None:
            return 50.0
        if advance_ratio >= 75.0:
            return 100.0
        elif advance_ratio >= 60.0:
            return 85.0
        elif advance_ratio >= 50.0:
            return 65.0
        elif advance_ratio >= 40.0:
            return 45.0
        elif advance_ratio >= 30.0:
            return 25.0
        else:
            return 10.0

    def get_cached_sentiment(self, trade_date: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Load cached sentiment result if already calculated."""
        effective_date = data_fetcher.get_effective_date(trade_date)
        target_path = DATA_DIR / f"sentiment_{effective_date}.json"
        if target_path.exists():
            try:
                with open(target_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                logger.warning(f"Failed to read cached sentiment: {e}")
        
        return None

    def _save_sentiment_file(self, trade_date: str, data: Dict[str, Any]) -> None:
        """Save sentiment data to data/sentiment_YYYYMMDD.json and data/latest_sentiment.json."""
        try:
            target_path = DATA_DIR / f"sentiment_{trade_date}.json"
            with open(target_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)

            latest_path = DATA_DIR / "latest_sentiment.json"
            with open(latest_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.error(f"Failed to persist sentiment JSON: {e}")


# Global singleton instance
sentiment_engine = SentimentEngine()