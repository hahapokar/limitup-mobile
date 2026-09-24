"""
A-Share Trading Calendar & Date Normalization Utility.
Utilizes chinese_calendar to determine non-trading days, weekends, and holidays.
"""

import datetime
from typing import Union, List

try:
    import chinese_calendar as cc
    HAS_CC = True
except ImportError:
    cc = None
    HAS_CC = False

# 自定义 A 股休市日（chinese_calendar 库可能未覆盖 2026 年假日）
CUSTOM_HOLIDAYS = {
    # 2026 年中秋节（9/25 周五；9/26-27 周末自动排除）
    datetime.date(2026, 9, 25),
    # 2026 年国庆节（10/1-10/7；10/3-4 周末自动排除）
    datetime.date(2026, 10, 1),
    datetime.date(2026, 10, 2),
    datetime.date(2026, 10, 5),
    datetime.date(2026, 10, 6),
    datetime.date(2026, 10, 7),
}


def parse_date(date_input: Union[str, datetime.date, datetime.datetime]) -> datetime.date:
    """Parse date string YYYY-MM-DD or YYYYMMDD to datetime.date."""
    if isinstance(date_input, datetime.datetime):
        return date_input.date()
    if isinstance(date_input, datetime.date):
        return date_input
    
    clean_str = str(date_input).strip().replace("/", "-")
    if len(clean_str) == 8 and clean_str.isdigit():
        return datetime.datetime.strptime(clean_str, "%Y%m%d").date()
    return datetime.datetime.strptime(clean_str[:10], "%Y-%m-%d").date()


def format_date(d: datetime.date, fmt: str = "%Y-%m-%d") -> str:
    """Format date to standard string."""
    return d.strftime(fmt)


def is_trade_day(target_date: Union[str, datetime.date]) -> bool:
    """
    Determine if a given date is an active A-share trading day.
    Conditions: Monday-Friday (weekday 0-4) AND not a public holiday.
    """
    d = parse_date(target_date)
    # A-share markets are closed on weekends even if it's a compensated workday in China
    if d.weekday() >= 5:
        return False
    # Check custom holidays first (covers 2026 when chinese_calendar doesn't)
    if d in CUSTOM_HOLIDAYS:
        return False
    # Check public holidays via chinese_calendar
    if HAS_CC and cc is not None:
        try:
            if cc.is_holiday(d):
                return False
        except Exception:
            pass
    return True


def normalize_to_trade_day(target_date: Union[str, datetime.date]) -> str:
    """
    If target_date is not a trading day (e.g., weekend/holiday),
    roll backwards to find the most recent valid A-share trading day.
    """
    d = parse_date(target_date)
    curr = d
    while not is_trade_day(curr):
        curr -= datetime.timedelta(days=1)
    return format_date(curr)


def get_prev_trade_day(target_date: Union[str, datetime.date]) -> str:
    """Get the trading day strictly before the given date."""
    d = parse_date(target_date)
    curr = d - datetime.timedelta(days=1)
    while not is_trade_day(curr):
        curr -= datetime.timedelta(days=1)
    return format_date(curr)


def get_next_trade_day(target_date: Union[str, datetime.date]) -> str:
    """Get the trading day strictly after the given date."""
    d = parse_date(target_date)
    curr = d + datetime.timedelta(days=1)
    while not is_trade_day(curr):
        curr += datetime.timedelta(days=1)
    return format_date(curr)


def get_trade_days_range(start_date: Union[str, datetime.date], end_date: Union[str, datetime.date]) -> List[str]:
    """Return all valid trading days between start_date and end_date inclusive."""
    s = parse_date(start_date)
    e = parse_date(end_date)
    curr = s
    result = []
    while curr <= e:
        if is_trade_day(curr):
            result.append(format_date(curr))
        curr += datetime.timedelta(days=1)
    return result
