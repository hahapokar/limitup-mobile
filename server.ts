import express from "express";
import path from "path";
import fs from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import { createServer as createViteServer } from "vite";

const execAsync = promisify(exec);
const app = express();
const PORT = Number(process.env.PORT || 3006);

app.use(express.json());

const DATA_DIR = path.join(process.cwd(), "quant_system", "data");

// Helper to safely read JSON files
function readJsonSafe(filename: string, fallback: any = null) {
  try {
    const fullPath = path.join(DATA_DIR, filename);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, "utf-8");
      return JSON.parse(content);
    }
  } catch (err) {
    console.error(`Error reading ${filename}:`, err);
  }
  return fallback;
}

// DATA INTEGRITY: Resolve effective trade date from real cached files.
// NEVER fall back to a hard-coded "2026-08-21" — if no real date is cached,
// return empty string so UI renders "—" / pending instead of a fabricated date.
function resolveRealTradeDate(): string {
  const sentiment = readJsonSafe("latest_sentiment.json", {});
  if (sentiment?.trade_date && typeof sentiment.trade_date === "string") {
    return sentiment.trade_date;
  }
  const candidates = readJsonSafe("latest_candidates.json", {});
  if (candidates?.trade_date && typeof candidates.trade_date === "string") {
    return candidates.trade_date;
  }
  return "";
}

// DATA INTEGRITY: Resolve anchor / next trade date from market session output.
// Single-shot python call that returns both:
//   { latest, next, prev } trade dates  AND
//   the full market_session payload.
//
// RATIONALE: Previously we forked python TWICE inside /api/status — once for
// resolveRealSessionDates() and again for get_market_session_status(). On
// off-hours / cold starts those two imports hit akshare network I/O and each
// one burned through the full 1000ms timeout for a cumulative stall of ~2s,
// making the "正在同步实时行情与盯盘清单..." spinner visible for too long.
//
// By combining into ONE execAsync we start python once, import data_fetcher
// once, and race against a single 1000ms deadline. Measured /api/status time
// drops from 2033ms → ~10xxms (first paint sub-1.5s).
async function fetchRealSessionOnce(): Promise<{
  realDates: { latest: string; next: string; prev: string };
  marketSession: any;
}> {
  let t: NodeJS.Timeout | null = null;
  const deadline = new Promise<never>((_, rej) => {
    t = setTimeout(() => rej(new Error("session_once:timeout")), 1000);
  });
  const empty = {
    realDates: { latest: "", next: "", prev: "" },
    marketSession: null,
  };
  try {
    const { stdout } = await Promise.race([
      execAsync(
        `python3 -c "
import json
from quant_system.core.data_fetcher import data_fetcher
s = data_fetcher.get_market_session_status()
print(json.dumps({
  'realDates': {
    'latest': s.get('latest_trade_date') or '',
    'next': s.get('next_trade_date') or '',
    'prev': s.get('prev_trade_date') or '',
  },
  'marketSession': s,
}))
"`,
        { cwd: process.cwd() }
      ),
      deadline,
    ]);
    const parsed = JSON.parse(stdout.trim());
    const rd = parsed.realDates || {};
    return {
      realDates: {
        latest: (rd.latest || "").toString(),
        next: (rd.next || "").toString(),
        prev: (rd.prev || "").toString(),
      },
      marketSession: parsed.marketSession || null,
    };
  } catch (_e: any) {
    return empty;
  } finally {
    if (t) clearTimeout(t);
  }
}

// ----------------------------------------------------------------------------
// API ROUTES
// ----------------------------------------------------------------------------

// 1. System Status & Market Session Status (Real-time vs Off-hours)
app.get("/api/status", async (req, res) => {
  try {
    const portfolio = readJsonSafe("portfolio_state.json", {});
    const sentiment = readJsonSafe("latest_sentiment.json", {});
    const candidates = readJsonSafe("latest_candidates.json", {});
    const realTradeDate = resolveRealTradeDate();

    // Single 1000ms-hard-capped python call returns BOTH dates + marketSession.
    // Previously this was TWO sequential python forks (dates + session), each
    // with its own 1000ms timeout = 2033ms worst-case stall.
    const { realDates, marketSession: rawSession } = await fetchRealSessionOnce();

    const anchorDate = realDates.latest || realTradeDate || "";
    const normTradeDate = (sentiment?.trade_date as string) || realTradeDate || realDates.latest || "";

    // Always fall back to the explicit "no real data" placeholder so the UI
    // renders a distinct state — never invent a fake CLOSED / OPEN phase.
    // BUT: if Python timed out, still compute is_trading_active from the
    // current Beijing clock so the frontend keeps polling during market hours.
    const _nowBJ = new Date(Date.now() + 8 * 3600 * 1000);
    const _bjHour = _nowBJ.getUTCHours();
    const _bjMin = _nowBJ.getUTCMinutes();
    const _bjDay = _nowBJ.getUTCDay(); // 0=Sun, 6=Sat
    const _bjTotalMin = _bjHour * 60 + _bjMin;
    const _isWeekday = _bjDay >= 1 && _bjDay <= 5;
    const _inMorning = _isWeekday && _bjTotalMin >= 555 && _bjTotalMin <= 690;  // 9:15-11:30
    const _inAfternoon = _isWeekday && _bjTotalMin >= 780 && _bjTotalMin <= 930; // 13:00-15:30
    const _guessedActive = _inMorning || _inAfternoon;
    const fallback = {
      current_time_beijing: new Date().toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai" }),
      trade_date: (sentiment?.trade_date as string) || realTradeDate || "",
      session_phase: _guessedActive ? "TRADING" : "CLOSED",
      session_name: _guessedActive
        ? "交易时段 (Python行情超时, 按时钟判断)"
        : "非交易时段 (行情接口未连接)",
      is_trading_active: _guessedActive,
      update_interval_sec: _guessedActive ? 3 : 15,
    };
    const marketSession = rawSession && typeof rawSession === "object" ? rawSession : fallback;

    // DATA INTEGRITY: numeric fields also avoid fabricating defaults like nav=1.0 / total_asset=100000.
    // If the cache file is missing, emit null so UI shows "—". Only the scheduler ACTIVE flag is
    // static (it reflects the server process, not market state).
    res.json({
      success: true,
      data: {
        anchor_date: anchorDate,
        normalized_trade_date: normTradeDate,
        system_time: new Date().toISOString(),
        scheduler_status: "ACTIVE",
        market_session: marketSession,
        nav: typeof portfolio?.nav === "number" ? portfolio.nav : null,
        total_asset: typeof portfolio?.total_asset === "number" ? portfolio.total_asset : null,
        sentiment_score: typeof sentiment?.sentiment_score === "number" ? sentiment.sentiment_score : null,
        sentiment_level: sentiment?.sentiment_level || "",
        circuit_breaker: typeof sentiment?.sentiment_circuit_breaker === "boolean" ? sentiment.sentiment_circuit_breaker : null,
        candidates_count: Array.isArray(candidates?.candidates) ? candidates.candidates.length : (Array.isArray(candidates?.all_scored_stocks) ? candidates.all_scored_stocks.length : null),
        open_positions: Array.isArray(portfolio?.holdings) ? portfolio.holdings.length : null,
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Data Sources Health Probe
app.get("/api/health", async (req, res) => {
  try {
    const { stdout } = await execAsync(`python3 -c "
import json
from quant_system.core.data_fetcher import data_fetcher
print(json.dumps(data_fetcher.test_data_sources_health()))
"`, { cwd: process.cwd() });

    const health = JSON.parse(stdout.trim());
    res.json({ success: true, data: health });
  } catch (err: any) {
    // DATA INTEGRITY: On Python probe failure, emit explicit "UNKNOWN" with
    // null latency. NEVER fabricate ONLINE / DEGRADED + plausible latency ms.
    res.status(500).json({
      success: false,
      error: err.message,
      data: {
        akshare: { name: "AkShare Data Package", status: "UNKNOWN", latency_ms: null, priority: 1, endpoint: "python.akshare" },
        eastmoney: { name: "EastMoney Open API", status: "UNKNOWN", latency_ms: null, priority: 2, endpoint: "push2ex.eastmoney.com" },
        sina: { name: "Sina Finance HQ API", status: "UNKNOWN", latency_ms: null, priority: 3, endpoint: "hq.sinajs.cn" },
        tencent: { name: "Tencent Finance QT API", status: "UNKNOWN", latency_ms: null, priority: 4, endpoint: "qt.gtimg.cn" },
      }
    });
  }
});

// 3. Market Sentiment
app.get("/api/sentiment", (req, res) => {
  const date = (req.query.date as string) || "";
  let data = null;
  if (date) {
    data = readJsonSafe(`sentiment_${date}.json`);
  }
  if (!data && !date) {
    data = readJsonSafe("latest_sentiment.json", {});
  }
  res.json({ success: true, data });
});

// 4. Quant Scored Candidates
app.get("/api/candidates", (req, res) => {
  const date = (req.query.date as string) || "";
  let data = null;
  if (date) {
    data = readJsonSafe(`candidates_${date}.json`);
  }
  if (!data && !date) {
    data = readJsonSafe("latest_candidates.json", {});
  }
  res.json({ success: true, data });
});

// 5. Full Limit-Up Pool
//    Priority: 1) candidates_${date}.json all_scored_stocks (contains quant_score)
//              2) limitup_${date}.json raw pool (supplement remaining stocks)
app.get("/api/limitup-pool", (req, res) => {
  // DATA INTEGRITY: If caller provides no ?date=, use real cached trade_date
  // and if that is also missing, resolve to "" so the fallback reads
  // latest_candidates.json (via candDate=null) rather than pointing at a
  // hard-coded "2026-08-21" file that may not exist for the user.
  const realTradeDate = resolveRealTradeDate();
  const date = (req.query.date as string) || realTradeDate;

  // Step 1: Load scored stocks (with quant_score from candidates file)
  let scored: any[] | null = null;
  const candDate = readJsonSafe(`candidates_${date}.json`);
  const candLatest = readJsonSafe("latest_candidates.json");
  if (candDate && Array.isArray(candDate.all_scored_stocks)) {
    scored = candDate.all_scored_stocks;
  } else if (!date && candLatest && Array.isArray(candLatest.all_scored_stocks)) {
    scored = candLatest.all_scored_stocks;
  }

  // Step 2: Load raw limit-up pool as baseline
  const raw = readJsonSafe(`limitup_${date}.json`);
  const rawArr: any[] = Array.isArray(raw) ? raw : [];

  // Step 3: Merge - scored stocks take priority (preserve quant_score / factor_scores)
  //         then supplement with raw stocks that haven't been scored
  const seen = new Set<string>();
  const merged: any[] = [];

  if (scored && scored.length) {
    for (const s of scored) {
      const k = s.code;
      if (k) {
        seen.add(k);
        merged.push(s);
      }
    }
  }
  for (const r of rawArr) {
    const k = r.code;
    if (k && !seen.has(k)) {
      merged.push(r);
    }
  }

  // If neither has data, still return empty instead of mock data
  res.json({ success: true, data: merged });
});

// 6. Portfolio State & Live Watchlist Sync
// ——————————————————————————————————————————————————————————————————————————
// IMPORTANT: This GET endpoint is a **PURE CACHE READ** and never forks Python.
// Any live / trading / python work must happen ONLY via POST /api/portfolio/sync.
// Reason: during CLOSED / non-trading hours (or if akshare stalls on DNS),
// calling auto_sync_and_trade here would block the response for 30s-2min+,
// and the first paint will sit on the loading skeleton indefinitely.
// User requirement: "非交易时间不需要实时更新，仅在加载时更新即可." — so a
// disk read is exactly "load at page-open time" without re-running trading logic.
// ——————————————————————————————————————————————————————————————————————————
app.get("/api/portfolio", (_req, res) => {
  const data = readJsonSafe("portfolio_state.json", null);
  res.json({ success: true, data });
});

// 6.1 Trigger Realtime Sync & Auto-Trading
// Supports two modes:
//   blocking=true  (first load / user click "刷新"): wait up to 2.5s for the
//                    python auto_sync_and_trade to finish, then return fresh state.
//   blocking=false (silent 3s heartbeat)           : return LAST-KNOWN cache in
//                    <50ms and run python in the background. The next tick will
//                    pick up the updated portfolio_state.json on disk.
//                   This gives the user a "seamless / invisible" refresh.
//
// In-flight coalescing is also applied so overlapping ticks never fork two
// python children at the same time.
const SYNC_TIMEOUT_MS = 2500;
const syncInFlightRef: { promise: Promise<any> | null } = { promise: null };

app.post("/api/portfolio/sync", async (req, res) => {
  const date = (req.body?.date as string) || "";
  const blocking = req.body?.blocking !== false; // default true for manual clicks
  const watchlistOnly = req.body?.watchlist_only === true;
  const safeDate = date.replace(/'/g, "''");
  const wlArg = watchlistOnly ? ", watchlist_only=True" : "";

  const readPortfolioCache = () =>
    readJsonSafe("portfolio_state.json", null);

  // ----------- SILENT / NON-BLOCKING PATH (heartbeat) ---------------------
  // Reply in O(1) with the cache on disk; launch python sync in the background
  // ONLY when there is something worth refreshing:
  //   * watchlist_only + ZERO holdings → no Python fork at all. Nothing is
  //     being monitored; just return the cold cache we already have in hand.
  //   * Otherwise → background fork, but with `watchlist_only=True` passed
  //     to portfolio_engine.auto_sync_and_trade so it skips candidate reads,
  //     sentiment re-computes, and opening-buy logic.
  // The next heartbeat tick picks up any updated portfolio_state.json on disk.
  if (!blocking) {
    const cache = readPortfolioCache();

    // Heartbeat FAST PATH: Nothing to watch → no work to do. Return instantly
    // from Node memory without touching Python.
    if (watchlistOnly && Array.isArray(cache.holdings) && cache.holdings.length === 0) {
      return res.json({
        success: true,
        data: cache,
        note: "skipped-watchlist-empty",
      });
    }

    // If a background sync is still running from a previous tick, do nothing
    // extra here. It'll write portfolio_state.json soon and next poll reads it.
    if (!syncInFlightRef.promise) {
      const run = async (): Promise<void> => {
        let timeoutId: NodeJS.Timeout | null = null;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error("bg-sync-timeout")), SYNC_TIMEOUT_MS);
        });
        try {
          await Promise.race([
            execAsync(
              `python3 -c "
import json
from quant_system.core.portfolio import portfolio_engine
state = portfolio_engine.auto_sync_and_trade('${safeDate}'${wlArg})
print('__PORTFOLIO_SYNC_OK__')
"`,
              { cwd: process.cwd() }
            ),
            timeoutPromise
          ]);
        } catch (err: any) {
          console.warn(`[portfolio/sync:bg] ${err.message}`);
        } finally {
          if (timeoutId) clearTimeout(timeoutId);
          syncInFlightRef.promise = null;
        }
      };
      syncInFlightRef.promise = run();
    }

    // Fire-and-forget. Return IMMEDIATELY with current disk cache.
    return res.json({
      success: true,
      data: cache,
      note: watchlistOnly ? "fire-and-forget-watchlist" : "fire-and-forget",
    });
  }

  // ----------- BLOCKING PATH (first-load / user click) --------------------
  // Coalesce: if one is running, piggy-back up to 500ms then fall back to cache.
  if (syncInFlightRef.promise) {
    try {
      await Promise.race([
        syncInFlightRef.promise,
        new Promise((_, rej) => setTimeout(() => rej(new Error("coalesce-timeout")), 500))
      ]);
    } catch {
      // fall through and return cache below
    }
    return res.json({ success: true, data: readPortfolioCache(), note: "coalesced" });
  }

  const runSyncWithTimeout = async (): Promise<void> => {
    let timeoutId: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error("sync-timeout")), SYNC_TIMEOUT_MS);
    });
    try {
      await Promise.race([
        execAsync(
          `python3 -c "
import json
from quant_system.core.portfolio import portfolio_engine
state = portfolio_engine.auto_sync_and_trade('${safeDate}'${wlArg})
print('__PORTFOLIO_SYNC_OK__')
"`,
          { cwd: process.cwd() }
        ),
        timeoutPromise
      ]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  };

  syncInFlightRef.promise = runSyncWithTimeout();
  try {
    await syncInFlightRef.promise;
    res.json({ success: true, data: readPortfolioCache() });
  } catch (err: any) {
    console.warn(`[portfolio/sync] ${err.message}, returning cached portfolio.`);
    res.json({
      success: true,
      data: readPortfolioCache(),
      note: err.message === "sync-timeout" ? "timeout-used-cache" : "error-used-cache"
    });
  } finally {
    syncInFlightRef.promise = null;
  }
});

// 6.2 Manual Sell Position
app.post("/api/portfolio/sell", async (req, res) => {
  try {
    const { code, reason } = req.body;
    if (!code) {
      return res.status(400).json({ success: false, error: "Missing stock code" });
    }
    await execAsync(`python3 -c "
import json
from quant_system.core.portfolio import portfolio_engine
portfolio_engine.manual_sell_position('${code}', '${reason || "用户手动盘中平仓"}')
"`, { cwd: process.cwd() });

    const data = readJsonSafe("portfolio_state.json");
    res.json({ success: true, message: `标的 ${code} 已手动平仓`, data });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. System Logs (Internal)
app.get("/api/logs", (req, res) => {
  const logs = readJsonSafe("system_logs.json", []);
  res.json({ success: true, data: logs });
});

// 8. Trigger Action: Run Post-Market Review
app.post("/api/action/run-review", async (req, res) => {
  try {
    const dateArg = req.body.date ? `--date ${req.body.date}` : "";
    const { stdout, stderr } = await execAsync(`python3 quant_system/app.py review ${dateArg}`, {
      cwd: process.cwd()
    });
    
    const candidates = readJsonSafe("latest_candidates.json");
    const sentiment = readJsonSafe("latest_sentiment.json");
    
    res.json({
      success: true,
      message: "Daily quant review completed successfully",
      output: stdout,
      data: { candidates, sentiment }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 9. Trigger Action: Run Paper Trading Execution
app.post("/api/action/run-trading", async (req, res) => {
  try {
    const dateArg = req.body.date ? `--date ${req.body.date}` : "";
    const { stdout, stderr } = await execAsync(`python3 quant_system/app.py trade ${dateArg}`, {
      cwd: process.cwd()
    });
    
    const portfolio = readJsonSafe("portfolio_state.json");
    res.json({
      success: true,
      message: "Paper trading execution completed",
      output: stdout,
      data: { portfolio }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 10. Trigger Action: Reset Account
app.post("/api/action/reset-account", async (req, res) => {
  try {
    const capital = req.body.capital || 100000.0;
    await execAsync(`python3 -c "
import json
from quant_system.core.portfolio import portfolio_engine
portfolio_engine.reset_account(${capital})
"`, { cwd: process.cwd() });
    const portfolio = readJsonSafe("portfolio_state.json");
    res.json({
      success: true,
      message: `Account successfully reset to ¥${capital.toLocaleString()}`,
      data: { portfolio }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 10.1 Daily Post-Market Deep Evaluation & Limit-Up Attribution Analysis
app.get("/api/review/aug24-evaluation", async (req, res) => {
  try {
    let reviewData = readJsonSafe("review_attribution_latest.json") || readJsonSafe("review_attribution_aug24.json");
    if (!reviewData) {
      // HARD CAP 1500ms on-demand generation. If review engine stalls on first
      // launch, return null immediately — the UI shows a "click 复盘 to run"
      // placeholder instead of blocking paint.
      let t: NodeJS.Timeout | null = null;
      const deadline = new Promise<never>((_, rej) => {
        t = setTimeout(() => rej(new Error("review:timeout")), 1500);
      });
      try {
        await Promise.race([
          execAsync(`python3 -c "
import json
from quant_system.core.review_attribution import review_attribution_engine
review_attribution_engine.generate_review_and_attribution()
"`, { cwd: process.cwd() }),
          deadline,
        ]);
      } catch {
        // fall through — re-read cache below (still empty / null = no data)
      } finally {
        if (t) clearTimeout(t);
      }
      reviewData = readJsonSafe("review_attribution_latest.json") || readJsonSafe("review_attribution_aug24.json");
    }
    res.json({ success: true, data: reviewData });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 10.2 Timeline Step Simulation Controller
app.post("/api/timeline/step", async (req, res) => {
  try {
    const { step } = req.body;
    let pythonCmd = "";
    if (step === "RESET_100K") {
      pythonCmd = "portfolio_engine.reset_account(100000.0)";
    } else if (step === "AUG24_BUY" || step === "AUG24_WATCHLIST") {
      pythonCmd = "portfolio_engine.setup_aug24_portfolio_state()";
    } else if (step === "AUG25_TRADE") {
      pythonCmd = "portfolio_engine.advance_to_aug25_state()";
    } else {
      pythonCmd = "portfolio_engine.setup_aug24_portfolio_state()";
    }

    await execAsync(`python3 -c "
import json
from quant_system.core.portfolio import portfolio_engine
from quant_system.core.review_attribution import review_attribution_engine
${pythonCmd}
review_attribution_engine.generate_review_and_attribution()
"`, { cwd: process.cwd() });

    const portfolio = readJsonSafe("portfolio_state.json");
    const reviewData = readJsonSafe("review_attribution_latest.json") || readJsonSafe("review_attribution_aug24.json");
    res.json({
      success: true,
      message: `Timeline switched to ${step}`,
      data: { portfolio, reviewData }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 11. Strategy Shadow Backtest & Self-Iteration Data
app.get("/api/iteration/data", async (req, res) => {
  let iteration = readJsonSafe("latest_iteration.json");
  if (!iteration) {
    // Generate fresh baseline from Python engine (reads actual config values).
    // HARD CAP 1500ms — if python import / engine load stalls, we fall back to
    // the explicit NOT_RUN placeholder below. Never block first paint.
    let t: NodeJS.Timeout | null = null;
    const deadline = new Promise<never>((_, rej) => {
      t = setTimeout(() => rej(new Error("iteration:timeout")), 1500);
    });
    try {
      const { stdout } = await Promise.race([
        execAsync(`python3 -c "
import json
from quant_system.core.iteration import iteration_engine
print(json.dumps(iteration_engine.load_iteration()))
"`, { cwd: process.cwd() }),
        deadline,
      ]);
      const fresh = JSON.parse((stdout || "").trim());
      if (fresh && typeof fresh === "object") {
        iteration = fresh;
      }
    } catch (_e) {
      // Fall through to explicit NOT_RUN placeholder below
    } finally {
      if (t) clearTimeout(t);
    }
    if (!iteration) {
      iteration = readJsonSafe("latest_iteration.json");
    }
  }

  if (!iteration) {
    // Hard NO-FABRICATE rule: if Python iteration_engine cannot produce a record,
    // emit an explicit NOT_RUN placeholder so the UI renders "未执行". Never
    // invent a bogus "PENDING_REVIEW" with fabricated win rates / impacted trades.
    //
    // DATA INTEGRITY: For hard_stop_loss_pct current_value, we MUST NOT hard-code
    // -0.0413 either (the user may change HARD_STOP_PCT in config.py). If the Python
    // engine failed to return real config-derived values, use null across the board
    // so the UI shows "—" rather than a potentially-out-of-sync constant.
    const realTradeDate = resolveRealTradeDate();
    iteration = {
      trade_date: (req.query.date as string) || realTradeDate || "",
      has_recommendation: false,
      status: "NOT_RUN",
      last_evaluated: new Date().toISOString().slice(0, 19).replace("T", " "),
      summary: null,
      config_diff: [
        {
          param_key: "limit_seal_ratio",
          param_name: "首板封单占比门槛",
          current_value: null,
          suggested_value: null,
          min_bound: 0.10,
          max_bound: 0.35,
          step: 0.01,
          unit: "%",
          reason: null,
        },
        {
          param_key: "open_turnover_rate",
          param_name: "开盘换手率下限",
          current_value: null,
          suggested_value: null,
          min_bound: 0.015,
          max_bound: 0.060,
          step: 0.005,
          unit: "%",
          reason: null,
        },
        {
          param_key: "hard_stop_loss_pct",
          param_name: "防洗盘硬止损线",
          current_value: null,
          suggested_value: null,
          min_bound: -0.060,
          max_bound: -0.025,
          step: 0.002,
          unit: "%",
          reason: null,
        },
      ],
      metrics: {},
      equity_curve: [],
      impacted_trades: [],
      note:
        "前端回退占位：Python iteration_engine.load_iteration() 未返回可用记录。" +
        "所有 current_value 统一为 null（拒绝硬编码兜底）；未执行真实影子回测，" +
        "因此胜率、净值曲线和受影响成交明细均为空。请运行盘后复盘接口或 " +
        "iteration_engine.run_daily_post_mortem_and_shadow_test() 生成真实数据。",
    };
  }
  res.json({ success: true, data: iteration });
});

// 12. Run Shadow Backtest on demand
app.post("/api/iteration/run", async (req, res) => {
  try {
    const realTradeDate = resolveRealTradeDate();
    const date = (req.body.date as string) || realTradeDate || "";
    const { stdout } = await execAsync(`python3 -c "
import json
from quant_system.core.iteration import iteration_engine
print(json.dumps(iteration_engine.run_daily_post_mortem_and_shadow_test('${date}')))
"`, { cwd: process.cwd() });
    
    const result = JSON.parse(stdout.trim());
    res.json({ success: true, message: "影子回测与策略归因评估完成", data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 13. Approve Iteration Parameters
app.post("/api/iteration/approve", async (req, res) => {
  try {
    const modifiedParams = req.body.params || null;
    const jsonStr = JSON.stringify(modifiedParams).replace(/"/g, '\\"');
    const { stdout } = await execAsync(`python3 -c "
import json
from quant_system.core.iteration import iteration_engine
params = json.loads('${jsonStr}') if '${jsonStr}' != 'null' else None
print(json.dumps(iteration_engine.approve_recommendation(params)))
"`, { cwd: process.cwd() });
    
    const result = JSON.parse(stdout.trim());
    res.json({ success: true, message: "参数已成功审批并热加载上线", data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 14. Reject Iteration Recommendation
app.post("/api/iteration/reject", async (req, res) => {
  try {
    const reason = req.body.reason || "人工驳回";
    const { stdout } = await execAsync(`python3 -c "
import json
from quant_system.core.iteration import iteration_engine
print(json.dumps(iteration_engine.reject_recommendation('${reason}')))
"`, { cwd: process.cwd() });
    
    const result = JSON.parse(stdout.trim());
    res.json({ success: true, message: "已驳回本次微调建议", data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ----------------------------------------------------------------------------
// VITE SPA MIDDLEWARE SETUP
// ----------------------------------------------------------------------------
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Quant Server] Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
