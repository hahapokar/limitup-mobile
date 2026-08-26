import React, { useState } from "react";
import { 
  CheckCircle2, 
  AlertTriangle, 
  TrendingUp, 
  HelpCircle, 
  Zap, 
  ShieldCheck, 
  Layers, 
  ArrowRight,
  Sparkles,
  Calendar,
  Lock,
  ChevronRight,
  TrendingDown,
  Info,
  Target,
  BarChart3,
  Rocket,
  Activity,
  XCircle,
  Award
} from "lucide-react";
import { 
  ReviewAttributionPayload, 
  PortfolioState, 
  PrevDayCandidateItem,
  ClosedPositionAttributionItem,
  ConsecutiveBoardSuccessItem,
  NextDayPredictionItem
} from "../types";

type DeepReviewTab = "top8_eval" | "runners_attr" | "next_candidates" | "prev_day_review" | "closed_attr" | "cb_success" | "next_day_pred";

interface ReviewAttributionViewProps {
  data: ReviewAttributionPayload | null;
  portfolio: PortfolioState | null;
  onTimelineStep: (step: string) => void;
  loadingStep: boolean;
  onNavigateToPortfolio: () => void;
}

export const ReviewAttributionView: React.FC<ReviewAttributionViewProps> = ({
  data,
  portfolio,
  onTimelineStep,
  loadingStep,
  onNavigateToPortfolio
}) => {
  const [activeSection, setActiveSection] = useState<DeepReviewTab>("prev_day_review");

  if (!data) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center">
        <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center mx-auto mb-4 text-slate-400">
          <Calendar className="w-6 h-6" />
        </div>
        <h3 className="text-base font-bold text-slate-200 mb-2">正在载入真实盘后复盘评估与归因数据...</h3>
        <p className="text-sm text-slate-400 max-w-md mx-auto">系统正在连接量化复盘引擎并计算逐笔评估指标。</p>
      </div>
    );
  }

  const currentStep = portfolio?.current_step || "WAITING_NEXT_OPEN";
  const prevDate = data.prev_trade_date || "—";
  const reviewDate = data.review_date || "—";
  const nextDate = data.next_trade_date || "—";

  // Safe number formatter
  const fmt = (v: any, digits = 2, prefix = "", suffix = "") =>
    v != null && typeof v === "number" && !isNaN(v)
      ? `${prefix}${v.toFixed(digits)}${suffix}`
      : "--";

  const pctColor = (v: any) =>
    v == null ? "text-slate-400" : typeof v === "number" && v >= 0 ? "text-red-400" : "text-emerald-400";

  const outcomeBadge = (outcome?: string) => {
    const map: Record<string, { label: string; cls: string }> = {
      SUCCESS_CONSECUTIVE_BOARD: { label: "连板晋级", cls: "bg-red-900/70 border-red-500 text-red-300" },
      SUCCESS_LIMIT_UP: { label: "再次涨停", cls: "bg-red-900/60 border-red-500/70 text-red-300" },
      WATCHLIST_ONLY: { label: "未建仓候选", cls: "bg-blue-900/60 border-blue-500/60 text-blue-300" },
      LOSS_EXIT: { label: "亏损离场", cls: "bg-emerald-900/60 border-emerald-500/60 text-emerald-300" },
      UNDERPERFORM_WEAK: { label: "表现偏弱", cls: "bg-amber-900/50 border-amber-500/50 text-amber-300" },
      HOLDING_NORMAL: { label: "持有中", cls: "bg-slate-700/60 border-slate-500/60 text-slate-200" },
    };
    const m = map[outcome || ""] || { label: outcome || "—", cls: "bg-slate-700/60 border-slate-500/60 text-slate-200" };
    return <span className={`px-2 py-0.5 rounded border text-[11px] font-semibold ${m.cls}`}>{m.label}</span>;
  };

  const dirBadge = (dir?: string, conf?: number) => {
    let cls = "bg-slate-700/60 border-slate-500/60 text-slate-200";
    if (dir?.includes("看涨") && conf && conf >= 75) cls = "bg-red-900/70 border-red-500 text-red-300";
    else if (dir?.includes("看涨")) cls = "bg-red-900/50 border-red-500/60 text-red-300";
    else if (dir?.includes("观望") || dir?.includes("偏空")) cls = "bg-emerald-900/50 border-emerald-500/60 text-emerald-300";
    return <span className={`px-2 py-0.5 rounded border text-[11px] font-semibold ${cls}`}>{dir || "—"} {conf ? `${conf}%` : ""}</span>;
  };

  // Normalize legacy sections
  const top8Evals = (data.aug21_top4_evaluations || data.top_candidate_evaluations || []).map((item: any) => ({
    ...item,
    aug21_rank: item.aug21_rank ?? item.review_rank ?? item.rank,
    aug21_score: item.aug21_score ?? item.quant_score,
    aug24_open_price: item.aug24_open_price ?? item.price,
    aug24_open_pct: item.aug24_open_pct ?? item.change_pct,
    aug24_close_price: item.aug24_close_price ?? item.price,
    aug24_close_pct: item.aug24_close_pct ?? item.change_pct,
    aug24_intraday_high: item.aug24_intraday_high ?? null,
    aug24_intraday_low: item.aug24_intraday_low ?? null,
    aug24_seal_time: item.aug24_seal_time ?? item.first_seal_time ?? "—",
    aug24_seal_ratio: item.aug24_seal_ratio ?? item.seal_ratio_pct ?? null,
    aug24_turnover: item.aug24_turnover ?? item.turnover_rate ?? null,
  }));

  const runnersAttrs = (data.aug24_consecutive_board_attributions || data.lower_ranked_attributions || []).map((runner: any) => ({
    ...runner,
    aug21_rank: runner.aug21_rank ?? runner.rank,
    aug21_score: runner.aug21_score ?? runner.quant_score,
    aug24_board_status: runner.aug24_board_status ?? (runner.consecutive_boards ? `${runner.consecutive_boards}连板` : "—"),
    aug24_change_pct: runner.aug24_change_pct ?? runner.change_pct,
    why_not_in_top5: runner.why_not_in_top5 ?? runner.why_not_in_topN ?? "暂无归因分析数据。",
  }));

  const nextDayCands = (data.aug25_recommended_candidates || data.next_day_recommended_candidates || []).map((cand: any) => ({
    ...cand,
    seal_ratio: cand.seal_ratio ?? cand.seal_ratio_pct ?? null,
  }));

  // Deep review sections data
  const pcr = data.prev_day_candidates_review;
  const prevDayItems: PrevDayCandidateItem[] = pcr?.items || [];
  const cpa = data.closed_positions_attribution;
  const closedItems: ClosedPositionAttributionItem[] = cpa?.items || [];
  const cbsA = data.consecutive_board_success_analysis;
  const cbSuccessItems: ConsecutiveBoardSuccessItem[] = cbsA?.items || [];
  const ndp = data.next_day_prediction;
  const predItems: NextDayPredictionItem[] = ndp?.item_predictions || [];

  const tabs: { key: DeepReviewTab; label: string; icon: any; badge?: string }[] = [
    { key: "prev_day_review", label: `T-1 候选复盘 (${prevDayItems.length})`, icon: Target, badge: prevDate !== "—" ? prevDate.slice(5) : undefined },
    { key: "closed_attr", label: `亏损离场归因 (${closedItems.length})`, icon: XCircle },
    { key: "cb_success", label: `连板成功分析 (${cbSuccessItems.length})`, icon: Award },
    { key: "next_day_pred", label: `T+1 表现预测 (${predItems.length})`, icon: Rocket },
    { key: "top8_eval", label: `当日 TOP8 复盘与开盘监控 (${top8Evals.length})`, icon: CheckCircle2 },
    { key: "runners_attr", label: `连板漏报归因 (${runnersAttrs.length})`, icon: HelpCircle },
    { key: "next_candidates", label: `次日候选池 (${nextDayCands.length})`, icon: Sparkles },
  ];

  const SentimentChip = ({ state, score }: { state?: string; score?: number }) => {
    let cls = "bg-slate-700/70 border-slate-500 text-slate-200";
    if (state?.includes("强势") || state?.includes("主升") || (typeof score === "number" && score >= 70)) cls = "bg-red-900/60 border-red-500/60 text-red-300";
    else if (state?.includes("回暖") || state?.includes("启动") || (typeof score === "number" && score >= 50)) cls = "bg-amber-900/50 border-amber-500/60 text-amber-300";
    else if (state?.includes("退潮") || state?.includes("弱势") || (typeof score === "number" && score < 35)) cls = "bg-emerald-900/50 border-emerald-500/60 text-emerald-300";
    return (
      <span className={`px-2 py-0.5 rounded border text-[11px] font-semibold ${cls}`}>
        {state || "—"} {score != null ? `· ${fmt(score, 1)}分` : ""}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* 1. Top Timeline Flow Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-md">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-3 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2 py-0.5 rounded bg-red-950/60 border border-red-500/40 text-red-400 font-mono text-xs font-semibold">
                复盘快照：{reviewDate} · 15:30 FINAL
              </span>
              <SentimentChip state={data.market_summary.sentiment_state} score={data.market_summary.sentiment_score} />
              <h2 className="text-lg font-bold text-slate-100">
                盘后选股复盘与次日交易准备
              </h2>
            </div>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
              <div className="rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2">
                <span className="text-slate-500 block">T-1 选股快照</span>
                <span className="text-slate-200 font-mono font-semibold">{prevDate}</span>
                <span className="text-slate-500 ml-1">供本次交易参考</span>
              </div>
              <div className="rounded-lg border border-red-900/60 bg-red-950/20 px-3 py-2">
                <span className="text-slate-500 block">T 日复盘快照</span>
                <span className="text-red-300 font-mono font-semibold">{reviewDate}</span>
                <span className="text-slate-500 ml-1">15:30 FINAL</span>
              </div>
              <div className="rounded-lg border border-amber-900/60 bg-amber-950/20 px-3 py-2">
                <span className="text-slate-500 block">T+1 执行日期</span>
                <span className="text-amber-300 font-mono font-semibold">{nextDate}</span>
                <span className="text-slate-500 ml-1">使用 T 日候选</span>
              </div>
            </div>
          </div>

          {/* Timeline Step Buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => onTimelineStep("RESET_100K")}
              disabled={loadingStep}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                currentStep === "WAITING_NEXT_OPEN" || currentStep === "AUG21_POST_MARKET"
                  ? "bg-amber-600/20 border-amber-500 text-amber-300 font-semibold"
                  : "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700"
              }`}
            >
              ① 空仓重置 (10万现金待命)
            </button>
            <button
              onClick={() => onTimelineStep("AUG24_BUY")}
              disabled={loadingStep}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                currentStep === "AUG24_WATCHLIST" || currentStep === "INTRADAY_WATCHLIST"
                  ? "bg-red-600/20 border-red-500 text-red-300 font-semibold shadow-sm"
                  : "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700"
              }`}
            >
              ② 模拟开盘建仓 (前日撮合)
            </button>
            <button
              onClick={() => onTimelineStep("AUG25_TRADE")}
              disabled={loadingStep}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                currentStep === "AUG25_TRADING"
                  ? "bg-emerald-600/20 border-emerald-500 text-emerald-300 font-semibold"
                  : "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700"
              }`}
            >
              ③ 次日 T+1 解锁与轮动
            </button>
          </div>
        </div>

        {/* Timeline Status Callout */}
        <div className="mt-3 flex flex-wrap items-center justify-between text-xs gap-3">
          <div className="flex flex-wrap items-center gap-3 text-slate-300">
            <div className="flex items-center gap-1 font-mono">
              <span className="text-slate-400">当前账户:</span>
              <span className="text-emerald-400 font-semibold">{portfolio?.current_step_name || "空仓待命 · 等待下一个开盘日"}</span>
            </div>
            <span className="text-slate-600">|</span>
            <div className="flex items-center gap-1">
              <span className="text-slate-400">全市场涨停:</span>
              <span className="text-red-400 font-mono font-semibold">{fmt(data.market_summary.total_limit_up_count, 0)} 只</span>
              {" "}<span className="text-slate-500">(连板 {fmt(data.market_summary.consecutive_limit_up_count, 0)} / 最高 {fmt(data.market_summary.max_consecutive_boards, 0)} 板)</span>
            </div>
            <span className="text-slate-600">|</span>
            <div className="flex items-center gap-1">
              <span className="text-slate-400">Top8 选股池:</span>
              <span className="text-red-400 font-semibold font-mono">{data.market_summary.top4_hit_rate || "—"}</span>
            </div>
            <span className="text-slate-600">|</span>
            <div className="flex items-center gap-1">
              <span className="text-slate-400">持仓总浮盈:</span>
              <span className={`font-semibold font-mono ${(data.market_summary.total_portfolio_floating_pnl ?? 0) >= 0 ? "text-red-400" : "text-emerald-400"}`}>
                {data.market_summary.total_portfolio_floating_pnl != null
                  ? `¥${data.market_summary.total_portfolio_floating_pnl.toFixed(2)} (${data.market_summary.total_portfolio_floating_pnl_pct?.toFixed(2)}%)`
                  : "-- (无真实行情)"}
              </span>
            </div>
          </div>
          <button
            onClick={onNavigateToPortfolio}
            className="flex items-center gap-1 text-red-400 hover:text-red-300 font-semibold hover:underline"
          >
            <span>进入实盘盯盘系统</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* T-1 Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center gap-2 text-slate-400 text-xs mb-1"><Target className="w-3.5 h-3.5" /><span>T-1 候选总数</span></div>
          <div className="text-2xl font-bold font-mono text-slate-100">{pcr?.total_reviewed ?? 0}<span className="text-xs text-slate-500 ml-1">只</span></div>
          <div className="text-[11px] text-slate-500 mt-1">胜率 {fmt(pcr?.hit_rate_pct, 1, "", "%")} · 平均 {fmt(pcr?.avg_pnl_pct, 2, "", "%")}</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center gap-2 text-red-400 text-xs mb-1"><Award className="w-3.5 h-3.5" /><span>连板成功晋级</span></div>
          <div className="text-2xl font-bold font-mono text-red-400">{pcr?.success_consecutive_board_count ?? 0}<span className="text-xs text-slate-500 ml-1">只</span></div>
          <div className="text-[11px] text-slate-500 mt-1">成功晋级连板梯队</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center gap-2 text-emerald-400 text-xs mb-1"><XCircle className="w-3.5 h-3.5" /><span>亏损离场</span></div>
          <div className="text-2xl font-bold font-mono text-emerald-400">{cpa?.loss_exit_count ?? 0}<span className="text-xs text-slate-500 ml-1">/{cpa?.total_exits ?? 0}</span></div>
          <div className="text-[11px] text-slate-500 mt-1">当日平仓归因追踪</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center gap-2 text-amber-400 text-xs mb-1"><Rocket className="w-3.5 h-3.5" /><span>T+1 情绪预期</span></div>
          <div className="text-lg font-bold font-mono text-amber-300 leading-snug truncate">
            {ndp?.prevailing_sentiment_state || "—"}
          </div>
          <div className="text-[11px] text-slate-500 mt-1 truncate">{ndp?.market_level_prediction || "暂无市场级预测"}</div>
        </div>
      </div>

      {/* 2. Main Tabs (7 sections) */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-2 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveSection(tab.key)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition ${
              activeSection === tab.key
                ? "bg-red-600 text-white shadow-md shadow-red-950"
                : "bg-slate-800/80 text-slate-300 hover:bg-slate-700"
            }`}
          >
            <tab.icon className="w-4 h-4" />
            <span>{tab.label}</span>
            {tab.badge && <span className={`ml-1 text-[10px] px-1.5 py-0.5 rounded ${activeSection === tab.key ? "bg-white/20 text-white" : "bg-slate-700 text-slate-300"}`}>{tab.badge}</span>}
          </button>
        ))}
      </div>

      {/* ========================================================= */}
      {/* Tab: T-1 候选复盘                                       */}
      {/* ========================================================= */}
      {activeSection === "prev_day_review" && (
        <div className="space-y-4">
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
            <div className="flex items-center gap-2 text-slate-200 text-sm font-semibold mb-2">
              <Target className="w-4 h-4 text-red-400" />
              <span>T-1（{pcr?.prev_trade_date || prevDate}）候选在 T 日（{pcr?.review_trade_date || reviewDate}）真实表现评估</span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              <strong className="text-amber-300">严格 T-1 对齐</strong>：
              所有"选股时的打分与因子拆分"均来自 <code className="px-1 py-0.5 rounded bg-slate-800 text-slate-300">candidates_{pcr?.prev_trade_date || prevDate}.json</code>，
              绝不使用 T 日行情去追溯解释 T-1 的决策。盈亏、连板、持仓变化等 T 日事实，则从 <code className="px-1 py-0.5 rounded bg-slate-800 text-slate-300">candidates_{pcr?.review_trade_date || reviewDate}.json</code> 及 <code className="px-1 py-0.5 rounded bg-slate-800 text-slate-300">portfolio_state.json</code> 读取。
            </p>
          </div>

          {prevDayItems.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-10 text-center text-slate-500 text-sm">
              <Calendar className="w-8 h-8 mx-auto mb-2 text-slate-600" />
              暂无 T-1 候选数据（portfolio 当日无开仓记录 + T-1 candidates 文件未找到）
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {prevDayItems.map((it, idx) => (
                <div key={`${it.code}-${idx}`} className="bg-slate-900 border border-slate-800 rounded-xl p-5 hover:border-slate-700 transition space-y-4">
                  {/* Header */}
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
                    <div className="flex items-center gap-3">
                      <span className="w-8 h-8 rounded-full bg-red-600/20 border border-red-500/40 text-red-400 font-mono font-bold text-xs flex items-center justify-center">
                        #{idx + 1}
                      </span>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-base font-bold text-slate-100">{it.name || "--"}</span>
                          <span className="text-xs font-mono text-slate-400">({it.code})</span>
                          <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">{it.sector || "—"}</span>
                          {outcomeBadge(it.outcome)}
                          {it.from_portfolio_buy && <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-900/50 border-amber-500/50 text-amber-300 font-semibold">★ 模拟盘实际买入</span>}
                          {!it.from_portfolio_buy && <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-900/50 border-blue-500/50 text-blue-300 font-semibold">候选未建仓</span>}
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5">
                          T-1 ({pcr?.prev_trade_date || prevDate}) 量化打分:
                          <span className="text-red-400 font-mono font-semibold ml-1">{fmt(it.prev_day_quant_score, 2)} 分</span>
                          <span className="ml-1">(排第 {fmt(it.prev_day_rank, 0)} 名)</span>
                          {it.from_portfolio_buy
                            ? <>{" · "}实际买入价 <span className="text-slate-200 font-mono">{fmt(it.buy_price, 2, "¥")}</span></>
                            : <>{" · "}<span className="text-blue-300">本次未建仓，仅回看候选表现</span></>}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <div className="text-xs text-slate-400">{it.from_portfolio_buy ? "累计 PnL" : "候选结果"}</div>
                        <div className={`text-lg font-bold font-mono ${pctColor(it.pnl_pct)}`}>
                          {it.from_portfolio_buy ? fmt(it.pnl_pct, 2, "", "%") : "未建仓"}
                          {it.pnl_amount != null ? <span className="text-xs font-normal text-slate-400 ml-1">({it.pnl_amount >= 0 ? "+" : ""}¥{it.pnl_amount.toFixed(2)})</span> : null}
                        </div>
                      </div>
                      <div className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs font-semibold text-slate-200 max-w-65">
                        {it.outcome_cn || "—"}
                      </div>
                    </div>
                  </div>

                  {/* Metrics Grid: T-1 vs T */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 bg-slate-950/60 p-3 rounded-lg border border-slate-800/60 text-xs font-mono">
                    <div>
                      <span className="text-slate-500 block">T-1 收盘 / 连板</span>
                      <span className="text-slate-200 font-bold text-sm">{fmt(it.prev_day_close_price, 2, "¥")}</span>
                      <span className="block text-[11px] text-amber-400">{it.prev_day_consecutive_boards ?? 0} 连板</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">T 日收盘 / 涨跌幅</span>
                      <span className="text-slate-200 font-bold text-sm">{fmt(it.today_close_price, 2, "¥")}</span>
                      <span className={`block text-[11px] ${pctColor(it.today_change_pct)}`}>{fmt(it.today_change_pct, 2, "+", "%")}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">T 日连板 / 排名</span>
                      <span className="text-red-400 font-bold text-sm">{fmt(it.today_consecutive_boards, 0)} 板</span>
                      <span className="block text-[11px] text-slate-400">T 日量化排名 #{fmt(it.today_rank_in_candidates, 0)}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">T 日封板 / 开板</span>
                      <span className="text-slate-300">{it.today_first_seal_time || "—"}</span>
                      <span className="block text-[11px] text-slate-400">封成比 {fmt(it.today_seal_ratio_pct, 1, "", "%")} · 炸板 {it.today_broken_count ?? 0} 次</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">T 日换手率</span>
                      <span className={`font-bold text-sm ${(it.today_turnover_rate ?? 0) >= 18 ? "text-amber-400" : "text-slate-200"}`}>{fmt(it.today_turnover_rate, 1, "", "%")}</span>
                      <span className="block text-[11px] text-slate-500">{(it.today_turnover_rate ?? 0) >= 18 ? "⚠ 偏高，筹码兑现风险" : "—"}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">持仓状态</span>
                      <span className={`text-sm font-semibold ${it.still_holding ? "text-amber-400" : "text-slate-400"}`}>
                        {it.still_holding ? "🟡 仍持有" : "✅ 已平 / 未建"}
                      </span>
                      {it.exit_logs && it.exit_logs.length > 0 && (
                        <span className="block text-[11px] text-slate-500 truncate">最近卖出: {it.exit_logs[0].time || "--"} @¥{it.exit_logs[0].sell_price || "--"}</span>
                      )}
                    </div>
                  </div>

                  {/* Buy Reason + Factor score comparison */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="bg-slate-800/40 p-3 rounded-lg border border-slate-700/50 text-xs text-slate-300 leading-relaxed">
                      <div className="font-semibold text-slate-200 mb-1 flex items-center gap-1.5">
                        <Info className="w-3.5 h-3.5 text-blue-400" />
                        <span>T-1 当时选股/买入理由</span>
                      </div>
                      <p>{it.buy_reason || "无买入原因记录"}</p>
                    </div>
                    <div className="bg-slate-800/40 p-3 rounded-lg border border-slate-700/50 text-xs text-slate-300 leading-relaxed">
                      <div className="font-semibold text-slate-200 mb-1 flex items-center gap-1.5">
                        <Activity className="w-3.5 h-3.5 text-amber-400" />
                        <span>评估结论（基于 T 日真实表现）</span>
                      </div>
                      <p>
                        {(() => {
                          const loss = typeof it.pnl_pct === "number" && it.pnl_pct < 0;
                          if (it.outcome === "SUCCESS_CONSECUTIVE_BOARD") {
                            return `✅ 成功连板晋级（T-1 ${it.prev_day_consecutive_boards ?? 0} 板 → T 日 ${it.today_consecutive_boards ?? 0} 板），模型当时打分 ${fmt(it.prev_day_quant_score, 2)} 准确抓住接力节奏。`;
                          }
                          if (it.outcome === "SUCCESS_LIMIT_UP") {
                            return `✅ T 日再封涨停，选股当日预判的上涨逻辑得到验证。`;
                          }
                          if (loss) {
                            return `❌ 表现不及预期（PnL ${fmt(it.pnl_pct, 2, "", "%")}）。T-1 虽打分 ${fmt(it.prev_day_quant_score, 2)} 但 T 日出现走势走弱，详见【亏损离场归因】。`;
                          }
                          if (it.outcome === "UNDERPERFORM_WEAK") {
                            return `⚠ T 日走势偏弱（T 日涨跌仅 {fmt(it.today_change_pct, 2, '+', '%')}），尚未进入涨停接力梯队，或板块持续性不足。`;
                          }
                          return `持仓中，当前浮盈浮亏 ${fmt(it.pnl_pct, 2, "", "%")}，继续观察 T+1 开盘竞价承接。`;
                        })()}
                      </p>
                    </div>
                  </div>

                  {/* Factor breakdown comparison T-1 vs T */}
                  {(it.prev_day_factor_breakdown || it.today_factor_breakdown) && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {(["seal_strength", "chip_structure", "sector_resonance", "consecutive_board_sentiment"] as const).map((fk) => {
                        const label = { seal_strength: "封板强度", chip_structure: "筹码结构", sector_resonance: "板块共振", consecutive_board_sentiment: "连板情绪" }[fk];
                        const prevScore = (it.prev_day_factor_breakdown?.[fk] as any)?.score;
                        const todayScore = (it.today_factor_breakdown?.[fk] as any)?.score;
                        const diff = (typeof prevScore === "number" && typeof todayScore === "number") ? todayScore - prevScore : null;
                        return (
                          <div key={fk} className="bg-slate-950/60 p-3 rounded-lg border border-slate-800 text-xs">
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="font-semibold text-slate-200">{label}</span>
                              <span className={`text-[11px] font-mono ${diff == null ? "text-slate-500" : diff >= 0 ? "text-red-400" : "text-emerald-400"}`}>
                                {diff == null ? "" : `${diff >= 0 ? "▲" : "▼"} ${Math.abs(diff).toFixed(1)}`}
                              </span>
                            </div>
                            <div className="flex items-center justify-between font-mono">
                              <div>
                                <div className="text-[10px] text-slate-500">T-1 打分</div>
                                <div className={`font-bold ${(prevScore ?? 0) >= 70 ? "text-red-400" : (prevScore ?? 0) >= 50 ? "text-amber-400" : "text-slate-400"}`}>
                                  {fmt(prevScore, 1)} 分
                                </div>
                              </div>
                              <ChevronRight className="w-4 h-4 text-slate-600" />
                              <div className="text-right">
                                <div className="text-[10px] text-slate-500">T 日打分</div>
                                <div className={`font-bold ${(todayScore ?? 0) >= 70 ? "text-red-400" : (todayScore ?? 0) >= 50 ? "text-amber-400" : "text-slate-400"}`}>
                                  {fmt(todayScore, 1)} 分
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ========================================================= */}
      {/* Tab: 亏损离场归因                                        */}
      {/* ========================================================= */}
      {activeSection === "closed_attr" && (
        <div className="space-y-4">
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
            <div className="flex items-center gap-2 text-slate-200 text-sm font-semibold mb-2">
              <XCircle className="w-4 h-4 text-emerald-400" />
              <span>当日（{cpa?.attribution_date || reviewDate}）平仓归因 · 为什么高打分标的表现差？</span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              归因遵循<strong className="text-slate-200">根因链顺序</strong>：
              ① 封板被多次砸开（broken_count ≥ 2）→ ② 封成比坍塌（&lt; 10%）→ ③ 换手率飙升（≥ 15%）→ ④ 高连板梯队空间耗尽 → ⑤ 排名跌出 TOP10 → ⑥ 板块共振退潮。若以上均不成立，则归为"规则正常止盈/止损，结构性因子无明显恶化"。
            </p>
          </div>

          {closedItems.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-10 text-center text-slate-500 text-sm">
              <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-emerald-600" />
              {reviewDate} 当日无平仓记录，全部持仓仍在持有。
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {closedItems.map((it, idx) => (
                <div key={`${it.code}-${idx}`} className={`bg-slate-900 border rounded-xl p-5 hover:border-slate-700 transition space-y-4 ${it.is_loss_exit ? "border-emerald-800/70" : "border-slate-800"}`}>
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
                    <div className="flex items-center gap-3">
                      <span className={`w-8 h-8 rounded-full border font-mono font-bold text-xs flex items-center justify-center ${it.is_loss_exit ? "bg-emerald-600/20 border-emerald-500/40 text-emerald-400" : "bg-slate-700 border-slate-600 text-slate-200"}`}>
                        #{idx + 1}
                      </span>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-base font-bold text-slate-100">{it.name || "--"}</span>
                          <span className="text-xs font-mono text-slate-400">({it.code})</span>
                          {it.is_loss_exit ? (
                            <span className="text-[11px] px-2 py-0.5 rounded bg-emerald-900/60 border-emerald-500/60 text-emerald-300 font-semibold">亏损离场</span>
                          ) : (
                            <span className="text-[11px] px-2 py-0.5 rounded bg-red-900/60 border-red-500/60 text-red-300 font-semibold">盈利平仓</span>
                          )}
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5">
                          T-1 选股打分 <span className="text-red-400 font-mono font-semibold">{fmt(it.prev_day_quant_score, 2)} 分</span>
                          {" · 排名第 "}<span className="text-slate-200 font-mono">{fmt(it.prev_day_rank, 0)} 名</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <div className="text-xs text-slate-400">平仓 PnL</div>
                        <div className={`text-lg font-bold font-mono ${pctColor(it.realized_pnl_pct)}`}>
                          {fmt(it.realized_pnl_pct, 2, "", "%")}
                          {it.realized_pnl != null ? <span className="text-xs font-normal text-slate-400 ml-1">({it.realized_pnl >= 0 ? "+" : ""}¥{it.realized_pnl.toFixed(2)})</span> : null}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-slate-400">平仓时间 / 价格</div>
                        <div className="text-sm font-mono text-slate-200 font-semibold">
                          {it.sell_time || "--"} @ ¥{fmt(it.sell_price, 2)}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Exit Rule Type */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs font-mono">
                    <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800">
                      <span className="text-slate-500 block mb-0.5">卖出规则</span>
                      <span className="text-slate-200 font-semibold">{it.exit_rule_type || "—"}</span>
                    </div>
                    <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800">
                      <span className="text-slate-500 block mb-0.5">卖出原因摘要</span>
                      <span className="text-slate-200">{it.exit_reason || "—"}</span>
                    </div>
                    <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800">
                      <span className="text-slate-500 block mb-0.5">T 日是否仍在涨停池</span>
                      <span className={`font-semibold ${it.evidence?.today_in_limit_up_pool ? "text-red-400" : "text-slate-400"}`}>
                        {it.evidence?.today_in_limit_up_pool ? "✔ 仍在涨停池" : "✗ 已退出候选池"}
                      </span>
                    </div>
                  </div>

                  {/* Evidence */}
                  {it.evidence && Object.keys(it.evidence).length > 0 && (
                    <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800">
                      <div className="text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
                        <BarChart3 className="w-3.5 h-3.5 text-slate-400" />
                        <span>T 日关键证据数值</span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
                        {Object.entries(it.evidence).map(([k, v]) => (
                          <div key={k} className="bg-slate-800/50 rounded p-2">
                            <div className="text-[10px] text-slate-500 mb-0.5">{k}</div>
                            <div className="text-slate-200 font-semibold truncate">{typeof v === "boolean" ? (v ? "是" : "否") : typeof v === "number" ? (v % 1 === 0 ? v : v.toFixed(2)) : String(v)}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Attribution reasons */}
                  <div className="bg-slate-800/40 p-3.5 rounded-lg border border-slate-700/60 text-xs text-slate-300 leading-relaxed">
                    <div className="font-semibold text-slate-200 mb-2 flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                      <span>{it.is_loss_exit ? "【根因诊断】为什么 T-1 高打分，T 日却亏损离场？" : "【离场复盘】盈利平仓过程："}</span>
                    </div>
                    {it.attribution_reasons && it.attribution_reasons.length > 0 ? (
                      <ul className="space-y-1 list-disc list-inside">
                        {it.attribution_reasons.map((r, i) => (
                          <li key={i} className="text-slate-300">{r}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-slate-500">无明确结构性因子恶化，归为规则性正常退出。</p>
                    )}
                    {it.attribution_summary && (
                      <div className="mt-2 pt-2 border-t border-slate-700/60 text-slate-200 font-semibold leading-relaxed">
                        {it.attribution_summary}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ========================================================= */}
      {/* Tab: 连板成功分析                                        */}
      {/* ========================================================= */}
      {activeSection === "cb_success" && (
        <div className="space-y-4">
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
            <div className="flex items-center gap-2 text-slate-200 text-sm font-semibold mb-2">
              <Award className="w-4 h-4 text-red-400" />
              <span>连板成功晋级分析 · {prevDate} 候选 → {reviewDate} 连板梯队爬升</span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              筛选 T-1 量化候选池中，在 T 日 <strong className="text-red-300">连板数实际增加</strong> 的标的，
              逐一拆解 4 大因子（连板情绪/封板强度/筹码结构/板块共振）在 T 日的具体数值，用于验证模型"谁能晋级"的判断能力。
            </p>
          </div>

          {cbSuccessItems.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-10 text-center text-slate-500 text-sm">
              <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-amber-600" />
              未发现 T-1 候选池中 T 日成功晋级连板的标的。
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {cbSuccessItems.map((it, idx) => (
                <div key={`${it.code}-${idx}`} className="bg-slate-900 border border-red-900/40 rounded-xl p-5 hover:border-red-800/70 transition space-y-4">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
                    <div className="flex items-center gap-3">
                      <span className="w-8 h-8 rounded-lg bg-red-600/20 border border-red-500/40 text-red-400 font-mono font-bold text-xs flex items-center justify-center">
                        #{idx + 1}
                      </span>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-base font-bold text-slate-100">{it.name || "--"}</span>
                          <span className="text-xs font-mono text-slate-400">({it.code})</span>
                          <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">{it.sector || "—"}</span>
                          <span className="text-[11px] px-2 py-0.5 rounded bg-red-900/70 border border-red-500 text-red-300 font-semibold">★ {it.board_advancement}</span>
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5">
                          T 日量化打分 <span className="text-red-400 font-mono font-semibold">{fmt(it.today_quant_score, 2)} 分</span>
                          {" · 排名 #"}<span className="text-slate-200 font-mono">{fmt(it.today_rank, 0)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-slate-400">T 日收盘</div>
                      <div className="text-lg font-bold font-mono text-slate-100">
                        {fmt(it.today_price, 2, "¥")}
                        <span className={`ml-1 text-xs font-normal ${pctColor(it.today_change_pct)}`}>{fmt(it.today_change_pct, 2, "+", "%")}</span>
                      </div>
                    </div>
                  </div>

                  {/* Metrics */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
                    <div className="bg-slate-950/60 p-2 rounded border border-slate-800">
                      <span className="text-slate-500 block text-[10px]">首封 / 尾封</span>
                      <span className="text-slate-200 font-semibold">{it.today_first_seal_time || "—"}</span>
                      <div className="text-[10px] text-slate-500">{it.today_last_seal_time || "—"}</div>
                    </div>
                    <div className="bg-slate-950/60 p-2 rounded border border-slate-800">
                      <span className="text-slate-500 block text-[10px]">封成比 / 炸板</span>
                      <span className="text-red-400 font-semibold">{fmt(it.today_seal_ratio_pct, 1, "", "%")}</span>
                      <div className="text-[10px] text-slate-500">炸板 {it.today_broken_count ?? 0} 次</div>
                    </div>
                    <div className="bg-slate-950/60 p-2 rounded border border-slate-800">
                      <span className="text-slate-500 block text-[10px]">换手率</span>
                      <span className={`font-semibold ${(it.today_turnover_rate ?? 0) >= 18 ? "text-amber-400" : "text-slate-200"}`}>{fmt(it.today_turnover_rate, 1, "", "%")}</span>
                      <div className="text-[10px] text-slate-500">成交 {fmt(it.today_amount, 0, "", "亿")}</div>
                    </div>
                    <div className="bg-slate-950/60 p-2 rounded border border-slate-800">
                      <span className="text-slate-500 block text-[10px]">机构封单占比</span>
                      <span className="text-slate-200 font-semibold">{fmt(it.today_institution_ratio_pct, 1, "", "%")}</span>
                      <div className="text-[10px] text-slate-500">—</div>
                    </div>
                  </div>

                  {/* Factor scores today */}
                  {it.factor_scores_today && (
                    <div>
                      <div className="text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
                        <Layers className="w-3.5 h-3.5 text-red-400" />
                        <span>T 日四大因子实评分</span>
                      </div>
                      <div className="grid grid-cols-4 gap-2">
                        {Object.entries(it.factor_scores_today).map(([k, v]) => {
                          const label: Record<string, string> = {
                            consecutive_board_sentiment: "连板情绪",
                            seal_strength: "封板强度",
                            chip_structure: "筹码结构",
                            sector_resonance: "板块共振",
                          };
                          const score = typeof v === "number" ? v : 0;
                          const cls = score >= 80 ? "bg-red-900/70 border-red-600 text-red-300" : score >= 60 ? "bg-amber-900/50 border-amber-500/60 text-amber-300" : "bg-slate-800 border-slate-700 text-slate-400";
                          return (
                            <div key={k} className={`p-2 rounded border text-center ${cls}`}>
                              <div className="text-[10px] mb-0.5 opacity-80">{label[k] || k}</div>
                              <div className="font-bold font-mono text-sm">{score ? score.toFixed(0) : "—"}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {it.verdict && (
                    <div className="bg-slate-800/40 p-3 rounded-lg border border-slate-700/50 text-xs text-slate-200 font-semibold leading-relaxed">
                      {it.verdict}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ========================================================= */}
      {/* Tab: T+1 表现预测                                        */}
      {/* ========================================================= */}
      {activeSection === "next_day_pred" && (
        <div className="space-y-4">
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
            <div className="flex items-center gap-2 text-slate-200 text-sm font-semibold mb-2">
              <Rocket className="w-4 h-4 text-amber-400" />
              <span>T+1（{ndp?.prediction_for_trade_date || nextDate}）表现预测 · 基于规则打分模型</span>
            </div>
            <div className="flex items-start gap-3 text-xs text-slate-400 leading-relaxed">
              <div className="flex-1">
                大盘情绪：<SentimentChip state={ndp?.prevailing_sentiment_state} score={ndp?.prevailing_sentiment_score} />
                <div className="mt-1">
                  {ndp?.market_level_prediction || "暂无市场级预测"}
                </div>
              </div>
            </div>
          </div>

          {predItems.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-10 text-center text-slate-500 text-sm">
              <HelpCircle className="w-8 h-8 mx-auto mb-2 text-slate-600" />
              暂无 T 日 TOP 候选数据，无法生成 T+1 预测。
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {predItems.map((it, idx) => (
                <div key={`${it.code}-${idx}`} className="bg-slate-900 border border-slate-800 rounded-xl p-5 hover:border-slate-700 transition space-y-4">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
                    <div className="flex items-center gap-3">
                      <span className="w-8 h-8 rounded-lg bg-amber-600/20 border border-amber-500/40 text-amber-400 font-mono font-bold text-xs flex items-center justify-center">
                        #{it.rank ?? idx + 1}
                      </span>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-base font-bold text-slate-100">{it.name || "--"}</span>
                          <span className="text-xs font-mono text-slate-400">({it.code})</span>
                          <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">{it.sector || "—"}</span>
                          {dirBadge(it.direction, it.confidence_pct)}
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5">
                          T 日收盘 <span className="text-slate-200 font-mono">{fmt(it.today_close_price, 2, "¥")}</span>
                          <span className={`ml-1 ${pctColor(it.today_change_pct)}`}>({fmt(it.today_change_pct, 2, "+", "%")})</span>
                          {" · T 日打分 "}<span className="text-red-400 font-mono font-semibold">{fmt(it.today_quant_score, 1)}分</span>
                          {" · "}{it.today_consecutive_boards ?? 0} 连板
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Key Drivers + Risk Flags */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800">
                      <div className="text-[11px] font-semibold text-slate-300 mb-1.5 flex items-center gap-1">
                        <TrendingUp className="w-3 h-3 text-red-400" />
                        <span>关键驱动因子</span>
                      </div>
                      <ul className="text-[11px] text-slate-300 space-y-1 list-disc list-inside">
                        {it.key_drivers && it.key_drivers.length > 0 ? it.key_drivers.map((d, i) => <li key={i}>{d}</li>) : <li className="text-slate-500">无</li>}
                      </ul>
                    </div>
                    <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800">
                      <div className="text-[11px] font-semibold text-slate-300 mb-1.5 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3 text-amber-400" />
                        <span>风险信号</span>
                      </div>
                      {it.risk_flags && (it.risk_flags.broken_count || it.risk_flags.high_turnover || it.risk_flags.low_seal_ratio) ? (
                        <ul className="text-[11px] space-y-1 list-disc list-inside">
                          {it.risk_flags.broken_count != null && <li className="text-amber-300">T 日炸板 {it.risk_flags.broken_count} 次</li>}
                          {it.risk_flags.high_turnover != null && <li className="text-amber-300">高换手率 {it.risk_flags.high_turnover}%</li>}
                          {it.risk_flags.low_seal_ratio != null && <li className="text-amber-300">低封成比 {typeof it.risk_flags.low_seal_ratio === "number" ? (it.risk_flags.low_seal_ratio * 100).toFixed(1) + "%" : it.risk_flags.low_seal_ratio}</li>}
                        </ul>
                      ) : (
                        <div className="text-[11px] text-emerald-400">✔ 无显著风险信号</div>
                      )}
                    </div>
                  </div>

                  {/* Today Factor Scores Bar */}
                  {it.today_factor_scores && (
                    <div>
                      <div className="text-[11px] font-semibold text-slate-300 mb-1.5">T 日 4 因子分</div>
                      <div className="space-y-1.5">
                        {Object.entries(it.today_factor_scores).map(([k, v]) => {
                          const label: Record<string, string> = { consecutive_board_sentiment: "连板情绪", seal_strength: "封板强度", chip_structure: "筹码结构", sector_resonance: "板块共振" };
                          const s = typeof v === "number" ? v : 0;
                          const pct = Math.max(0, Math.min(100, s));
                          const barColor = s >= 75 ? "bg-red-500" : s >= 55 ? "bg-amber-500" : "bg-slate-600";
                          return (
                            <div key={k}>
                              <div className="flex items-center justify-between text-[10px] mb-0.5">
                                <span className="text-slate-400">{label[k] || k}</span>
                                <span className="text-slate-200 font-mono font-semibold">{s ? s.toFixed(0) : "—"}</span>
                              </div>
                              <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
                                <div className={`h-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Operation Guide */}
                  <div className="bg-amber-900/20 border border-amber-700/40 rounded-lg p-3 text-xs leading-relaxed">
                    <div className="font-semibold text-amber-300 mb-1 flex items-center gap-1">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>T+1 模拟盘操作建议</span>
                    </div>
                    <div className="text-amber-100/90">{it.operation_guide || "暂无操作建议"}</div>
                  </div>

                  {/* Prediction Summary */}
                  {it.prediction_summary && (
                    <div className="bg-slate-800/40 p-3 rounded-lg border border-slate-700/50 text-xs text-slate-300 leading-relaxed">
                      <div className="font-semibold text-slate-200 mb-1 flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-red-400" />
                        <span>一句话预测结论</span>
                      </div>
                      <p>{it.prediction_summary}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ========================================================= */}
      {/* Tab: 当日 Top8 复盘与待办监控 */}
      {/* ========================================================= */}
      {activeSection === "top8_eval" && (
        <div className="space-y-4">
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
            <div className="flex items-center gap-2 text-slate-200 text-sm font-semibold mb-2">
              <Info className="w-4 h-4 text-red-400" />
              <span>复盘评估规则说明</span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              基于 T 日 (<strong className="text-slate-200">{reviewDate}</strong>) FINAL 快照选出的 Top8 候选，
              系统将在下一个交易日 (<strong className="text-amber-300">{nextDate}</strong>) 按排名顺序评估三类买入策略，最多建立 4 个持仓。
              买入当日为 <strong className="text-amber-300">T+0 锁仓</strong>，最早须在 T+1 日方可触发卖出策略。
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4">
            {top8Evals.map((item: any) => (
              <div key={item.code} className="bg-slate-900 border border-slate-800 rounded-xl p-5 hover:border-slate-700 transition space-y-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
                  <div className="flex items-center gap-3">
                    <span className="w-7 h-7 rounded-full bg-red-600/20 border border-red-500/40 text-red-400 font-mono font-bold text-xs flex items-center justify-center">
                      #{item.aug21_rank ?? "--"}
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-base font-bold text-slate-100">{item.name}</span>
                        <span className="text-xs font-mono text-slate-400">({item.code})</span>
                        <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">{item.sector || "—"}</span>
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5">
                        {reviewDate}量化打分: <span className="text-red-400 font-mono font-semibold">{fmt(item.aug21_score, 2)}分</span> · 
                        {reviewDate}收盘价: <span className="text-slate-200 font-mono">{fmt(item.aug24_open_price, 2, "¥")}</span> ({fmt(item.aug24_open_pct, 2, "+", "%")})
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="text-xs text-slate-400">{nextDate} 开盘建仓预期</div>
                      <div className="text-sm font-bold font-mono text-amber-400">待撮合 · 09:30 执行</div>
                    </div>
                    <div className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs font-semibold text-amber-300">{item.evaluation_verdict || "待评估"}</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 bg-slate-950/60 p-3 rounded-lg border border-slate-800/60 text-xs font-mono">
                  <div>
                    <span className="text-slate-500 block">{reviewDate} 收盘价</span>
                    <span className="text-slate-200 font-bold text-sm">{fmt(item.aug24_close_price, 2, "¥")}</span>
                    <span className={`block text-[11px] ${pctColor(item.aug24_close_pct)}`}>{fmt(item.aug24_close_pct, 2, "+", "%")}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">{reviewDate} 振幅极值</span>
                    <span className="text-slate-300">{fmt(item.aug24_intraday_high, 2, "¥")} / {fmt(item.aug24_intraday_low, 2, "¥")}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">封板时间 / 封成比</span>
                    <span className="text-slate-300">{item.aug24_seal_time || "—"}</span>
                    <span className="block text-slate-400 text-[11px]">封成比 {fmt(item.aug24_seal_ratio, 1, "", "%")}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">{reviewDate} 换手率</span>
                    <span className="text-slate-300 font-semibold">{fmt(item.aug24_turnover, 1, "", "%")}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">{nextDate} 开盘状态</span>
                    <span className="text-amber-400 font-semibold flex items-center gap-1"><Sparkles className="w-3.5 h-3.5" /><span>待开盘撮合</span></span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">交易执行计划</span>
                    <span className="text-slate-300 font-semibold flex items-center gap-1"><Lock className="w-3 h-3 text-slate-400" /><span>09:30 市价买入</span></span>
                  </div>
                </div>
                <div className="bg-slate-800/40 p-3 rounded-lg border border-slate-700/50 text-xs text-slate-300 leading-relaxed">
                  <div className="font-semibold text-slate-200 mb-1 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    <span>{reviewDate} 盘后量化评估与 {nextDate} 开盘监控指导：</span>
                  </div>
                  <p>{item.detailed_analysis}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* Legacy Tab: 连板漏报归因                                 */}
      {/* ========================================================= */}
      {activeSection === "runners_attr" && (
        <div className="space-y-4">
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
            <div className="flex items-center gap-2 text-slate-200 text-sm font-semibold mb-2">
              <HelpCircle className="w-4 h-4 text-red-400" />
              <span>连板漏报深度归因背景</span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              在 T 日 ({reviewDate}) 盘后，全市场部分连板或大涨标的未进入量化 Top8 优选池。
              量化系统在每日 15:35 自动对这部分标的进行【反向漏报归因审计】，深入分析它们在 4 大因子（连板情绪、封单强度、筹码结构、板块共振）中的具体扣分项，以此验证模型风控边界。
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4">
            {runnersAttrs.map((runner: any) => (
              <div key={runner.code} className="bg-slate-900 border border-slate-800 rounded-xl p-5 hover:border-slate-700 transition space-y-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300 font-bold font-mono text-xs">#{runner.aug21_rank ?? "--"}</div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-base font-bold text-slate-100">{runner.name}</span>
                        <span className="text-xs font-mono text-slate-400">({runner.code})</span>
                        <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">{runner.sector || "—"}</span>
                        <span className="text-xs px-2 py-0.5 rounded bg-red-950 border border-red-500/50 text-red-300 font-semibold">
                          {reviewDate}形态: {runner.aug24_board_status || "—"} ({fmt(runner.aug24_change_pct, 2, "+", "%")})
                        </span>
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5">
                        {reviewDate} 量化综合得分: <span className="text-amber-400 font-mono font-semibold">{fmt(runner.aug21_score, 2)}分</span> (位列全市场第 {runner.aug21_rank ?? "--"} 名，未进入 Top8)
                      </div>
                    </div>
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-300 mb-2 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                    <span>{reviewDate} 因子模型扣分归因明细：</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {runner.factor_rejection_breakdown ? (
                      Object.entries(runner.factor_rejection_breakdown).map(([k, factor]: [string, any]) => (
                        <div key={k} className="bg-slate-950/70 p-3 rounded-lg border border-slate-800 text-xs">
                          <div className="text-slate-400 font-mono text-[11px] mb-1">因子: {k}</div>
                          <div className="text-amber-400 font-mono font-bold mb-1">打分: {fmt((factor as any).score, 1)}分</div>
                          <div className="text-slate-400 text-[11px] leading-relaxed">
                            {(factor as any).impact ?? ((factor as any).weight ? `权重: ${(factor as any).weight}` : "—")}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="col-span-3 text-slate-500 text-xs text-center py-4">暂无扣分归因数据</div>
                    )}
                  </div>
                </div>
                <div className="bg-slate-800/40 p-3.5 rounded-lg border border-slate-700/60 text-xs text-slate-300 leading-relaxed">
                  <div className="font-semibold text-slate-200 mb-1 flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 text-red-400" />
                    <span>为什么没有进入 Top8 观察池？（算法风控意图）</span>
                  </div>
                  <p>{runner.why_not_in_top5}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* Legacy Tab: 次日候选池                                   */}
      {/* ========================================================= */}
      {activeSection === "next_candidates" && (
        <div className="space-y-4">
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
            <div className="flex items-center gap-2 text-slate-200 text-sm font-semibold mb-2">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <span>下一个交易日 ({nextDate}) 重点候选池推荐逻辑</span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              根据 {reviewDate} 15:30 盘后全市场涨停标的与最新市场情绪状态（情绪分 {fmt(data.market_summary.sentiment_score, 1)} · {data.market_summary.sentiment_state || "—"}），
              四大因子打分模型计算出 <strong className="text-red-400">{nextDate} 开盘重点关注与模拟交易候选池</strong>。
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {nextDayCands.map((cand: any, idx: number) => (
              <div key={cand.code} className="bg-slate-900 border border-slate-800 rounded-xl p-5 hover:border-slate-700 transition flex flex-col justify-between space-y-4">
                <div>
                  <div className="flex items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
                    <div className="flex items-center gap-2.5">
                      <span className="w-7 h-7 rounded-full bg-red-600/20 border border-red-500/40 text-red-400 font-mono font-bold text-xs flex items-center justify-center">#{idx + 1}</span>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-base font-bold text-slate-100">{cand.name}</span>
                          <span className="text-xs font-mono text-slate-400">({cand.code})</span>
                          <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">{cand.consecutive_boards ?? "--"}连板</span>
                        </div>
                        <span className="text-xs text-slate-400">{cand.sector || "—"}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-slate-400">量化综合打分</div>
                      <div className="text-lg font-bold font-mono text-red-400">{fmt(cand.quant_score, 1)} <span className="text-xs font-normal">分</span></div>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/60 my-3 text-xs font-mono">
                    <div>
                      <span className="text-slate-500 block">{reviewDate} 收盘价</span>
                      <span className="text-slate-200 font-semibold">{fmt(cand.price, 2, "¥")}</span>
                      <span className={`text-red-400 block text-[11px] ${pctColor(cand.change_pct)}`}>{fmt(cand.change_pct, 2, "+", "%")}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">首封时间</span>
                      <span className="text-slate-300">{cand.first_seal_time || "—"}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">封成比 / 换手</span>
                      <span className="text-slate-300">{fmt(cand.seal_ratio, 1, "", "%")} / {fmt(cand.turnover_rate, 1, "", "%")}</span>
                    </div>
                  </div>
                  <div className="text-xs text-slate-300 space-y-1.5">
                    <div className="font-semibold text-slate-200 flex items-center gap-1"><TrendingUp className="w-3.5 h-3.5 text-red-400" /><span>推荐逻辑：</span></div>
                    <p className="text-slate-400 leading-relaxed">{cand.recommend_reason || "暂无推荐逻辑说明。"}</p>
                  </div>
                </div>
                <div className="bg-slate-800/50 p-2.5 rounded-lg border border-slate-700/60 text-xs">
                  <span className="font-semibold text-amber-300 block mb-0.5">{nextDate} 模拟实盘操作指引：</span>
                  <span className="text-slate-300">{cand.operation_guide || "待系统根据开盘竞价情况生成操作指令。"}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
