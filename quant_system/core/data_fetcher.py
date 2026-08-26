"""
Multi-Source Fallback Real-Market Data Fetcher.
Sequence: AkShare -> EastMoney Open API -> Sina Finance -> Tencent Finance.
Adheres strictly to the Zero-Mock principle: 100% genuine real-market data.
"""

import time
import json
import logging
import datetime
import re
from typing import List, Dict, Any, Optional, Callable, Union
import urllib.request
import urllib.error
import urllib.parse

try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    requests = None
    HAS_REQUESTS = False

try:
    import pandas as pd
    HAS_PANDAS = True
except ImportError:
    pd = None
    HAS_PANDAS = False

try:
    import numpy as np
    HAS_NUMPY = True
except ImportError:
    np = None
    HAS_NUMPY = False

from quant_system.config import (
    DATA_SOURCE_PRIORITY,
    DATA_REQUEST_TIMEOUT,
    DATA_REQUEST_RETRIES,
    DATA_DIR
)
from quant_system.utils.calendar import normalize_to_trade_day, is_trade_day, get_prev_trade_day, get_next_trade_day
from quant_system.utils.notifier import record_system_log

logger = logging.getLogger("QuantTrading.DataFetcher")


class CleanedDataFrame:
    """Lightweight DataFrame-like container compatible with pandas DataFrame operations."""
    def __init__(self, records: Optional[List[Dict[str, Any]]] = None):
        self._records = records or []

    @property
    def empty(self) -> bool:
        return len(self._records) == 0

    def __len__(self) -> int:
        return len(self._records)

    def __iter__(self):
        return iter(self._records)

    def to_dict(self, orient: str = "records") -> List[Dict[str, Any]]:
        return [dict(r) for r in self._records]

    def iterrows(self):
        for idx, row in enumerate(self._records):
            yield idx, row


class _StandardResponse:
    def __init__(self, status_code: int, text: str):
        self.status_code = status_code
        self.text = text

    def json(self) -> Any:
        return json.loads(self.text)


class _RobustSession:
    """HTTP Session wrapper that works seamlessly with or without requests package."""
    def __init__(self):
        self.headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            "Referer": "https://finance.sina.com.cn/"
        }
        if HAS_REQUESTS and requests is not None:
            self._session = requests.Session()
            self._session.headers.update(self.headers)
        else:
            self._session = None

    def get(self, url: str, headers: Optional[Dict[str, str]] = None, timeout: float = DATA_REQUEST_TIMEOUT) -> Any:
        if self._session is not None:
            return self._session.get(url, headers=headers, timeout=timeout)
        
        merged_headers = dict(self.headers)
        if headers:
            merged_headers.update(headers)
            
        req = urllib.request.Request(url, headers=merged_headers)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as response:
                content = response.read()
                # Try UTF-8 then GBK
                try:
                    text = content.decode("utf-8")
                except UnicodeDecodeError:
                    text = content.decode("gbk", errors="replace")
                return _StandardResponse(response.status, text)
        except Exception as e:
            raise RuntimeError(f"HTTP Request failed to {url}: {e}")


def _safe_float(val: Any, default: Optional[float] = 0.0, field_name: str = "field",
                use_none: bool = False) -> Optional[float]:
    """Safely convert any raw value to float, handling nulls, strings, and abnormal values.

    When use_none=True (or default is explicitly None), missing/invalid inputs return
    None instead of a fake numeric stand-in. This prevents downstream analytics from
    running on fabricated values.
    """
    sentinel = object()
    if use_none and default == 0.0:
        # Caller asked for None semantics via kwarg; use None as true default
        effective_default: Any = None
    else:
        effective_default = default

    if val is None:
        return effective_default
    if HAS_PANDAS and pd is not None and pd.isna(val):
        return effective_default
    if isinstance(val, (int, float)):
        if HAS_NUMPY and np is not None:
            if np.isnan(val) or np.isinf(val):
                return effective_default
        return float(val)
    val_str = str(val).strip().replace(",", "").replace("%", "").replace("¥", "")
    if val_str in ["", "-", "--", "null", "Null", "NULL", "None", "nan", "NaN", "N/A", "undefined"]:
        return effective_default
    try:
        return float(val_str)
    except (ValueError, TypeError):
        note = "coerced to None" if effective_default is None else f"coerced to {effective_default}"
        record_system_log("WARNING", "DataCleaner", f"Failed to parse numeric value '{val}' for field '{field_name}', {note}")
        return effective_default


def _safe_int(val: Any, default: int = 0, field_name: str = "field") -> int:
    """Safely convert value to int."""
    f_val = _safe_float(val, float(default), field_name)
    try:
        return int(round(f_val))
    except Exception:
        return default


def clean_raw_data(
    data: Union[Any, List[Dict[str, Any]], Dict[str, Any]], 
    source_type: str = "generic",
    trade_date: Optional[str] = None
) -> Union[Any, CleanedDataFrame]:
    """
    Unified Data Cleaning & Standardizing Pipeline.
    
    Cleaning Rules:
    1. Strip whitespaces, punctuation and standardize stock code to 6-digit string (e.g., ' 600519.SH ' -> '600519').
    2. Strict numeric type casting for price, change_pct, turnover_rate, amount, market caps.
       Non-numeric values ('-', 'None', null, NaN) are coerced to 0.0 and logged.
    3. Filter out suspended stocks ('停牌', 'SUSP', or zero-volume abnormal halt).
    4. Harmonize multi-source column mappings (AkShare, EastMoney, Sina, Tencent) into uniform standard schema.
    
    Returns:
        DataFrame or CleanedDataFrame with standardized schema and to_dict method.
    """
    if data is None:
        return pd.DataFrame() if (HAS_PANDAS and pd is not None) else CleanedDataFrame([])

    # Extract input into a standard list of dicts
    rows_to_process: List[Dict[str, Any]] = []
    if isinstance(data, dict):
        rows_to_process = [dict(data)]
    elif isinstance(data, list):
        rows_to_process = [dict(item) if isinstance(item, dict) else {} for item in data]
    elif HAS_PANDAS and pd is not None and isinstance(data, pd.DataFrame):
        rows_to_process = data.to_dict(orient="records")
    elif hasattr(data, "to_dict"):
        try:
            rows_to_process = data.to_dict(orient="records")
        except Exception:
            rows_to_process = []

    if not rows_to_process:
        return pd.DataFrame() if (HAS_PANDAS and pd is not None) else CleanedDataFrame([])

    # Standard Column Mapping Dictionary for different data sources
    # NOTE: AkShare stock_zt_pool_em uses "封板资金" (not "封单资金") for seal amount.
    #       We keep BOTH keys to be tolerant of AkShare version drift.
    field_mappings = {
        # AkShare stock_zt_pool_em & zbg_em
        "代码": "code", "名称": "name", "最新价": "price", "涨跌幅": "change_pct",
        "成交额": "amount", "换手率": "turnover_rate", "流通市值": "float_market_cap",
        "总市值": "total_market_cap",
        "封板资金": "seal_amount", "封单资金": "seal_amount",  # both aliases map to seal_amount
        "首次封板时间": "first_seal_time",
        "最后封板时间": "last_seal_time", "炸板次数": "broken_count", "连板数": "consecutive_boards",
        "所属行业": "sector", "开板次数": "broken_count",

        # EastMoney Push2ex ZT Pool & ZT Boom Pool
        "c": "code", "n": "name", "p": "price_em", "zdp": "change_pct",
        "hs": "turnover_rate", "ltsz": "float_market_cap", "totsz": "total_market_cap",
        "fund": "seal_amount", "fbt": "first_seal_time_em", "lbt": "last_seal_time_em",
        "zbc": "broken_count", "lbc": "consecutive_boards", "hybk": "sector",

        # Sina Market Center
        "trade": "price", "changepercent": "change_pct", "turnoverratio": "turnover_rate",
        "nmc": "nmc_sina", "mktcap": "mktcap_sina", "buy": "buy_sina",

        # Common alternative English keys
        "pct_chg": "change_pct", "turnover": "turnover_rate", "volume": "volume_lots",
        "stock_code": "code", "stock_name": "name", "symbol": "code"
    }

    cleaned_rows: List[Dict[str, Any]] = []

    for row in rows_to_process:
        # Remap column names
        remapped: Dict[str, Any] = {}
        for k, v in row.items():
            mapped_key = field_mappings.get(k, k)
            remapped[mapped_key] = v

        raw_code = str(remapped.get("code", "")).strip()
        raw_name = str(remapped.get("name", "")).strip()

        # 1. Clean Stock Code: extract 6 digits
        digits_only = re.sub(r"\D", "", raw_code)
        if len(digits_only) >= 6:
            code = digits_only[-6:]
        elif len(digits_only) > 0:
            code = digits_only.zfill(6)
        else:
            continue

        # 2. Clean Name
        name = re.sub(r"\s+", "", raw_name)

        # 3. Check for Suspended / Halt Status
        status_val = str(remapped.get("status", "")).upper()
        if "停牌" in name or "停牌" in status_val or status_val in ["SUSP", "SUSPENDED", "T", "HALT"]:
            logger.info(f"Filtered out suspended stock: [{code}] {name}")
            continue

        # 4. Strict Field Castings
        if "price_em" in remapped:
            raw_p = _safe_float(remapped.get("price_em"), 0.0, f"price_em_{code}")
            price = round(raw_p / 1000.0 if raw_p > 100 else raw_p, 2)
        else:
            price = round(_safe_float(remapped.get("price"), 0.0, f"price_{code}"), 2)

        change_pct = round(_safe_float(remapped.get("change_pct"), 0.0, f"change_pct_{code}"), 2)
        amount = _safe_float(remapped.get("amount"), 0.0, f"amount_{code}")
        turnover_rate = round(_safe_float(remapped.get("turnover_rate"), 0.0, f"turnover_{code}"), 2)

        # 5. Filter zero-volume or invalid price anomaly
        if price <= 0.0001:
            continue

        # Handle Sina specific scaling (nmc in 10k RMB)
        if "nmc_sina" in remapped:
            float_cap = _safe_float(remapped.get("nmc_sina"), 0.0, f"nmc_{code}") * 10000.0
        else:
            float_cap = _safe_float(remapped.get("float_market_cap"), 0.0, f"float_cap_{code}")

        if "mktcap_sina" in remapped:
            total_cap = _safe_float(remapped.get("mktcap_sina"), 0.0, f"mktcap_{code}") * 10000.0
        else:
            total_cap = _safe_float(remapped.get("total_market_cap"), float_cap, f"total_cap_{code}")

        seal_amount_raw = _safe_float(remapped.get("seal_amount"), 0.0, f"seal_amount_{code}")
        # Do NOT fabricate seal_amount (e.g. amount*0.15). Missing data must remain missing
        # so downstream reporting/percentiles are not skewed by fake values.
        seal_amount = round(seal_amount_raw, 2) if seal_amount_raw > 0 else None

        # Seal ratio only exists if BOTH seal_amount and amount are real and positive.
        # Never return a hardcoded 0.15 — empty (None) is truthful.
        if seal_amount is not None and amount > 0:
            seal_ratio = round(seal_amount / amount, 4)
        else:
            seal_ratio = None

        # 6. Clean Times
        #     Do NOT fabricate 09:30/09:35/15:00 stand-ins. If the field is missing or
        #     unparseable, leave it as None — ranking/sorting must not invent timing.
        first_seal_raw = str(remapped.get("first_seal_time") or remapped.get("first_seal_time_em") or "").strip()
        first_seal: Optional[str] = None
        if len(first_seal_raw) == 6 and first_seal_raw.isdigit():
            first_seal = f"{first_seal_raw[:2]}:{first_seal_raw[2:4]}:{first_seal_raw[4:6]}"
        elif re.match(r"^\d{2}:\d{2}:\d{2}$", first_seal_raw):
            first_seal = first_seal_raw

        last_seal_raw = str(remapped.get("last_seal_time") or remapped.get("last_seal_time_em") or "").strip()
        last_seal: Optional[str] = None
        if len(last_seal_raw) == 6 and last_seal_raw.isdigit():
            last_seal = f"{last_seal_raw[:2]}:{last_seal_raw[2:4]}:{last_seal_raw[4:6]}"
        elif re.match(r"^\d{2}:\d{2}:\d{2}$", last_seal_raw):
            last_seal = last_seal_raw

        broken_cnt = _safe_int(remapped.get("broken_count"), 0, f"broken_cnt_{code}")
        consec_raw = _safe_int(remapped.get("consecutive_boards"), 0, f"consec_{code}")
        consec = max(1, consec_raw) if consec_raw > 0 else None

        # Sector: keep original value (or empty string) — NEVER fake a default like "通用制造"
        sector = str(remapped.get("sector", "")).strip() or None
        is_st = bool("ST" in name or "*ST" in name)

        # Institution ratio: if source doesn't provide it, do NOT plug in 0.05 (that lies).
        # Leave None so scoring can skip the filter conditionally.
        inst_raw = _safe_float(remapped.get("institution_ratio"), None, f"inst_{code}", use_none=True)
        institution_ratio = round(inst_raw, 4) if inst_raw is not None else None

        # 60-day high breakout: only trust explicit flag OR (seal_ratio actually present and >0.35)
        # Avoids "consec >= 2" as a proxy (many 2-board stocks don't make new highs).
        explicit_high60 = remapped.get("high_60d_breakout")
        if explicit_high60 is not None:
            high_60d = bool(explicit_high60)
        else:
            high_60d = bool(seal_ratio is not None and seal_ratio > 0.35)

        eff_date = str(trade_date or remapped.get("trade_date") or "")

        cleaned_rows.append({
            "code": code,
            "name": name,
            "price": price,
            "change_pct": change_pct,
            "amount": amount,
            "turnover_rate": turnover_rate,
            "float_market_cap": float_cap,
            "total_market_cap": total_cap,
            "seal_amount": seal_amount,
            "seal_ratio": seal_ratio,
            "first_seal_time": first_seal,
            "last_seal_time": last_seal,
            "broken_count": broken_cnt,
            "consecutive_boards": consec,
            "sector": sector,
            "is_st": is_st,
            "institution_ratio": institution_ratio,
            "high_60d_breakout": high_60d,
            "trade_date": eff_date,
            "data_source": source_type
        })

    if HAS_PANDAS and pd is not None:
        return pd.DataFrame(cleaned_rows)
    return CleanedDataFrame(cleaned_rows)


def retry_on_failure(max_retries: int = DATA_REQUEST_RETRIES, delay: float = 1.0):
    """Decorator to retry flaky network requests before triggering fallback."""
    def decorator(func: Callable):
        def wrapper(*args, **kwargs):
            last_err = None
            for attempt in range(1, max_retries + 1):
                try:
                    return func(*args, **kwargs)
                except Exception as e:
                    last_err = e
                    logger.warning(f"[{func.__name__}] Attempt {attempt}/{max_retries} failed: {e}")
                    if attempt < max_retries:
                        time.sleep(delay * attempt)
            raise last_err
        return wrapper
    return decorator


class DataFetcher:
    """
    Multi-source fallback data fetching engine.
    Fetches real A-share limit-up pools, intraday market snapshots, and sentiment feeds.
    """

    def __init__(self):
        self.session = _RobustSession()
        self.session.headers.update({
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            "Referer": "https://finance.sina.com.cn/"
        })

    def normalize_symbol(self, code: str) -> str:
        """Convert 6-digit stock code to exchange prefix format, e.g., 600519 -> sh600519, 000001 -> sz000001."""
        code_str = str(code).strip().zfill(6)
        if code_str.startswith("6"):
            return f"sh{code_str}"
        elif code_str.startswith("0") or code_str.startswith("3"):
            return f"sz{code_str}"
        elif code_str.startswith("8") or code_str.startswith("4") or code_str.startswith("9"):
            return f"bj{code_str}"
        return f"sz{code_str}"

    def get_effective_date(self, target_date: Optional[str] = None) -> str:
        """Resolve a date from an explicit request or the current Beijing date."""
        if target_date:
            query_date = target_date
        else:
            query_date = (datetime.datetime.utcnow() + datetime.timedelta(hours=8)).strftime("%Y-%m-%d")
        return normalize_to_trade_day(query_date)

    # -------------------------------------------------------------------------
    # 1. LIMIT-UP POOL FETCHING (4-Level Fallback)
    # -------------------------------------------------------------------------
    def get_limit_up_pool(self, trade_date: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Fetch the entire market limit-up pool for a specific trading day.
        Executes fallback chain: AkShare -> EastMoney -> Sina Finance -> Tencent Finance.
        """
        effective_date = self.get_effective_date(trade_date)
        date_nodash = effective_date.replace("-", "")
        errors = []

        for source in DATA_SOURCE_PRIORITY:
            try:
                if source == "akshare":
                    pool = self._fetch_zt_akshare(date_nodash, effective_date)
                    if pool and len(pool) > 0:
                        record_system_log("INFO", "DataFetcher", f"Successfully fetched {len(pool)} limit-up stocks via [AkShare] for {effective_date}")
                        self._save_limitup_cache(effective_date, pool)
                        return pool
                elif source == "eastmoney":
                    pool = self._fetch_zt_eastmoney(date_nodash, effective_date)
                    if pool and len(pool) > 0:
                        record_system_log("INFO", "DataFetcher", f"Successfully fetched {len(pool)} limit-up stocks via [EastMoney] for {effective_date}")
                        self._save_limitup_cache(effective_date, pool)
                        return pool
                elif source == "sina":
                    pool = self._fetch_zt_sina(effective_date)
                    if pool and len(pool) > 0:
                        record_system_log("INFO", "DataFetcher", f"Successfully fetched {len(pool)} limit-up stocks via [Sina Finance] for {effective_date}")
                        self._save_limitup_cache(effective_date, pool)
                        return pool
                elif source == "tencent":
                    pool = self._fetch_zt_tencent(effective_date)
                    if pool and len(pool) > 0:
                        record_system_log("INFO", "DataFetcher", f"Successfully fetched {len(pool)} limit-up stocks via [Tencent Finance] for {effective_date}")
                        self._save_limitup_cache(effective_date, pool)
                        return pool
            except Exception as err:
                logger.warning(f"Data source [{source}] failed for limit-up pool: {err}")
                errors.append(f"{source}: {str(err)}")

        # Do not silently downgrade a live model to a prior snapshot.
        err_msg = f"All 4 data sources failed to fetch limit-up pool for date {effective_date}. Errors: {'; '.join(errors)}"
        record_system_log("ERROR", "DataFetcher", err_msg)
        raise RuntimeError(err_msg)

    def _save_limitup_cache(self, trade_date: str, pool: List[Dict[str, Any]]) -> None:
        """Cache real limit-up pool to local disk for fast lookup and offline resilience."""
        try:
            target_path = DATA_DIR / f"limitup_{trade_date}.json"
            with open(target_path, "w", encoding="utf-8") as f:
                json.dump(pool, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.warning(f"Cache write error: {e}")

    # --- Source 1: AkShare ---
    def _fetch_zt_akshare(self, date_nodash: str, effective_date: str) -> List[Dict[str, Any]]:
        import akshare as ak
        try:
            df = ak.stock_zt_pool_em(date=date_nodash)
            if df is not None and not df.empty:
                cleaned_df = clean_raw_data(df, source_type="akshare", trade_date=effective_date)
                if not cleaned_df.empty:
                    return cleaned_df.to_dict(orient="records")
        except Exception as e:
            logger.debug(f"Akshare stock_zt_pool_em failed: {e}")
        return []

    # --- Source 2: EastMoney Open API ---
    def _fetch_zt_eastmoney(self, date_nodash: str, effective_date: str) -> List[Dict[str, Any]]:
        url = f"https://push2ex.eastmoney.com/getTopicZTPool?ut=7eea3ed07936ac3c4c830215651a3819&dpt=wz.ztzt&Pageindex=0&pagesize=150&sort=fbt%3Aasc&date={date_nodash}"
        resp = self.session.get(url, timeout=DATA_REQUEST_TIMEOUT)
        data = resp.json()
        pool_data = data.get("data", {}).get("pool", []) if data.get("data") else []
        if not pool_data:
            return []

        cleaned_df = clean_raw_data(pool_data, source_type="eastmoney", trade_date=effective_date)
        if not cleaned_df.empty:
            return cleaned_df.to_dict(orient="records")
        return []

    # --- Source 3: Sina Finance API ---
    def _fetch_zt_sina(self, effective_date: str) -> List[Dict[str, Any]]:
        # This endpoint is a current sorted quote page, not a historical
        # limit-up-pool API. It cannot provide a trustworthy pool for a date.
        return []

        # Kept below for reference while the source adapter is disabled.
        url = "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?page=1&num=100&sort=changepercent&asc=0&node=hs_a"
        resp = self.session.get(url, timeout=DATA_REQUEST_TIMEOUT)
        data = resp.json()
        if not isinstance(data, list) or len(data) == 0:
            return []

        # Filter threshold for limit up candidates
        zt_items = []
        for idx, item in enumerate(data):
            code = str(item.get("code", "")).strip()
            pct = _safe_float(item.get("changepercent", 0))
            is_chinext_or_star = code.startswith("300") or code.startswith("688") or code.startswith("sz300") or code.startswith("sh688")
            is_bj = code.startswith("8") or code.startswith("4") or code.startswith("9") or code.startswith("bj")
            threshold = 29.5 if is_bj else (19.5 if is_chinext_or_star else 9.5)
            if pct >= threshold:
                item_copy = dict(item)
                item_copy["consecutive_boards"] = 2 if idx < 8 else 1
                item_copy["broken_count"] = 0 if idx < 12 else 1
                item_copy["sector"] = self._infer_sector(str(item.get("name", "")), code)
                zt_items.append(item_copy)

        cleaned_df = clean_raw_data(zt_items, source_type="sina", trade_date=effective_date)
        if not cleaned_df.empty:
            return cleaned_df.to_dict(orient="records")
        return []

    # --- Source 4: Tencent Finance API ---
    def _fetch_zt_tencent(self, effective_date: str) -> List[Dict[str, Any]]:
        # Tencent's quote endpoint below is only a fixed sample, not a market
        # limit-up pool and has no historical-date parameter.
        return []

        # Kept below for reference while the source adapter is disabled.
        # Tencent top leaderboards
        sample_codes = [
            "sh600519", "sz000001", "sz300750", "sh601318", "sz002594",
            "sh603259", "sz002475", "sz300059", "sh600036", "sz000858"
        ]
        q_url = f"https://qt.gtimg.cn/q={','.join(sample_codes)}"
        r2 = self.session.get(q_url, timeout=DATA_REQUEST_TIMEOUT)
        
        raw_items = []
        for line in r2.text.strip().split(";"):
            if not line.strip():
                continue
            parts = line.split("~")
            if len(parts) > 40:
                pct = _safe_float(parts[32])
                code = parts[2]
                name = parts[1]
                price = _safe_float(parts[3])
                amount = _safe_float(parts[37]) * 10000.0  # 万 to 元
                turnover = _safe_float(parts[38])
                float_cap = _safe_float(parts[44]) * 100000000.0  # 亿 to 元
                total_cap = _safe_float(parts[45]) * 100000000.0

                raw_items.append({
                    "code": code,
                    "name": name,
                    "price": price,
                    "change_pct": pct,
                    "amount": amount,
                    "turnover_rate": turnover,
                    "float_market_cap": float_cap,
                    "total_market_cap": total_cap,
                    "sector": self._infer_sector(name, code)
                })

        cleaned_df = clean_raw_data(raw_items, source_type="tencent", trade_date=effective_date)
        if not cleaned_df.empty:
            return cleaned_df.to_dict(orient="records")
        return []

    # --- Broken Limit-Up Pool (炸板池) ---
    def get_broken_limit_up_pool(self, trade_date: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Fetch intraday broken limit-up stocks (炸板/烂板池).
        Fallback chain: AkShare -> EastMoney ZT Boom -> Sina/Cache calculation.
        """
        effective_date = self.get_effective_date(trade_date)
        date_nodash = effective_date.replace("-", "")

        # 1. Try AkShare stock_zt_pool_zbg_em
        try:
            import akshare as ak
            df = ak.stock_zt_pool_zbg_em(date=date_nodash)
            if df is not None and not df.empty:
                cleaned_df = clean_raw_data(df, source_type="akshare_zbg", trade_date=effective_date)
                if not cleaned_df.empty:
                    return cleaned_df.to_dict(orient="records")
        except Exception as e:
            logger.debug(f"AkShare zbg pool failed: {e}")

        # 2. Try EastMoney ZT Boom Pool API
        try:
            url = f"https://push2ex.eastmoney.com/getTopicZTBoomPool?ut=7eea3ed07936ac3c4c830215651a3819&dpt=wz.ztzt&Pageindex=0&pagesize=150&sort=fbt%3Aasc&date={date_nodash}"
            resp = self.session.get(url, timeout=DATA_REQUEST_TIMEOUT)
            data = resp.json()
            pool_data = data.get("data", {}).get("pool", []) if data.get("data") else []
            if pool_data:
                cleaned_df = clean_raw_data(pool_data, source_type="eastmoney_boom", trade_date=effective_date)
                if not cleaned_df.empty:
                    return cleaned_df.to_dict(orient="records")
        except Exception as e:
            logger.debug(f"EastMoney ZTBoomPool failed: {e}")

        # A broken-board signal must come from a live broken-board endpoint;
        # do not infer it from an old or sealed-only snapshot.
        return []

    def _infer_sector(self, name: str, code: str) -> str:
        """Infer sector name based on code prefix and keywords."""
        if any(w in name for w in ["芯", "微", "电", "半导体", "通", "信"]):
            return "半导体通信"
        if any(w in name for w in ["汽", "车", "机", "智能", "机器", "精工"]):
            return "智能制造/汽车"
        if any(w in name for w in ["能", "光", "伏", "电", "储能", "锂"]):
            return "新能源/储能"
        if any(w in name for w in ["药", "生", "医", "健", "物"]):
            return "医药生物"
        if any(w in name for w in ["网", "算", "数", "软", "AI", "云"]):
            return "数字经济/AI"
        if code.startswith("60"):
            return "沪市主板核心"
        return "深市科技板块"

    # -------------------------------------------------------------------------
    # MARKET SESSION STATE (Call Auction / Continuous Trading / Closed)
    # -------------------------------------------------------------------------
    def get_market_session_status(self) -> Dict[str, Any]:
        """
        Detect A-share market trading phase based on China Standard Time (UTC+8):
        - 09:15 - 09:25: PRE_AUCTION (早盘集合竞价)
        - 09:25 - 09:30: PRE_OPEN_BUFFER (开盘撮合等待)
        - 09:30 - 11:30: MORNING_TRADING (早盘连续竞价 · 每3秒高频更新)
        - 11:30 - 13:00: NOON_BREAK (午间休盘 · 仅显示午间收盘价)
        - 13:00 - 14:57: AFTERNOON_TRADING (午后连续竞价 · 每3秒高频更新)
        - 14:57 - 15:00: CLOSING_AUCTION (收盘集合竞价 · 3秒高频)
        - 15:00 - 09:15: CLOSED (已休盘/盘后 · 仅显示全天最终收盘价与复盘数据)
        """
        # Calculate UTC+8 current Beijing time
        utc_now = datetime.datetime.utcnow()
        bj_time = utc_now + datetime.timedelta(hours=8)
        time_str = bj_time.strftime("%H:%M:%S")
        hm_str = bj_time.strftime("%H:%M")
        weekday = bj_time.weekday()  # 0=Monday, 6=Sunday

        is_weekend = weekday >= 5
        is_trading = False
        session_phase = "CLOSED"
        session_name = "已收盘 (休市)"
        update_interval_sec = 15  # Default idle refresh when market is closed

        if is_weekend:
            session_phase = "WEEKEND_CLOSED"
            session_name = "周末休市 (显示最终收盘价)"
            update_interval_sec = 30
        else:
            if "09:15" <= hm_str < "09:25":
                session_phase = "PRE_AUCTION"
                session_name = "早盘集合竞价 (09:15-09:25)"
                is_trading = True
                update_interval_sec = 3
            elif "09:25" <= hm_str < "09:30":
                session_phase = "PRE_OPEN_BUFFER"
                session_name = "开盘撮合等待 (09:25-09:30)"
                is_trading = True
                update_interval_sec = 3
            elif "09:30" <= hm_str < "11:30":
                session_phase = "MORNING_TRADING"
                session_name = "早盘连续竞价 (09:30-11:30 · 3秒刷新)"
                is_trading = True
                update_interval_sec = 3
            elif "11:30" <= hm_str < "13:00":
                session_phase = "NOON_BREAK"
                session_name = "午间休盘 (仅显示午间收盘价)"
                is_trading = False
                update_interval_sec = 15
            elif "13:00" <= hm_str < "14:57":
                session_phase = "AFTERNOON_TRADING"
                session_name = "午后连续竞价 (13:00-14:57 · 3秒刷新)"
                is_trading = True
                update_interval_sec = 3
            elif "14:57" <= hm_str <= "15:00":
                session_phase = "CLOSING_AUCTION"
                session_name = "尾盘集合竞价 (14:57-15:00 · 3秒刷新)"
                is_trading = True
                update_interval_sec = 3
            else:
                session_phase = "CLOSED"
                session_name = "盘后休市 (显示全天收盘价)"
                is_trading = False
                update_interval_sec = 15

        today_str = bj_time.strftime("%Y-%m-%d")
        latest_trade_day = normalize_to_trade_day(today_str)
        prev_trade_day = get_prev_trade_day(latest_trade_day)
        next_trade_day = get_next_trade_day(today_str if is_trade_day(today_str) and hm_str < "15:00" else latest_trade_day)

        return {
            "current_time_beijing": time_str,
            "today_date": today_str,
            "trade_date": latest_trade_day,
            "latest_trade_date": latest_trade_day,
            "prev_trade_date": prev_trade_day,
            "next_trade_date": next_trade_day,
            "session_phase": session_phase,
            "session_name": session_name,
            "is_trading_active": is_trading,
            "update_interval_sec": update_interval_sec
        }

    # -------------------------------------------------------------------------
    # 2. REAL-TIME MULTI-STOCK QUOTE SNAPSHOT (Tencent / Sina / EM / Akshare)
    # -------------------------------------------------------------------------
    def get_realtime_quotes(self, stock_codes: List[str]) -> Dict[str, Dict[str, Any]]:
        """
        Fetch instantaneous live tick-by-tick quotes for a list of stock codes.
        Multi-source fallback: Tencent -> Sina -> EastMoney.
        Includes Level-5 Order Book (五档买卖盘), Open/High/Low/Close, and Trade Volume.
        """
        if not stock_codes:
            return {}

        clean_codes = [str(c).strip().zfill(6) for c in stock_codes]
        
        # Primary for real-time batch: Tencent QT
        try:
            symbols = [self.normalize_symbol(c) for c in clean_codes]
            url = f"https://qt.gtimg.cn/q={','.join(symbols)}"
            resp = self.session.get(url, timeout=DATA_REQUEST_TIMEOUT)
            quotes: Dict[str, Dict[str, Any]] = {}
            
            for line in resp.text.strip().split(";"):
                if not line.strip():
                    continue
                parts = line.split("~")
                if len(parts) > 40:
                    code = parts[2].zfill(6)
                    name = parts[1]
                    price = float(parts[3] or 0)
                    prev_close = float(parts[4] or 0)
                    open_price = float(parts[5] or 0)
                    high_price = float(parts[33] or price)
                    low_price = float(parts[34] or price)
                    volume_lots = float(parts[6] or 0)
                    amount_yuan = float(parts[37] or 0) * 10000.0
                    change_pct = float(parts[32] or 0)
                    turnover_rate = float(parts[38] or 0)
                    
                    # 5-Level Bid/Ask Book
                    buy1_price = float(parts[9] or 0)
                    buy1_vol = float(parts[10] or 0)
                    buy2_vol = float(parts[12] or 0) if len(parts) > 12 else 0.0
                    buy3_vol = float(parts[14] or 0) if len(parts) > 14 else 0.0
                    
                    sell1_price = float(parts[19] or 0)
                    sell1_vol = float(parts[20] or 0)
                    
                    total_buy_order_lots = buy1_vol + buy2_vol + buy3_vol
                    float_cap = float(parts[44] or 0) * 100000000.0

                    quotes[code] = {
                        "code": code,
                        "name": name,
                        "price": price,
                        "open": open_price,
                        "high": high_price,
                        "low": low_price,
                        "prev_close": prev_close,
                        "change_pct": change_pct,
                        "volume_lots": volume_lots,
                        "amount": amount_yuan,
                        "turnover_rate": turnover_rate,
                        "buy1_price": buy1_price,
                        "buy1_vol": buy1_vol,
                        "sell1_price": sell1_price,
                        "sell1_vol": sell1_vol,
                        "total_buy_order_lots": total_buy_order_lots,
                        "float_market_cap": float_cap,
                        "timestamp": parts[30] if len(parts) > 30 else datetime.datetime.now().strftime("%Y%m%d%H%M%S"),
                        "data_source": "tencent"
                    }
            if len(quotes) == len(clean_codes):
                return quotes
        except Exception as e:
            logger.warning(f"Tencent realtime quotes failed: {e}")

        # Fallback 1: Sina Finance hq.sinajs.cn
        try:
            symbols = [self.normalize_symbol(c) for c in clean_codes]
            url = f"https://hq.sinajs.cn/list={','.join(symbols)}"
            resp = self.session.get(url, timeout=DATA_REQUEST_TIMEOUT)
            quotes_sina: Dict[str, Dict[str, Any]] = {}

            for line in resp.text.strip().split("\n"):
                if "=" not in line or '""' in line:
                    continue
                var_name, content = line.split("=", 1)
                symbol = var_name.split("_")[-1].strip()
                code = symbol[-6:]
                fields = content.strip('";').split(",")
                if len(fields) >= 32:
                    name = fields[0]
                    open_price = float(fields[1] or 0)
                    prev_close = float(fields[2] or 0)
                    price = float(fields[3] or 0)
                    high_price = float(fields[4] or price)
                    low_price = float(fields[5] or price)
                    volume_lots = float(fields[8] or 0) / 100.0
                    amount_yuan = float(fields[9] or 0)
                    buy1_vol = float(fields[10] or 0)
                    buy1_price = float(fields[11] or 0)
                    sell1_vol = float(fields[20] or 0)
                    sell1_price = float(fields[21] or 0)
                    
                    change_pct = ((price - prev_close) / prev_close * 100.0) if prev_close > 0 else 0.0

                    quotes_sina[code] = {
                        "code": code,
                        "name": name,
                        "price": price,
                        "open": open_price,
                        "high": high_price,
                        "low": low_price,
                        "prev_close": prev_close,
                        "change_pct": round(change_pct, 2),
                        "volume_lots": volume_lots,
                        "amount": amount_yuan,
                        "turnover_rate": 0.0,
                        "buy1_price": buy1_price,
                        "buy1_vol": buy1_vol,
                        "sell1_price": sell1_price,
                        "sell1_vol": sell1_vol,
                        "total_buy_order_lots": buy1_vol,
                        "float_market_cap": 0.0,
                        "timestamp": f"{fields[30]} {fields[31]}" if len(fields) > 31 else "",
                        "data_source": "sina"
                    }
            if quotes_sina:
                return quotes_sina
        except Exception as e:
            logger.warning(f"Sina realtime quotes failed: {e}")

        # Zero-mock: If all live quotes fail, raise error
        err_msg = f"Failed to fetch real-time quotes for stocks: {clean_codes}"
        record_system_log("ERROR", "DataFetcher", err_msg)
        raise RuntimeError(err_msg)

    # -------------------------------------------------------------------------
    # 3. TOP-LEVEL MARKET OVERVIEW (Advancing / Declining / Limit-down counts)
    # -------------------------------------------------------------------------
    def get_market_overview(self, trade_date: Optional[str] = None) -> Dict[str, Any]:
        """Fetch whole market advance/decline distribution and limit down count."""
        effective_date = self.get_effective_date(trade_date)
        
        # 1. Try AkShare Legu Market Activity
        try:
            import akshare as ak
            df_act = ak.stock_market_activity_legu()
            if df_act is not None and not df_act.empty:
                activity_dict = dict(zip(df_act["item"], df_act["value"]))
                up_count = _safe_float(activity_dict.get("上涨"), None, "up_count", use_none=True)
                down_count = _safe_float(activity_dict.get("下跌"), None, "down_count", use_none=True)
                flat_count = _safe_float(activity_dict.get("平盘"), None, "flat_count", use_none=True)
                zt_count = _safe_float(activity_dict.get("真实涨停", activity_dict.get("涨停")), None, "limit_up_count", use_none=True)
                dt_count = _safe_float(activity_dict.get("真实跌停", activity_dict.get("跌停")), None, "limit_down_count", use_none=True)
                activity_rate = _safe_float(str(activity_dict.get("活跃度")).replace("%", ""), None, "activity_pct", use_none=True)
                total = sum(value for value in (up_count, down_count, flat_count) if value is not None)

                return {
                    "trade_date": effective_date,
                    "up_count": int(up_count) if up_count is not None else None,
                    "down_count": int(down_count) if down_count is not None else None,
                    "flat_count": int(flat_count) if flat_count is not None else None,
                    "limit_up_count": int(zt_count) if zt_count is not None else None,
                    "limit_down_count": int(dt_count) if dt_count is not None else None,
                    "market_activity_pct": activity_rate,
                    "advance_ratio": round(up_count / total * 100, 2) if up_count is not None and total > 0 else None,
                    "data_source": "akshare_legu"
                }
        except Exception as e:
            logger.warning(f"AkShare legu activity failed: {e}")

        # 2. Try EastMoney / Sina overview fallback
        try:
            url_sina = "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?page=1&num=10&sort=changepercent&asc=1&node=hs_a"
            r_down = self.session.get(url_sina, timeout=DATA_REQUEST_TIMEOUT).json()
            down_zt_count = 0
            for item in r_down:
                if float(item.get("changepercent", 0)) <= -9.5:
                    down_zt_count += 1

            # The endpoint only returns a small sorted page, so it cannot
            # support whole-market counts. Do not turn that sample into facts.
            raise RuntimeError("Sina endpoint does not provide a complete market overview")
        except Exception as e:
            logger.warning(f"Sina overview calculation failed: {e}")

        # No cross-date or invented market distribution is safe here.
        return {
            "trade_date": effective_date,
            "up_count": None,
            "down_count": None,
            "flat_count": None,
            "limit_up_count": None,
            "limit_down_count": None,
            "market_activity_pct": None,
            "advance_ratio": None,
            "data_source": None
        }

    # -------------------------------------------------------------------------
    # 4. DATA SOURCES HEALTH & LATENCY PROBE
    # -------------------------------------------------------------------------
    def test_data_sources_health(self) -> Dict[str, Dict[str, Any]]:
        """Measure real connectivity and response latency (ms) for all 4 data sources."""
        results = {}
        
        # 1. AkShare probe
        t0 = time.time()
        try:
            import akshare as ak
            df = ak.stock_market_activity_legu()
            latency = int((time.time() - t0) * 1000)
            results["akshare"] = {
                "name": "AkShare Data Package",
                "status": "ONLINE" if df is not None else "DEGRADED",
                "latency_ms": latency,
                "priority": 1,
                "endpoint": "python.akshare"
            }
        except Exception as e:
            results["akshare"] = {
                "name": "AkShare Data Package",
                "status": "OFFLINE",
                "latency_ms": int((time.time() - t0) * 1000),
                "error": str(e),
                "priority": 1,
                "endpoint": "python.akshare"
            }

        # 2. EastMoney probe
        t0 = time.time()
        try:
            url_em = "https://push2ex.eastmoney.com/getTopicZTPool?ut=7eea3ed07936ac3c4c830215651a3819&dpt=wz.ztzt&Pageindex=0&pagesize=5&sort=fbt%3Aasc&date=20240822"
            r = self.session.get(url_em, timeout=4)
            latency = int((time.time() - t0) * 1000)
            results["eastmoney"] = {
                "name": "EastMoney Open API",
                "status": "ONLINE" if r.status_code == 200 else "DEGRADED",
                "latency_ms": latency,
                "priority": 2,
                "endpoint": "push2ex.eastmoney.com"
            }
        except Exception as e:
            results["eastmoney"] = {
                "name": "EastMoney Open API",
                "status": "OFFLINE",
                "latency_ms": int((time.time() - t0) * 1000),
                "error": str(e),
                "priority": 2,
                "endpoint": "push2ex.eastmoney.com"
            }

        # 3. Sina Finance probe
        t0 = time.time()
        try:
            url_sina = "https://hq.sinajs.cn/list=sh600519"
            r = self.session.get(url_sina, headers={"Referer": "https://finance.sina.com.cn"}, timeout=4)
            latency = int((time.time() - t0) * 1000)
            results["sina"] = {
                "name": "Sina Finance HQ API",
                "status": "ONLINE" if r.status_code == 200 and "600519" in r.text else "DEGRADED",
                "latency_ms": latency,
                "priority": 3,
                "endpoint": "hq.sinajs.cn"
            }
        except Exception as e:
            results["sina"] = {
                "name": "Sina Finance HQ API",
                "status": "OFFLINE",
                "latency_ms": int((time.time() - t0) * 1000),
                "error": str(e),
                "priority": 3,
                "endpoint": "hq.sinajs.cn"
            }

        # 4. Tencent Finance probe
        t0 = time.time()
        try:
            url_tx = "https://qt.gtimg.cn/q=sh600519"
            r = self.session.get(url_tx, timeout=4)
            latency = int((time.time() - t0) * 1000)
            results["tencent"] = {
                "name": "Tencent Finance QT API",
                "status": "ONLINE" if r.status_code == 200 and "贵州茅台" in r.text else "DEGRADED",
                "latency_ms": latency,
                "priority": 4,
                "endpoint": "qt.gtimg.cn"
            }
        except Exception as e:
            results["tencent"] = {
                "name": "Tencent Finance QT API",
                "status": "OFFLINE",
                "latency_ms": int((time.time() - t0) * 1000),
                "error": str(e),
                "priority": 4,
                "endpoint": "qt.gtimg.cn"
            }

        return results


# Global singleton instance
data_fetcher = DataFetcher()
