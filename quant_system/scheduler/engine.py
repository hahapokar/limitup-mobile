"""
Quant Trading Scheduler Engine.
Powered by APScheduler for automated intraday market polling and post-market review.
"""

import time
import logging
import datetime
import threading
import json
from typing import Optional, Dict, Any, Callable, List

try:
    from apscheduler.schedulers.background import BackgroundScheduler
    from apscheduler.triggers.cron import CronTrigger
    HAS_APSCHEDULER = True
except ImportError:
    HAS_APSCHEDULER = False
    BackgroundScheduler = None
    CronTrigger = None

from quant_system.utils.calendar import is_trade_day, normalize_to_trade_day
from quant_system.utils.notifier import record_system_log, send_notification
from quant_system.core.data_fetcher import data_fetcher
from quant_system.core.sentiment import sentiment_engine
from quant_system.core.scoring import scoring_engine
from quant_system.core.portfolio import portfolio_engine
from quant_system.core.review_attribution import review_attribution_engine
from quant_system.core.iteration import iteration_engine
from quant_system.config import DATA_DIR, snapshot_manifest_file

logger = logging.getLogger("QuantTrading.Scheduler")


class SimpleBackgroundScheduler:
    """
    Lightweight fallback timer scheduler if apscheduler is not available.
    Implements a minimal cron-like engine: evaluates job time windows against
    Beijing wall-clock every 30s and fires each job at most once per calendar day.
    """

    def __init__(self, timezone: str = "Asia/Shanghai"):
        self.timezone = timezone
        self.jobs: List[Dict[str, Any]] = []
        self._running = False
        self._thread: Optional[threading.Thread] = None
        # "YYYY-MM-DD|job_id" -> fired timestamp (prevents double-fires)
        self._fired: set = set()

    def add_job(self, func: Callable, trigger: Any = None, id: str = "", name: str = "", replace_existing: bool = True, **kwargs):
        self.jobs = [j for j in self.jobs if j["id"] != id]
        # If caller gave us a CronTrigger, extract (hour, minute, dow) for our fallback loop.
        spec: Dict[str, Any] = {"hour": None, "minute": None, "day_of_week": None}
        if trigger is not None:
            for attr in ("hour", "minute", "day_of_week"):
                val = getattr(trigger, attr, None)
                if val is not None:
                    # APScheduler fields may be list/int; we only support the single-int
                    # patterns used in _setup_jobs (e.g. hour=9, minute=25, dow="mon-fri").
                    if isinstance(val, list) and len(val) == 1:
                        val = val[0]
                    spec[attr] = val
        self.jobs.append({"id": id, "name": name, "func": func, "trigger": trigger, "spec": spec})

    def start(self):
        self._running = True
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def shutdown(self, wait: bool = False):
        self._running = False

    @staticmethod
    def _dow_match(dow_utc0_monday0: int, spec_dow: Any) -> bool:
        """spec_dow like 'mon-fri' / 'tue' / None (any). weekday() python is 0=Mon."""
        if spec_dow is None or spec_dow == "*":
            return True
        if isinstance(spec_dow, str):
            s = spec_dow.lower()
            if s == "mon-fri":
                return 0 <= dow_utc0_monday0 <= 4
            short = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
            if s in short:
                return dow_utc0_monday0 == short.index(s)
        return True  # conservative: unknown syntax → still allow

    @staticmethod
    def _field_match(now_val: int, spec_val: Any) -> bool:
        if spec_val is None or spec_val == "*":
            return True
        try:
            return int(now_val) == int(spec_val)
        except (TypeError, ValueError):
            return True

    def _loop(self):
        while self._running:
            try:
                # Beijing wall-clock: UTC + 8h (keeps scheduler self-contained, no tz deps)
                now = datetime.datetime.utcnow() + datetime.timedelta(hours=8)
                today_str = now.strftime("%Y-%m-%d")
                weekday = now.weekday()  # 0=Mon..6=Sun
                hh = now.hour
                mm = now.minute

                # Drop stale fire-records to avoid unbounded set growth
                if len(self._fired) > 500:
                    self._fired = {k for k in self._fired if not k.startswith(today_str)}

                for job in self.jobs:
                    key = f"{today_str}|{job['id']}"
                    if key in self._fired:
                        continue
                    spec = job.get("spec") or {}
                    if (
                        self._field_match(hh, spec.get("hour"))
                        and self._field_match(mm, spec.get("minute"))
                        and self._dow_match(weekday, spec.get("day_of_week"))
                    ):
                        try:
                            record_system_log(
                                "INFO", "Scheduler",
                                f"[FallbackTimer] firing '{job['name']}' at {now.strftime('%H:%M')} Beijing"
                            )
                            job["func"]()
                        except Exception as exc:
                            logger.warning(f"[FallbackTimer] job {job['id']} raised: {exc}")
                        finally:
                            self._fired.add(key)
            except Exception as loop_err:
                logger.warning(f"[FallbackTimer] loop error: {loop_err}")
            # 30s granularity is enough: our finest cron is every-minute intraday monitor
            # which we still approximate well with a 30s polling cadence.
            time.sleep(30)


class QuantScheduler:
    """
    Automates the full daily lifecycle of the A-Share Limit-Up Quant Trading System:
    - 09:25 Pre-market trading calendar check & order initialization
    - 09:30 T+1 Opening buys
    - 09:30-15:00 Intraday trailing take-profit & anti-shakeout monitoring
    - 14:45 T+2 Close forced liquidation
    - 15:02 Daily NAV settlement
    - 15:30 Top-level Sentiment Timing & 4-Factor Stock Selection
    - 15:35 Daily Post-Mortem Attribution & Shadow Backtest Iteration (NEW)
    """

    def __init__(self):
        if HAS_APSCHEDULER and BackgroundScheduler is not None:
            self.scheduler = BackgroundScheduler(timezone="Asia/Shanghai")
        else:
            self.scheduler = SimpleBackgroundScheduler(timezone="Asia/Shanghai")
        self.is_running = False
        self._setup_jobs()

    @staticmethod
    def _beijing_today() -> datetime.date:
        return (datetime.datetime.utcnow() + datetime.timedelta(hours=8)).date()

    def _setup_jobs(self) -> None:
        """Register all daily lifecycle tasks.
        Works under APScheduler (real CronTrigger) AND under the SimpleBackgroundScheduler
        fallback (hand-written hour/minute/day-of-week specs). This guarantees 15:30+15:35
        post-market data refreshes fire reliably regardless of pip install status.
        """
        # ---- Helper: add_job under both schedulers uniformly ----
        use_cron = HAS_APSCHEDULER and CronTrigger is not None
        def add(id: str, name: str, hour, minute, func, dow: str = "mon-fri"):
            if use_cron:
                self.scheduler.add_job(
                    func,
                    trigger=CronTrigger(hour=hour, minute=minute, day_of_week=dow),
                    id=id, name=name, replace_existing=True,
                )
            else:
                # Construct a dummy trigger-ish spec object with attributes so
                # SimpleBackgroundScheduler.add_job can read hour/minute/day_of_week.
                class _FakeTrigger:
                    pass
                t = _FakeTrigger()
                t.hour = hour; t.minute = minute; t.day_of_week = dow
                self.scheduler.add_job(
                    func, trigger=t, id=id, name=name, replace_existing=True,
                )

        # 1. 09:25 盘前交易日检测
        add(
            "job_pre_market_check",
            "09:25 盘前交易日检测与就绪准备",
            9, 25, self.job_pre_market_check,
        )

        # 2. 09:30 T+1 开盘买入
        add(
            "job_morning_open_buy",
            "09:30 T+1 开盘买入执行",
            9, 30, self.job_morning_open_buy,
        )

        # 3. 盘中高频监控 (09:30-11:30 & 13:00-14:59)
        # NOTE: the fallback scheduler only supports fixed-hour/minute (not
        # "every minute" wildcards) because SimpleBackgroundScheduler uses a
        # "once per day" fire-key model. Instead, job_intraday_monitor is
        # ALSO called reactively on every POST /api/portfolio/sync heartbeat
        # (≈3s during trading hours) which covers real-time monitoring even
        # without the minute-level cron. We still register fixed "check-in"
        # calls at anchor minutes so the log timeline looks natural.
        if use_cron:
            self.scheduler.add_job(
                self.job_intraday_monitor,
                trigger=CronTrigger(minute="*", hour="9-11,13-14", day_of_week="mon-fri"),
                id="job_intraday_monitor",
                name="09:30-15:00 盘中高频移动止盈与防洗盘止损监控",
                replace_existing=True,
            )
        else:
            for hh, mm in [
                (9, 35), (9, 45), (10, 0), (10, 15), (10, 30), (10, 45), (11, 0), (11, 15), (11, 25),
                (13, 5), (13, 20), (13, 35), (13, 50), (14, 5), (14, 20), (14, 35), (14, 50),
            ]:
                add(
                    f"job_intraday_monitor_{hh:02d}{mm:02d}",
                    f"盘中巡检 {hh:02d}:{mm:02d}",
                    hh, mm, self.job_intraday_monitor,
                )

        # 4. 14:45 T+2 尾盘强平
        add(
            "job_t2_forced_exit",
            "14:45 T+2 尾盘未涨停强制清仓",
            14, 45, self.job_t2_forced_exit,
        )

        # 5. 15:02 结算与 NAV 更新
        add(
            "job_daily_settlement",
            "15:02 收盘模拟盘结算与NAV净值更新",
            15, 2, self.job_daily_settlement,
        )

        # 6. 15:30 大盘情绪 + 因子选股 + 复盘归因（核心盘后更新入口）
        add(
            "job_post_market_review",
            "15:30 盘后全量数据更新（情绪/选股/复盘/涨停池）",
            15, 30, self.job_post_market_review,
        )

        # 7. 15:35 深度归因对账与影子回测自迭代
        add(
            "job_post_market_iteration",
            "15:35 盘后深度归因与影子回测自迭代",
            15, 35, self.job_post_market_iteration,
        )

    def start(self) -> None:
        if not self.is_running:
            self.scheduler.start()
            self.is_running = True
            record_system_log("INFO", "Scheduler", "APScheduler daemon activated with 7 daily lifecycle jobs.")

    def stop(self) -> None:
        if self.is_running:
            self.scheduler.shutdown(wait=False)
            self.is_running = False
            record_system_log("INFO", "Scheduler", "APScheduler daemon stopped.")

    # -------------------------------------------------------------------------
    # JOB HANDLERS
    # -------------------------------------------------------------------------
    def job_pre_market_check(self) -> None:
        today_date = self._beijing_today()
        if not is_trade_day(today_date):
            record_system_log("INFO", "Scheduler", f"Today ({today_date}) is not an A-share trading day.")
            return
        record_system_log("INFO", "Scheduler", f"🔔 今日为 A 股交易日 ({today_date})，系统就绪。")
        send_notification("🔔 盘前交易系统就绪", f"今日为 A 股交易日 ({today_date})，系统进入盘中实时监控状态。")

    def job_morning_open_buy(self) -> None:
        today_str = self._beijing_today().strftime("%Y-%m-%d")
        if not is_trade_day(today_str):
            return
        record_system_log("INFO", "Scheduler", "🚀 09:30 A股开盘，启动 T+1 模拟盘建仓撮合引擎...")
        executed = portfolio_engine.execute_t1_buys(today_str)
        if executed:
            record_system_log("INFO", "Scheduler", f"09:30 建仓完成，共成交 {len(executed)} 笔订单。")

    def job_intraday_monitor(self) -> None:
        today_str = self._beijing_today().strftime("%Y-%m-%d")
        if not is_trade_day(today_str):
            return
        now_time = datetime.datetime.now().strftime("%H:%M")
        if not (("09:30" <= now_time <= "11:30") or ("13:00" <= now_time <= "15:00")):
            return
        portfolio_engine.monitor_intraday_exits(now_time)

    def job_t2_forced_exit(self) -> None:
        today_str = self._beijing_today().strftime("%Y-%m-%d")
        if not is_trade_day(today_str):
            return
        record_system_log("INFO", "Scheduler", "⏰ 14:45 执行 T+2 尾盘强制平仓检测...")
        portfolio_engine.monitor_intraday_exits("14:45")

    def job_daily_settlement(self) -> None:
        today_str = self._beijing_today().strftime("%Y-%m-%d")
        if not is_trade_day(today_str):
            return
        record_system_log("INFO", "Scheduler", "📊 15:02 开始收盘账户结算与 NAV 净值更新...")
        portfolio_engine.settle_daily_nav(today_str)

    def job_post_market_review(self) -> Dict[str, Any]:
        """15:30: 盘后全量数据更新 — 涨停池、情绪分、因子选股、复盘评估与连板归因。"""
        today_str = self._beijing_today().strftime("%Y-%m-%d")
        if not is_trade_day(today_str):
            record_system_log("INFO", "Scheduler", f"今日 ({today_str}) 非交易日，跳过盘后数据更新。")
            return {"skipped": True, "reason": "not_trade_day"}
        effective_date = normalize_to_trade_day(today_str)
        record_system_log("INFO", "Scheduler", f"🎯 15:30 启动盘后全量数据更新流程 (交易日: {effective_date})...")

        # 1. 刷新当日全量涨停池缓存（主动获取最新当日数据并写入 limitup_YYYY-MM-DD.json）
        record_system_log("INFO", "Scheduler", "  [1/5] 刷新当日全量涨停池缓存...")
        zt_pool = []
        broken_pool = []
        market_snapshot_ready = False
        try:
            zt_pool = data_fetcher.get_limit_up_pool(effective_date)
            market_snapshot_ready = True
            record_system_log("INFO", "Scheduler", f"       涨停池: {len(zt_pool)} 只")
        except Exception as e:
            record_system_log("ERROR", "Scheduler", f"       涨停池刷新失败: {e}")
        # 炸板池单独拉取，失败不影响主流程
        try:
            broken_pool = data_fetcher.get_broken_limit_up_pool(effective_date)
            record_system_log("INFO", "Scheduler", f"       炸板池: {len(broken_pool)} 只")
        except Exception as e:
            record_system_log("WARNING", "Scheduler", f"       炸板池刷新失败（不影响主流程）: {e}")

        # 2. 大盘情绪分计算（情绪择时 + 熔断线）
        record_system_log("INFO", "Scheduler", "  [2/5] 计算大盘情绪四维得分...")
        sentiment_res = sentiment_engine.calculate_sentiment(effective_date)
        record_system_log("INFO", "Scheduler", f"       情绪分: {sentiment_res.get('sentiment_score')} ({sentiment_res.get('sentiment_level')})，熔断: {sentiment_res.get('sentiment_circuit_breaker')}")

        # 3. 四大因子选股池（对涨停池做百分位打分 + 排雷过滤，选出 TopN）
        record_system_log("INFO", "Scheduler", "  [3/5] 运行四大因子量化选股打分...")
        scoring_res = scoring_engine.run_daily_scoring(effective_date)
        record_system_log("INFO", "Scheduler", f"       共分析 {scoring_res.get('total_limit_up_count')} 只涨停，选出 Top{scoring_res.get('candidates_count')} 候选")

        # Publish the FINAL marker — based on actual sentiment + scoring results,
        # not on market_snapshot_ready which can be False if only broken_pool failed.
        sentiment_ok = (
            sentiment_res.get("trade_date") == effective_date
            and sentiment_res.get("snapshot_status") == "FINAL"
        )
        scoring_ok = (
            scoring_res.get("trade_date") == effective_date
            and scoring_res.get("snapshot_status") == "FINAL"
        )
        if sentiment_ok and scoring_ok:
            manifest = {
                "trade_date": effective_date,
                "snapshot_status": "FINAL",
                "finalized_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "artifacts": [
                    f"limitup_{effective_date}.json",
                    f"sentiment_{effective_date}.json",
                    f"candidates_{effective_date}.json",
                ],
            }
            manifest_path = snapshot_manifest_file(effective_date)
            manifest_tmp = manifest_path.with_suffix(".tmp")
            with open(manifest_tmp, "w", encoding="utf-8") as f:
                json.dump(manifest, f, ensure_ascii=False, indent=2)
            manifest_tmp.replace(manifest_path)
            record_system_log("INFO", "Scheduler", f"       {effective_date} FINAL 盘后快照已发布，可供下一交易日使用")

        # 4. 盘后复盘评估与连板归因（生成 review_attribution_latest.json）
        record_system_log("INFO", "Scheduler", "  [4/5] 生成盘后复盘评估与连板归因报告...")
        review_res = review_attribution_engine.generate_review_and_attribution()
        record_system_log("INFO", "Scheduler", f"       复盘报告已生成: Top{len(review_res.get('top_candidate_evaluations', []))} 评估 / {len(review_res.get('lower_ranked_attributions', []))} 落选归因")

        # 5. 策略自迭代影子回测（15:30 先跑一次，15:35 再做深度对账，避免与后续任务冲突）
        record_system_log("INFO", "Scheduler", "  [5/5] 运行盘后影子回测自迭代初评...")
        try:
            iteration_res = iteration_engine.run_daily_post_mortem_and_shadow_test(effective_date)
            record_system_log("INFO", "Scheduler", f"       影子回测状态: {iteration_res.get('status')}")
        except Exception as e:
            record_system_log("WARNING", "Scheduler", f"       影子回测初评跳过: {e}")
            iteration_res = {"status": "SKIPPED", "error": str(e)}

        send_notification(
            f"🎯 盘后全量数据更新完成 ({effective_date})",
            f"情绪分: {sentiment_res.get('sentiment_score')} ({sentiment_res.get('sentiment_level')})\n"
            f"涨停: {len(zt_pool)} 只 / 炸板: {len(broken_pool)} 只\n"
            f"选股 Top{scoring_res.get('candidates_count')}: "
            + ", ".join([f"{c['name']}({c['code']})" for c in scoring_res.get('candidates', [])[:3]])
        )

        return {
            "trade_date": effective_date,
            "limit_up_pool": {"sealed": len(zt_pool), "broken": len(broken_pool)},
            "sentiment": sentiment_res,
            "scoring": scoring_res,
            "review_attribution": review_res,
            "iteration": iteration_res,
        }

    def job_post_market_iteration(self) -> Dict[str, Any]:
        """15:35: 深度对账 + 策略自迭代（确保复盘归因与影子回测是当日最新数据）。"""
        today_str = self._beijing_today().strftime("%Y-%m-%d")
        if not is_trade_day(today_str):
            return {"skipped": True, "reason": "not_trade_day"}
        effective_date = normalize_to_trade_day(today_str)
        record_system_log("INFO", "Scheduler", f"🧠 15:35 启动深度归因对账与影子回测二次评估 ({effective_date})...")

        # 1. 二次确认涨停池（部分数据源15:30后才补全封单/炸板明细）
        record_system_log("INFO", "Scheduler", "  [1/3] 二次确认涨停池最终数据（含封单/炸板明细）...")
        try:
            data_fetcher.get_limit_up_pool(effective_date)
            data_fetcher.get_broken_limit_up_pool(effective_date)
        except Exception as e:
            record_system_log("WARNING", "Scheduler", f"       二次涨停池确认跳过: {e}")

        # 2. 重新生成盘后复盘评估（确保用的是最终版涨停池数据）
        record_system_log("INFO", "Scheduler", "  [2/3] 基于最终涨停池数据重算盘后复盘与连板归因...")
        review_res = review_attribution_engine.generate_review_and_attribution()

        # 3. 运行真实 iteration_engine 影子回测（不是伪代码）
        record_system_log("INFO", "Scheduler", "  [3/3] 运行真实影子回测与参数微调建议...")
        iteration_res = iteration_engine.run_daily_post_mortem_and_shadow_test(effective_date)

        if iteration_res.get("has_recommendation"):
            send_notification(
                "🧠 策略自迭代建议就绪",
                f"交易日 {effective_date} 影子回测已完成，有 {len(iteration_res.get('config_diff', []))} 项参数建议，请前往前端控制台复核。"
            )
        else:
            record_system_log("INFO", "Scheduler", f"       本次无参数微调建议 (status={iteration_res.get('status')})")

        return {
            "trade_date": effective_date,
            "review_attribution_final": review_res,
            "iteration": iteration_res,
        }

    # -------------------------------------------------------------------------
    # ON-DEMAND MANUAL EXECUTION METHODS
    # -------------------------------------------------------------------------
    def trigger_manual_review(self, target_date: Optional[str] = None) -> Dict[str, Any]:
        """Run full post-market review on-demand for any target date.
        Includes: limit-up pool refresh, sentiment, 4-factor scoring, review attribution, shadow iteration.
        """
        effective_date = normalize_to_trade_day(target_date or self._beijing_today().strftime("%Y-%m-%d"))
        record_system_log("INFO", "Scheduler", f"Manual trigger: Running FULL post-market data refresh for {effective_date}")

        # 1. 刷新当日全量涨停池缓存
        try:
            zt_pool = data_fetcher.get_limit_up_pool(effective_date)
        except Exception as e:
            record_system_log("WARNING", "Scheduler", f"Manual review: limit-up pool fetch failed: {e}")
            zt_pool = []
        try:
            broken_pool = data_fetcher.get_broken_limit_up_pool(effective_date)
        except Exception as e:
            record_system_log("WARNING", "Scheduler", f"Manual review: broken pool fetch failed: {e}")
            broken_pool = []

        # 2. 大盘情绪分
        sentiment_res = sentiment_engine.calculate_sentiment(effective_date)

        # 3. 四大因子选股
        scoring_res = scoring_engine.run_daily_scoring(effective_date)

        # 3.5 发布 FINAL manifest（与 job_post_market_review 逻辑一致）
        sentiment_ok = (
            sentiment_res.get("trade_date") == effective_date
            and sentiment_res.get("snapshot_status") == "FINAL"
        )
        scoring_ok = (
            scoring_res.get("trade_date") == effective_date
            and scoring_res.get("snapshot_status") == "FINAL"
        )
        if sentiment_ok and scoring_ok:
            manifest = {
                "trade_date": effective_date,
                "snapshot_status": "FINAL",
                "finalized_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "artifacts": [
                    f"limitup_{effective_date}.json",
                    f"sentiment_{effective_date}.json",
                    f"candidates_{effective_date}.json",
                ],
            }
            manifest_path = snapshot_manifest_file(effective_date)
            with open(manifest_path, "w", encoding="utf-8") as f:
                json.dump(manifest, f, ensure_ascii=False, indent=2)
            record_system_log("INFO", "Scheduler", f"Manual review: {effective_date} FINAL manifest 已发布")

        # 4. 盘后复盘评估与连板归因
        review_res = review_attribution_engine.generate_review_and_attribution()

        # 5. 影子回测自迭代
        try:
            iteration_res = iteration_engine.run_daily_post_mortem_and_shadow_test(effective_date)
        except Exception as e:
            iteration_res = {"status": "SKIPPED", "error": str(e)}

        return {
            "trade_date": effective_date,
            "limit_up_pool": {"sealed": len(zt_pool), "broken": len(broken_pool)},
            "sentiment": sentiment_res,
            "scoring": scoring_res,
            "review_attribution": review_res,
            "iteration": iteration_res,
        }

    def trigger_manual_trading(self, target_date: Optional[str] = None) -> Dict[str, Any]:
        """Run buy execution & intraday monitoring on-demand."""
        effective_date = normalize_to_trade_day(target_date or self._beijing_today().strftime("%Y-%m-%d"))
        record_system_log("INFO", "Scheduler", f"Manual trigger: Running trading & exit monitor for {effective_date}")
        buys = portfolio_engine.execute_t1_buys(effective_date)
        exits = portfolio_engine.monitor_intraday_exits()
        settled = portfolio_engine.settle_daily_nav(effective_date)
        return {
            "trade_date": effective_date,
            "buys_executed": buys,
            "exits_executed": exits,
            "portfolio_state": settled
        }

    def trigger_manual_shadow_backtest(self, target_date: Optional[str] = None) -> Dict[str, Any]:
        """手动在前端触发影子回测。"""
        effective_date = normalize_to_trade_day(target_date or self._beijing_today().strftime("%Y-%m-%d"))
        record_system_log("INFO", "Scheduler", f"Manual trigger: Running shadow backtest for {effective_date}")
        
        try:
            from quant_system.core.iteration import iteration_engine
            return iteration_engine.run_daily_post_mortem_and_shadow_test(effective_date)
        except Exception as e:
            # NEVER fabricate a shadow-backtest result on error. Falling back to
            # iteration_engine's NOT_RUN placeholder is the ONLY acceptable fallback,
            # so the UI cannot accidentally show fabricated win rates / tickers.
            logger.warning(f"iteration_engine raised on {effective_date} ({e}); returning explicit NOT_RUN placeholder")
            import datetime as _dt
            return {
                "trade_date": effective_date,
                "has_recommendation": False,
                "status": "NOT_RUN",
                "last_evaluated": _dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "summary": None,
                "config_diff": [
                    {
                        "param_key": "limit_seal_ratio",
                        "param_name": "首板封单占比门槛",
                        "current_value": None,
                        "suggested_value": None,
                        "min_bound": 0.10,
                        "max_bound": 0.35,
                        "step": 0.01,
                        "unit": "%",
                        "reason": None,
                    },
                    {
                        "param_key": "open_turnover_rate",
                        "param_name": "开盘换手率下限",
                        "current_value": None,
                        "suggested_value": None,
                        "min_bound": 0.015,
                        "max_bound": 0.060,
                        "step": 0.005,
                        "unit": "%",
                        "reason": None,
                    },
                    {
                        "param_key": "hard_stop_loss_pct",
                        "param_name": "防洗盘硬止损线",
                        "current_value": -0.0413,
                        "suggested_value": None,
                        "min_bound": -0.060,
                        "max_bound": -0.025,
                        "step": 0.002,
                        "unit": "%",
                        "reason": None,
                    },
                ],
                "metrics": {},
                "equity_curve": [],
                "impacted_trades": [],
                "note": f"scheduler except fallback: {e!s}",
            }


# Global singleton instance
quant_scheduler = QuantScheduler()
