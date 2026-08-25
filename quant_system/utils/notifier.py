"""
Structured Logging and Notification Module.
Provides formatted console logging, in-memory/JSON log streaming,
and reserved notification hooks for DingTalk / Feishu / WeChat Work.
"""

import os
import json
import logging
import datetime
from typing import Optional, Dict, Any, List
from pathlib import Path

# Setup standard logger
logger = logging.getLogger("QuantTrading")
logger.setLevel(logging.INFO)

# Console handler with clean formatting
if not logger.handlers:
    ch = logging.StreamHandler()
    ch.setLevel(logging.INFO)
    formatter = logging.Formatter(
        fmt="[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
    )
    ch.setFormatter(formatter)
    logger.addHandler(ch)

LOGS_FILE = Path(__file__).resolve().parent.parent / "data" / "system_logs.json"


def record_system_log(level: str, category: str, message: str, details: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Persist structured log event into local JSON file for dashboard visualization."""
    now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    entry = {
        "timestamp": now_str,
        "level": level.upper(),
        "category": category,
        "message": message,
        "details": details or {}
    }
    
    # Also log to python logger
    if level.upper() == "ERROR":
        logger.error(f"[{category}] {message}")
    elif level.upper() == "WARNING":
        logger.warning(f"[{category}] {message}")
    else:
        logger.info(f"[{category}] {message}")
    
    try:
        LOGS_FILE.parent.mkdir(parents=True, exist_ok=True)
        logs: List[Dict[str, Any]] = []
        if LOGS_FILE.exists():
            try:
                with open(LOGS_FILE, "r", encoding="utf-8") as f:
                    logs = json.load(f)
            except Exception:
                logs = []
        
        logs.append(entry)
        # Keep latest 300 logs
        if len(logs) > 300:
            logs = logs[-300:]
            
        with open(LOGS_FILE, "w", encoding="utf-8") as f:
            json.dump(logs, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.error(f"Failed to record system log to JSON: {e}")
        
    return entry


def get_recent_logs(limit: int = 50) -> List[Dict[str, Any]]:
    """Retrieve the most recent log entries from disk."""
    if not LOGS_FILE.exists():
        return []
    try:
        with open(LOGS_FILE, "r", encoding="utf-8") as f:
            logs = json.load(f)
            if isinstance(logs, list):
                return logs[-limit:]
    except Exception as e:
        logger.error(f"Failed to read logs: {e}")
    return []


def send_notification(title: str, content: str, channel: str = "all") -> bool:
    """
    Reserved notification hook for trade execution alerts and circuit breakers.
    Can be configured for DingTalk, WeCom, Feishu or Webhook.
    """
    record_system_log("INFO", "Notifier", f"📢 {title}: {content}")
    # Reserved interface for HTTP Webhooks (e.g. DingTalk robot / Feishu)
    webhook_url = os.getenv("NOTIFIER_WEBHOOK_URL", "")
    if webhook_url:
        try:
            import requests
            payload = {
                "msgtype": "text",
                "text": {"content": f"【A股打板量化系统】\n{title}\n{content}"}
            }
            requests.post(webhook_url, json=payload, timeout=3)
        except Exception as err:
            logger.warning(f"Webhook push failed: {err}")
    return True
