"""
A-Share Limit-Up Quant Trading System - Global Configuration
All ratios, factor weights, stop-loss thresholds, and data source sequences.
"""

import os
from pathlib import Path
from typing import List, Dict, Any, Optional

# Base Directories & Path Alignment
BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BASE_DIR.parent if BASE_DIR.name == "quant_system" else BASE_DIR
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

PORTFOLIO_FILE = DATA_DIR / "portfolio_state.json"
SYSTEM_LOGS_FILE = DATA_DIR / "system_logs.json"
LATEST_SENTIMENT_FILE = DATA_DIR / "latest_sentiment.json"
LATEST_CANDIDATES_FILE = DATA_DIR / "latest_candidates.json"

def snapshot_manifest_file(trade_date: str) -> Path:
    return DATA_DIR / f"snapshot_status_{trade_date}.json"

# Web Server & Tailscale Network Configurations
WEB_HOST: str = "0.0.0.0"
WEB_PORT: int = 3008
TAILSCALE_DOMAIN: str = "zpq"

# Operational Dates Anchor
START_DATE: str = "2026-08-22"  # Will auto-normalize to latest real trading day (2026-08-21) if holiday/weekend

# Data Source Priority & Resilience (Fallback Chain)
DATA_SOURCE_PRIORITY: List[str] = [
    "akshare",      # Primary Python quant package
    "eastmoney",    # Fallback 1: EastMoney Open API (push2 / datacenter-web)
]
DATA_REQUEST_TIMEOUT: float = 10.0  # Extended to 10.0s for heavy end-of-day data queries
DATA_REQUEST_RETRIES: int = 3
DATA_FETCH_INTERVAL: float = 0.5    # Seconds between requests to avoid IP throttling

# Restricted-share release risk controls. Ratios are percentages of total
# share capital as reported by the AkShare release calendar.
LOCKUP_LOOKAHEAD_TRADING_DAYS: int = 15
LOCKUP_WARNING_RATIO: float = 2.0
LOCKUP_HARD_RATIO: float = 5.0
LOCKUP_RISK_PENALTY: float = 15.0

# Account & Capital Allocation
INITIAL_CAPITAL: float = 100_000.0     # 100,000 RMB (10万元本金)
MAX_POSITIONS: int = 4                 # Equal-weight portfolio (25% max per stock)
CANDIDATES_SELECT_COUNT: int = 8       # Publish and evaluate the top eight candidates daily
BUY_CANDIDATE_MAX_RANK: int = 8        # Only the first eight ranked candidates may be bought

# Refined One-Way Friction Rates (区分买卖费用与印花税)
BUY_FRICTION_RATE: float = 0.0008      # 0.08% (佣金 + 过户费 + 买入滑点)
SELL_FRICTION_RATE: float = 0.0015     # 0.15% (印花税 0.05% + 佣金 + 卖出滑点)

# Hard Exclusion Filters (基础排雷过滤)
EXCLUDE_ST: bool = True
MIN_FLOAT_MARKET_CAP: float = 1.5e9    # 15 亿元
MAX_FLOAT_MARKET_CAP: float = 15.0e9   # 150 亿元
MAX_INSTITUTION_RATIO: float = 0.15    # 机构持仓占比 <= 15%
MIN_PRICE: float = 5.0                 # 5.00 RMB
MAX_PRICE: float = 50.0                # 50.00 RMB

# Top-Level Market Sentiment Timers & Thresholds (情绪择时与分级)
CIRCUIT_BREAKER_THRESHOLD: float = 30.0  # 情绪分 < 30 触发冰点熔断，次日禁止下单
SENTIMENT_WEAK_THRESHOLD: float = 45.0   # 30 <= 情绪分 < 45 为退潮弱势期 (触发中位股扣分)
SENTIMENT_STRONG_THRESHOLD: float = 70.0 # 情绪分 > 70 为主升强势期 (触发龙头溢价加分)

SENTIMENT_WEIGHTS: Dict[str, float] = {
    "yesterday_zt_premium": 0.35,  # 昨日涨停今日平均溢价率 (35%)
    "market_limit_down": 0.25,     # 全市场跌停家数 (<15家正常, >15家扣分) (25%)
    "max_consecutive_boards": 0.25,# 连板最高高度与炸板率 (25%)
    "advance_decline_ratio": 0.15, # 全市场红盘上涨家数占比 (15%)
}

# 4-Factor Percentile Scoring Model (四大因子打分模型 - 总分100)
# TUNED on 2026-09-17 (9/1-9/16 88只样本回测):
#   - 连板情绪因子差值 +6.58 (最有效), 维持 0.35
#   - 板块共振因子差值 +4.35 (第二有效), 权重 0.20 → 0.25
#   - 筹码结构因子差值 +0.50 (近乎失效), 权重 0.30 → 0.25
#   - 封板强度因子差值 +2.35 (弱正向), 维持 0.15
FACTOR_WEIGHTS: Dict[str, float] = {
    "consecutive_board_sentiment": 0.35, # 1. 连板阶梯与情绪联动 (35%)
    "seal_strength":               0.15, # 2. 封板强度因子 (15%)
    "chip_structure":              0.25, # 3. 筹码结构与炸板惩罚 (25%) — 回测显示区分度不足, 降权
    "sector_resonance":            0.25, # 4. 板块共振因子 (25%) — 回测验证有效, 提权
}

# High-board height decay: 从第 5 板后开始衰减，每多 1 板衰减 50%
# TUNED on 2026-09-17 (9/1-9/16 回测):
#   - 5板 2/4=50% 晋级率，不衰减
#   - 6板 0/2=0%、7板 0/1=0% 晋级率，需强衰减
# 原 START=5/RATE=0.70 衰减力度不足 → START=5/RATE=0.50 (6板砍半, 7板砍至1/4)
BOARD_HEIGHT_DECAY_START: int = 5
BOARD_HEIGHT_DECAY_RATE: float = 0.50

# Intraday Execution & Risk Control (防洗盘卖出与买入风控)
SKIP_ONE_WORD_ZT_OPEN_PCT: float = 9.80   # 一字涨停不可买入过滤 (开盘涨幅 >= 9.8%)
SKIP_WEAK_OPEN_PCT: float = -2.50         # 弱开盘放弃过滤 — 从-4.5收紧到-2.5:
                                          #   低开 -2.5% 已经说明不及预期（8-24 圣达/和远/双鹭 都是 -1.9~-2.1 低开, 当日全部-10跌停/大跌）
SKIP_HIGH_CHASE_OPEN_PCT: float = 6.00    # 追高开盘过滤 NEW: 高开 ≥ +6% 直接跳过, 避免高开低走接盘

# --- 【新增 1】竞价量能风控 ---
MIN_OPENING_AMOUNT: float = 10_000_000.0  # 竞价买入最低成交额要求（千万级别），无量不接力

# Intraday entry filters for breakout-retest and strong-pullback strategies
REBREAK_LIMIT_TOLERANCE_PCT: float = 0.20

# --- 【新增 2】炸板回封动能风控 ---
REBREAK_MIN_VOL_RATIO: float = 1.20       # 回封买入时盘中量比要求（要求量比>1.2倍，确认有资金承接）

PULLBACK_MIN_CHANGE_PCT: float = 2.00
PULLBACK_MAX_CHANGE_PCT: float = 6.00
PULLBACK_FROM_HIGH_PCT: float = 1.50

# Global portfolio-level buy kill-switches (NEW): a bad tape day should halt
# ALL new position entries, even if individual stocks look fine.
SKIP_BUY_IF_INDEX_OPEN_PCT_BELOW: float = -1.00   # 指数低开 < -1.0% → 视为系统性弱势，今天不建仓
SKIP_BUY_IF_SENTIMENT_IN: set = {                 # 情绪处于弱势期 → 今天不建仓
    "退潮/弱势期",
    "熔断状态",
}

# --- 止盈止损模块优化 ---
TRAILING_STOP_PCT: float = 0.025         # (保留该变量作为基础/兜底策略) 移动止盈: 最高价回撤 2.5%

# --- 【新增 3】阶梯式移动止盈 ---
TRAILING_TIER1_PROFIT: float = 0.08      # 利润阶梯1: 盈利 > 8%
TRAILING_TIER1_STOP: float = 0.025       # 回撤阈值1: 从最高点回撤 2.5% 止盈（保住大部分利润）
TRAILING_TIER2_PROFIT: float = 0.04      # 利润阶梯2: 盈利 > 4%
TRAILING_TIER2_STOP: float = 0.04        # 回撤阈值2: 从最高点回撤 4.0% 止盈（给足洗盘空间）

HARD_STOP_PCT: float = -0.0413           # 防扫损硬止损: -4.13%
ANTI_SHAKEOUT_TIME_WINDOW_MINS: int = 3  # 连续 3 分钟未收回
ANTI_SHAKEOUT_VOLUME_RATIO: float = 2.0  # 爆量 2.0x 过去 20 分钟均量

# --- 【新增 4】盘中炸板超时即时风控 ---
BROKEN_ZT_EXIT_MINS: int = 5             # 炸板后超过 5 分钟未回封，强制平仓出局

T2_FORCED_EXIT_TIME: str = "14:45"       # T+2 尾盘强制平仓时间

# --- Iteration / Self-Tuning Parameter Thresholds (IterationEngine reads these for config_diff.current_value) ---
# If a parameter is managed by percentile scoring rather than an absolute threshold,
# set it to None so iteration reports "no absolute threshold configured" instead of inventing a number.
LIMIT_SEAL_RATIO_THRESHOLD: Optional[float] = None  # 首板封单占比门槛: None = 使用百分位动态打分, 不设固定阈值
OPEN_TURNOVER_RATE_THRESHOLD: Optional[float] = None  # 开盘换手率下限: None = 使用百分位动态打分, 不设固定阈值