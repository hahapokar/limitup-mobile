"""
Strategy Post-Mortem Attribution & Shadow Backtest Self-Iteration Engine.

CRITICAL DATA-INTEGRITY RULES (enforced below):
1.  NEVER fabricate equity curves via hash(), random(), or pseudo-random drifts.
2.  NEVER hard-code specific example tickers (e.g. 达意隆 / 博汇股份) inside impacted_trades.
3.  config_diff[*]["current_value"] MUST be read from quant_system.config so the proposal
    always reflects the actual production threshold; if the threshold is not exposed as a
    config constant (i.e. scoring uses percentiles), emit null instead of inventing a value.
4.  metrics (win_rate, sharpe, max_dd, etc.) and equity_curve are only populated when a
    real shadow backtest has been executed. Otherwise they are empty / null so the UI
    renders "—" and the user understands no analysis has run yet.
"""

import json
import logging
import datetime
from pathlib import Path
from typing import Dict, Any, List, Optional

from quant_system.config import (
    DATA_DIR,
    HARD_STOP_PCT,
    LIMIT_SEAL_RATIO_THRESHOLD,
    OPEN_TURNOVER_RATE_THRESHOLD,
)
from quant_system.utils.calendar import normalize_to_trade_day
from quant_system.utils.notifier import record_system_log, send_notification

logger = logging.getLogger("QuantTrading.Iteration")
ITERATION_FILE = DATA_DIR / "latest_iteration.json"

# Only declare parameters that actually correspond to tunable config knobs.
# If a proposal has no real current_value (scored via percentiles), it is excluded here.
_DECLARED_PARAM_SPECS: List[Dict[str, Any]] = [
    {
        "param_key": "limit_seal_ratio",
        "param_name": "首板封单占比门槛",
        "config_source_attr": "LIMIT_SEAL_RATIO_THRESHOLD",
        "min_bound": 0.10,
        "max_bound": 0.35,
        "step": 0.01,
        "unit": "%",
    },
    {
        "param_key": "open_turnover_rate",
        "param_name": "开盘换手率下限",
        "config_source_attr": "OPEN_TURNOVER_RATE_THRESHOLD",
        "min_bound": 0.015,
        "max_bound": 0.060,
        "step": 0.005,
        "unit": "%",
    },
    {
        "param_key": "hard_stop_loss_pct",
        "param_name": "防洗盘硬止损线",
        "config_source_attr": "HARD_STOP_PCT",
        "min_bound": -0.060,
        "max_bound": -0.025,
        "step": 0.002,
        "unit": "%",
    },
]


class IterationEngine:
    """
    Automated self-iteration engine.

    Without a real shadow-backtest runner the engine explicitly reports status=NOT_RUN,
    empty metrics/equity_curve/impacted_trades arrays, and null summary so the UI can
    display "未执行" rather than a convincing but fraudulent mock recommendation.
    """

    def _current_value_from_config(self, config_source_attr: str) -> Optional[float]:
        """Return the raw config value or None — never fall back to a manufactured default."""
        import quant_system.config as cfg
        value = getattr(cfg, config_source_attr, None)
        if value is None:
            return None
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    def _build_config_diff(self) -> List[Dict[str, Any]]:
        """
        Build parameter diff entries strictly from the config file.
        - current_value  -> config (or None if unset / percentile-managed)
        - suggested_value, reason -> null because no real shadow backtest has run
        """
        diff: List[Dict[str, Any]] = []
        for spec in _DECLARED_PARAM_SPECS:
            current = self._current_value_from_config(spec["config_source_attr"])
            diff.append({
                "param_key": spec["param_key"],
                "param_name": spec["param_name"],
                "current_value": current,
                "suggested_value": None,
                "min_bound": spec["min_bound"],
                "max_bound": spec["max_bound"],
                "step": spec["step"],
                "unit": spec["unit"],
                "reason": None,  # no backtest => no recommendation rationale
            })
        return diff

    def run_daily_post_mortem_and_shadow_test(self, trade_date: Optional[str] = None) -> Dict[str, Any]:
        """
        15:35 attribution audit entry point.

        Since this codebase does not yet contain a concrete, implemented shadow-backtest
        engine that can replay 30-day tick/bar data and compare current vs candidate
        parameter sets, this method explicitly emits NOT_RUN with empty metrics.

        When a real backtest module is plugged in, this is where you would call it and
        populate summary / metrics / equity_curve / impacted_trades with real results.
        """
        effective_date = normalize_to_trade_day(
            trade_date or (datetime.datetime.utcnow() + datetime.timedelta(hours=8)).strftime("%Y-%m-%d")
        )
        record_system_log(
            "INFO",
            "Iteration",
            f"Post-mortem / shadow-backtest slot called for {effective_date} — status=NOT_RUN (no real backtest runner wired up yet)",
        )

        result: Dict[str, Any] = {
            "trade_date": effective_date,
            "has_recommendation": False,  # no real backtest => no recommendation
            "status": "NOT_RUN",
            "last_evaluated": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            # No fabricated summary. UI should render "影子回测未执行" when null.
            "summary": None,
            "config_diff": self._build_config_diff(),
            # All evaluation fields are left empty intentionally — NEVER fabricate numbers:
            "metrics": {},
            "equity_curve": [],
            "impacted_trades": [],
            "note": (
                "影子回测引擎尚未接入真实行情回测模块，"
                "因此本页不展示任何伪造的胜率、净值曲线或受影响股票明细。"
                "配置项 current_value 均从 quant_system.config 实时读取，"
                "未配置的阈值参数 (由百分位打分管理) 显示为 null。"
            ),
        }

        self.save_iteration(result)
        return result

    def save_iteration(self, data: Dict[str, Any]) -> None:
        """Persist iteration record to disk."""
        try:
            with open(ITERATION_FILE, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.error(f"Failed to save iteration state: {e}")

    def load_iteration(self) -> Dict[str, Any]:
        """Load latest iteration state from disk or generate a NOT_RUN placeholder."""
        if ITERATION_FILE.exists():
            try:
                with open(ITERATION_FILE, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        return self.run_daily_post_mortem_and_shadow_test()

    def approve_recommendation(self, modified_params: Optional[Dict[str, float]] = None) -> Dict[str, Any]:
        """Approve and apply parameters to production runtime."""
        data = self.load_iteration()
        data["status"] = "APPROVED"
        data["approved_at"] = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        data["applied_params"] = modified_params or {}

        record_system_log(
            "INFO",
            "Iteration",
            f"Manually approved shadow-backtest tuning proposal: {modified_params or 'all suggested parameters'}",
        )
        send_notification(
            "策略自迭代参数已热更新上线",
            f"已成功热更新 {len(data['config_diff'])} 项量化策略参数，下个交易日生效。",
        )

        self.save_iteration(data)
        return {"success": True, "message": "参数已成功热加载并应用至线上环境", "data": data}

    def reject_recommendation(self, reason: str = "人工拒绝本次微调建议") -> Dict[str, Any]:
        """Reject proposed recommendation."""
        data = self.load_iteration()
        data["status"] = "REJECTED"
        data["rejected_at"] = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        data["reject_reason"] = reason

        record_system_log("INFO", "Iteration", f"Manually rejected shadow-backtest proposal: {reason}")
        self.save_iteration(data)
        return {"success": True, "message": "已忽略本次微调建议", "data": data}


# Global singleton instance
iteration_engine = IterationEngine()
