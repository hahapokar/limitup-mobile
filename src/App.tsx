import React, { useState, useEffect, useCallback, useRef } from "react";
import { Header } from "./components/Header";
import { SentimentView } from "./components/SentimentView";
import { CandidatesView } from "./components/CandidatesView";
import { PortfolioView } from "./components/PortfolioView";
import { LimitUpPoolView } from "./components/LimitUpPoolView";
import { SettingsView } from "./components/SettingsView";
import { IterationView } from "./components/IterationView";
import { ReviewAttributionView } from "./components/ReviewAttributionView";
import { SellAlertModal } from "./components/SellAlertModal";
import { 
  SentimentData, 
  CandidatesPayload, 
  PortfolioState, 
  CandidateStock,
  IterationData,
  SellAlertCardData,
  ReviewAttributionPayload,
  MarketSessionInfo
} from "./types";

export function App() {
  const [activeTab, setActiveTab] = useState<string>("portfolio");
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [syncLoading, setSyncLoading] = useState<boolean>(false);
  const [timelineLoading, setTimelineLoading] = useState<boolean>(false);

  // --- SILENT REFRESH CONTROL ---------------------------------------------
  // True once the very first "full" fetch finishes. From that point onwards
  // the interval heartbeat NEVER shows full-screen skeletons / spinners again.
  const [firstLoadDone, setFirstLoadDone] = useState<boolean>(false);
  // Guards against overlapping ticks inside the 3s / 15s loop.
  const pollInFlightRef = useRef<boolean>(false);
  
  // Data States
  const [sentiment, setSentiment] = useState<SentimentData | null>(null);
  const [candidatesPayload, setCandidatesPayload] = useState<CandidatesPayload | null>(null);
  const [limitupPool, setLimitupPool] = useState<CandidateStock[]>([]);
  const [portfolio, setPortfolio] = useState<PortfolioState | null>(null);
  const [iteration, setIteration] = useState<IterationData | null>(null);
  const [iterationLoading, setIterationLoading] = useState<boolean>(false);
  const [reviewData, setReviewData] = useState<ReviewAttributionPayload | null>(null);
  const [marketSession, setMarketSession] = useState<MarketSessionInfo | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Interval timer reference
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  // --- HEARTBEAT CADENCE (as requested: 仅模拟盘/已买入股票需要实时盯盘) ---
  //  * Non-trading window: no polling at all (idle).
  //  * Trading + NON-EMPTY holdings: short-ish 6s tick for watchlist price /
  //    trailing-stop monitoring.
  //  * Trading + ZERO holdings: 45s lazy tick. With nothing in-watchlist we
  //    don't need 3s churn. Buying happens only at 09:30 (scheduler fires it).
  // -------------------------------------------------------------------------
  const computeIntervalMs = useCallback((): number | null => {
    if (!marketSession?.is_trading_active) return null; // off-hours: no tick
    const holdings = portfolio?.holdings || [];
    return holdings.length > 0 ? 6000 : 45000;
  }, [marketSession?.is_trading_active, portfolio?.holdings]);

  // Dismissed alert IDs to prevent repetitive alerts
  const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem("dismissed_sell_alerts");
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch {
      return new Set();
    }
  });

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  // Fetch ALL core system data (full payload, used ONLY for FIRST page load
  // and user-initiated manual refresh actions).
  //
  // PERFORMANCE / "Never hang on spinner" contract:
  //  * All 7 endpoints run in parallel via Promise.all — so total time is the
  //    SLOWEST single endpoint (not the sum).
  //  * 4s hard cap via AbortController. Any endpoint still in-flight after 4s
  //    gets aborted so we hit the finally block, flip firstLoadDone, and show
  //    whatever data we managed to get. The loading skeleton is GUARANTEED to
  //    disappear within 4 seconds.
  //  * During non-trading hours, we intentionally avoid calling
  //    /api/portfolio/sync here (pure cache GET only).
  const fetchAllData = useCallback(async () => {
    // ---- Hard timeout setup --------------------------------------------------
    const abortCtl = new AbortController();
    const hardTimeoutMs = 4000;
    const timeoutId = setTimeout(() => abortCtl.abort(), hardTimeoutMs);
    const signal = abortCtl.signal;

    try {
      // ---- 1) Status — fetched first so we know how to fetch portfolio --------
      let currentSession: MarketSessionInfo | null = null;
      try {
        const statusRes = await fetch("/api/status", { signal });
        const statusJson = await statusRes.json();
        currentSession =
          statusJson.success && statusJson.data?.market_session
            ? statusJson.data.market_session
            : null;
        if (currentSession) setMarketSession(currentSession);
      } catch { /* swallow; setters below use best-effort data */ }

      // ---- 2) Everything else in parallel (total time = max single endpoint) ---
      const [sentimentJson, candJson, poolJson, portJson, iterJson, reviewJson] =
        await Promise.all([
          fetch("/api/sentiment", { signal }).then((r) => r.json()).catch(() => ({ success: false })),
          fetch("/api/candidates", { signal }).then((r) => r.json()).catch(() => ({ success: false })),
          fetch("/api/limitup-pool", { signal }).then((r) => r.json()).catch(() => ({ success: false })),
          // Portfolio: active session => sync (blocking, user-visible load so ok)
          //            else          => pure cache GET
          (currentSession?.is_trading_active
            ? fetch("/api/portfolio/sync", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ date: "", blocking: true }),
                signal
              }).then((r) => r.json()).catch(() => ({ success: false }))
            : fetch("/api/portfolio", { signal }).then((r) => r.json()).catch(() => ({ success: false }))
          ),
          fetch("/api/iteration/data", { signal }).then((r) => r.json()).catch(() => ({ success: false })),
          fetch("/api/review/aug24-evaluation", { signal }).then((r) => r.json()).catch(() => ({ success: false })),
        ]);

      if (sentimentJson.success) setSentiment(sentimentJson.data);
      if (candJson.success) setCandidatesPayload(candJson.data);
      if (poolJson.success) setLimitupPool(poolJson.data);
      if (portJson.success) setPortfolio(portJson.data);
      if (iterJson.success) setIteration(iterJson.data);
      if (reviewJson.success) setReviewData(reviewJson.data);
    } catch (err) {
      // AbortError (timeout) or network failure — we still want firstLoadDone
      // flipped below so the skeleton screen disappears.
      console.warn("fetchAllData aborted / failed (partial data will show):", err);
    } finally {
      clearTimeout(timeoutId);
      setFirstLoadDone(true);
    }
  }, []);

  // ---------------------------------------------------------------------------
  // SILENT HEARTBEAT — used by the 6s / 45s polling loop.
  // * NEVER shows spinners / skeletons (preserves old UI state while refreshing).
  // * ZERO holdings + trading session → pure GET /portfolio (cache only, NO
  //   python fork). There is nothing in the watchlist to watch; new buys fire
  //   only once at 09:30 via the scheduler.
  // * NON-ZERO holdings + trading session → POST /sync?watchlist_only (so the
  //   backend skips candidate reads/sentiment buys, only monitors exits and
  //   refreshes quotes for active holdings).
  // * Skips sentiment / candidates / limitup / iteration / review because
  //   those are end-of-day artifacts refreshed once at 15:30 + 15:35.
  // ---------------------------------------------------------------------------
  const pollSilentTick = useCallback(async () => {
    if (pollInFlightRef.current) return;
    pollInFlightRef.current = true;
    try {
      // 1. Status (cheap, <10ms, needed so we can short-circuit when off-hours)
      const statusRes = await fetch("/api/status");
      const statusJson = await statusRes.json();
      const currentSession: MarketSessionInfo | null =
        statusJson.success && statusJson.data?.market_session
          ? statusJson.data.market_session
          : null;
      if (currentSession) setMarketSession(currentSession);

      const holdings = portfolio?.holdings || [];
      const hasOpenPositions = holdings.length > 0;

      // Off-hours or no-positions with no reason to buy → cheap cache read.
      if (!currentSession?.is_trading_active || !hasOpenPositions) {
        const portRes = await fetch("/api/portfolio");
        const portJson = await portRes.json();
        if (portJson.success) setPortfolio(portJson.data);
        return;
      }

      // 2. We have something in the watchlist → background watchlist refresh.
      //    Server replies in <50ms with last-known-good cache; python refreshes
      //    exit-monitoring + holding quotes without blocking the UI.
      try {
        const syncRes = await fetch("/api/portfolio/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            date: sentiment?.trade_date || "",
            blocking: false,
            watchlist_only: true,
          }),
        });
        const syncJson = await syncRes.json();
        if (syncJson.success) setPortfolio(syncJson.data);
      } catch {
        // Fallback — just return what we cached last time
        const portRes = await fetch("/api/portfolio");
        const portJson = await portRes.json();
        if (portJson.success) setPortfolio(portJson.data);
      }
    } catch (err) {
      console.warn("Silent poll tick failed (will retry on next interval):", err);
    } finally {
      pollInFlightRef.current = false;
    }
  }, [sentiment?.trade_date, portfolio?.holdings]);

  // Timeline step simulation handler
  const handleTimelineStep = async (step: string) => {
    setTimelineLoading(true);
    try {
      const res = await fetch("/api/timeline/step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step })
      });
      const json = await res.json();
      if (json.success) {
        if (json.data.portfolio) setPortfolio(json.data.portfolio);
        if (json.data.reviewData) setReviewData(json.data.reviewData);
        showToast(`✓ 时间轴已切换: ${json.message}`);
      }
    } catch (err: any) {
      showToast(`❌ 切换失败: ${err.message}`);
    } finally {
      setTimelineLoading(false);
    }
  };

  // Realtime manual sync handler
  const handleSyncRealtimePortfolio = async () => {
    setSyncLoading(true);
    try {
      const res = await fetch("/api/portfolio/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: sentiment?.trade_date || "" })
      });
      const json = await res.json();
      if (json.success) {
        setPortfolio(json.data);
        showToast("✓ 盯盘清单与行情已实时刷新！");
      }
    } catch (err: any) {
      showToast(`❌ 刷新失败: ${err.message}`);
    } finally {
      setSyncLoading(false);
    }
  };

  // Manual sell position handler
  const handleManualSellPosition = async (code: string) => {
    try {
      const res = await fetch("/api/portfolio/sell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, reason: "用户在盯盘清单手动平仓" })
      });
      const json = await res.json();
      if (json.success) {
        setPortfolio(json.data);
        showToast(`✓ 标的 ${code} 已完成平仓撮合并结算收益！`);
      } else {
        showToast(`❌ 平仓失败: ${json.error}`);
      }
    } catch (err: any) {
      showToast(`❌ 异常: ${err.message}`);
    }
  };

  const handleDismissAlert = (alertId: string) => {
    setDismissedAlerts((prev) => {
      const next = new Set(prev);
      next.add(alertId);
      try {
        localStorage.setItem("dismissed_sell_alerts", JSON.stringify(Array.from(next)));
      } catch {}
      return next;
    });
  };

  const handleDismissAllAlerts = () => {
    const allIds = (portfolio?.recent_sell_alerts || []).map((a) => a.alert_id);
    setDismissedAlerts((prev) => {
      const next = new Set([...Array.from(prev), ...allIds]);
      try {
        localStorage.setItem("dismissed_sell_alerts", JSON.stringify(Array.from(next)));
      } catch {}
      return next;
    });
  };

  const fetchIteration = useCallback(async () => {
    setIterationLoading(true);
    try {
      const res = await fetch("/api/iteration/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: sentiment?.trade_date || "" })
      });
      const json = await res.json();
      if (json.success) {
        setIteration(json.data);
        showToast("✓ 影子回测与策略归因评估完成！");
      }
    } catch (err) {
      console.error("Error running iteration shadow backtest:", err);
    } finally {
      setIterationLoading(false);
    }
  }, [sentiment?.trade_date]);

  const handleApproveIteration = async (customParams?: Record<string, number>) => {
    setIterationLoading(true);
    try {
      const res = await fetch("/api/iteration/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ params: customParams || null })
      });
      const json = await res.json();
      if (json.success) {
        showToast("✓ 策略自迭代微调参数已热更新上线！");
        await fetchAllData();
      }
    } catch (err: any) {
      showToast(`❌ 审批失败: ${err.message}`);
    } finally {
      setIterationLoading(false);
    }
  };

  const handleRejectIteration = async () => {
    setIterationLoading(true);
    try {
      const res = await fetch("/api/iteration/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "人工复核后驳回" })
      });
      const json = await res.json();
      if (json.success) {
        showToast("已驳回本次自迭代建议，保持线上原有参数运行。");
        await fetchAllData();
      }
    } catch (err: any) {
      showToast(`❌ 驳回失败: ${err.message}`);
    } finally {
      setIterationLoading(false);
    }
  };

  // Initial Load & Dynamic Polling:
  // - First page load: full fetch + skeletons until done.
  // - HEARTBEAT RULE (user-requested: 只有模拟盘与已买入股票盯盘是实时的，
  //                    其余都在15:30后盘后运行一次即可):
  //   * Off-hours (computeIntervalMs returns null) → no polling at all.
  //   * Trading + NON-EMPTY holdings → 6s tick.
  //   * Trading + ZERO holdings → 45s tick.
  useEffect(() => {
    fetchAllData();

    // Safety net — never show the full-screen spinner longer than 5s.
    const failSafe = setTimeout(() => {
      setFirstLoadDone((prev) => (prev ? prev : true));
    }, 5000);
    return () => clearTimeout(failSafe);
  }, [fetchAllData]);

  useEffect(() => {
    const intervalMs = computeIntervalMs();

    // Off-hours: kill the timer (satisfies "非交易时间/无持仓 → 不轮询").
    if (intervalMs == null) {
      return;
    }

    const interval = setInterval(() => {
      if (firstLoadDone) {
        pollSilentTick();
      } else {
        fetchAllData();
      }
    }, intervalMs);

    return () => clearInterval(interval);
  }, [
    computeIntervalMs,
    pollSilentTick,
    fetchAllData,
    firstLoadDone,
  ]);

  // Action Handlers
  const handleRunReview = async () => {
    setLoadingAction("review");
    try {
      const res = await fetch("/api/action/run-review", { method: "POST" });
      const json = await res.json();
      if (json.success) {
        showToast("✓ 盘后大盘情绪与四大因子量化选股复盘完成！");
        await fetchAllData();
        setActiveTab("aug24review");
      } else {
        showToast(`❌ 复盘失败: ${json.error}`);
      }
    } catch (err: any) {
      showToast(`❌ 异常: ${err.message}`);
    } finally {
      setLoadingAction(null);
    }
  };

  const handleResetAccount = async () => {
    if (!window.confirm("确定要清空模拟盘数据并重置为 10 万元本金吗？")) {
      return;
    }
    setLoadingAction("reset");
    try {
      const res = await fetch("/api/action/reset-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capital: 100000.0 })
      });
      const json = await res.json();
      if (json.success) {
        showToast("✓ 模拟盘账户已清空重置为 ¥100,000 初始本金！");
        await fetchAllData();
      }
    } catch (err: any) {
      showToast(`❌ 重置异常: ${err.message}`);
    } finally {
      setLoadingAction(null);
    }
  };

  // Filter active un-dismissed sell alerts
  const activeSellAlerts: SellAlertCardData[] = (portfolio?.recent_sell_alerts || []).filter(
    (a) => !dismissedAlerts.has(a.alert_id)
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-red-500 selection:text-white">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl bg-slate-800 border border-slate-700 text-slate-100 text-sm shadow-2xl flex items-center gap-3 animate-fade-in">
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Sell Alert Modal Popups for Strategies */}
      <SellAlertModal
        alerts={activeSellAlerts}
        onDismiss={handleDismissAlert}
        onDismissAll={handleDismissAllAlerts}
      />

      {/* Navigation Header */}
      <Header
        nav={portfolio?.nav ?? 1.0}
        totalAsset={portfolio?.total_asset ?? 100000}
        tradeDate={sentiment?.trade_date || ""}
        sentimentScore={sentiment?.sentiment_score ?? 0}
        circuitBreaker={sentiment?.sentiment_circuit_breaker ?? false}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onRunReview={handleRunReview}
        onResetAccount={handleResetAccount}
        loadingAction={loadingAction}
        marketSession={marketSession}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6">
        {activeTab === "portfolio" && (
          <PortfolioView 
            portfolio={portfolio} 
            // Full-screen loading only on pure cold start. Once firstLoadDone
            // flips to true (≤5s guaranteed) we NEVER block the UI again.
            loading={!firstLoadDone && portfolio === null}
            onSyncRealtime={handleSyncRealtimePortfolio}
            onManualSell={handleManualSellPosition}
            syncLoading={syncLoading}
          />
        )}

        {activeTab === "aug24review" && (
          <ReviewAttributionView
            data={reviewData}
            portfolio={portfolio}
            onTimelineStep={handleTimelineStep}
            loadingStep={timelineLoading}
            onNavigateToPortfolio={() => setActiveTab("portfolio")}
          />
        )}

        {activeTab === "candidates" && (
          <CandidatesView payload={candidatesPayload} loading={!firstLoadDone && !candidatesPayload} />
        )}

        {activeTab === "iteration" && (
          <IterationView
            data={iteration}
            loading={!firstLoadDone && !iteration}
            onRefresh={fetchIteration}
            onApprove={handleApproveIteration}
            onReject={handleRejectIteration}
            actionLoading={iterationLoading}
          />
        )}

        {activeTab === "sentiment" && (
          <SentimentView sentiment={sentiment} loading={!firstLoadDone && !sentiment} />
        )}

        {activeTab === "limitup" && (
          <LimitUpPoolView
            pool={limitupPool}
            loading={!firstLoadDone && limitupPool.length === 0}
            tradeDate={sentiment?.trade_date || ""}
          />
        )}

        {activeTab === "settings" && (
          <SettingsView />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950 py-4 text-center text-xs text-slate-400">
        A-Share Limit-Up Quant Trading System · 严禁伪造Mock数据 · 基于 AkShare / 东方财富 / 新浪 / 腾讯 真实行情接口与分位数打分模型
      </footer>
    </div>
  );
}

export default App;

