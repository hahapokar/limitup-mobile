import React, { useState } from "react";
import {
  Brain,
  TrendingUp,
  ShieldCheck,
  Zap,
  Sliders,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  ArrowUpRight,
  ArrowDownRight,
  Sparkles,
  HelpCircle,
  Percent,
  Layers,
  ChevronRight
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend
} from "recharts";
import { IterationData, ConfigDiffItem, ImpactedTrade } from "../types";

interface IterationViewProps {
  data: IterationData | null;
  loading: boolean;
  onRefresh: () => void;
  onApprove: (customParams?: Record<string, number>) => Promise<void>;
  onReject: () => Promise<void>;
  actionLoading: boolean;
}

export const IterationView: React.FC<IterationViewProps> = ({
  data,
  loading,
  onRefresh,
  onApprove,
  onReject,
  actionLoading
}) => {
  const [selectedTradeTab, setSelectedTradeTab] = useState<"ALL" | "FIX" | "HIT" | "MISS">("ALL");
  const [customParams, setCustomParams] = useState<Record<string, number>>({});
  const [showConfirmModal, setShowConfirmModal] = useState<boolean>(false);

  if (loading || !data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[460px] bg-slate-900/60 rounded-xl border border-slate-800 p-8 space-y-4">
        <RefreshCw className="w-8 h-8 text-indigo-400 animate-spin" />
        <p className="text-sm text-slate-400">正在加载策略自迭代与影子回测数据...</p>
      </div>
    );
  }

  // Safe defaults for potentially missing arrays/objects
  const impactedTrades: ImpactedTrade[] = data.impacted_trades || [];
  const configDiff: ConfigDiffItem[] = data.config_diff || [];
  const metrics = data.metrics || {};
  const equityCurve = data.equity_curve || [];

  // Initialize or get current fine-tuned parameter value
  const getParamValue = (item: ConfigDiffItem) => {
    return customParams[item.param_key] !== undefined ? customParams[item.param_key] : (item.suggested_value ?? item.current_value ?? 0);
  };

  const handleParamChange = (key: string, val: number) => {
    setCustomParams((prev) => ({ ...prev, [key]: val }));
  };

  const filteredTrades = impactedTrades.filter((t) => {
    if (selectedTradeTab === "ALL") return true;
    return t.type === selectedTradeTab;
  });

  const fixCount = impactedTrades.filter((t) => t.type === "FIX").length;
  const hitCount = impactedTrades.filter((t) => t.type === "HIT").length;
  const missCount = impactedTrades.filter((t) => t.type === "MISS").length;

  const isApproved = data.status === "APPROVED";
  const isRejected = data.status === "REJECTED";

  // Safe number formatter
  const fmt = (v: number | null | undefined, digits = 2, prefix = "", suffix = "") =>
    v != null && typeof v === "number" && !isNaN(v)
      ? `${prefix}${v.toFixed(digits)}${suffix}`
      : "--";

  return (
    <div className="space-y-6 pb-28">
      {/* AREA A: STATUS BANNER */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-indigo-500/30 p-6 shadow-xl">
        <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl -z-10 pointer-events-none" />
        
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-3">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 shadow-inner">
                <Brain className="w-3.5 h-3.5" />
                15:35 盘后信号对账与影子回测自迭代引擎
              </span>

              <span className="text-xs px-2.5 py-0.8 rounded-md bg-slate-800 text-slate-300 border border-slate-700 font-mono">
                评估交易日: {data.trade_date}
              </span>

              {isApproved && (
                <span className="flex items-center gap-1 text-xs px-2.5 py-0.8 rounded-md bg-emerald-950 text-emerald-300 border border-emerald-700">
                  <CheckCircle2 className="w-3 h-3" />
                  已审批生效
                </span>
              )}

              {isRejected && (
                <span className="flex items-center gap-1 text-xs px-2.5 py-0.8 rounded-md bg-rose-950 text-rose-300 border border-rose-700">
                  <XCircle className="w-3 h-3" />
                  已人工驳回
                </span>
              )}

              {!isApproved && !isRejected && (
                <span className="flex items-center gap-1 text-xs px-2.5 py-0.8 rounded-md bg-amber-950 text-amber-300 border border-amber-700 animate-pulse">
                  <Sparkles className="w-3 h-3" />
                  待人工复核决策
                </span>
              )}
            </div>

            <h2 className="text-xl sm:text-2xl font-bold text-slate-100 tracking-tight flex items-center gap-2">
              <span>{data.summary}</span>
            </h2>

            <p className="text-xs text-slate-300 leading-relaxed max-w-4xl">
              系统根据当日 15:30 盘后涨停标的次日实际走势、炸板样本与多板晋级率，全自动在影子沙盒中进行
              <span className="text-indigo-300 font-semibold"> 30个交易日滚动历史压力测试</span>。通过微调高灵敏度因子门槛，消除虚假申报噪音，在防范回撤的同时提升有效连板捕捉率。
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={onRefresh}
              disabled={actionLoading}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 border border-slate-700 text-xs font-semibold shadow-sm transition disabled:opacity-50"
              title="重新计算近30日影子回测并刷新归因"
            >
              <RefreshCw className={`w-4 h-4 ${actionLoading ? "animate-spin text-indigo-400" : "text-slate-400"}`} />
              <span>{actionLoading ? "计算中..." : "重新运行影子回测"}</span>
            </button>
          </div>
        </div>
      </section>

      {/* AREA B: CONFIG DIFF TABLE & INTERACTIVE FINE-TUNING */}
      <section className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-lg">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <Sliders className="w-5 h-5 text-indigo-400" />
            <h3 className="text-base font-bold text-slate-100">
              参数变动对比与在线微调 (Config Diff & Fine-Tuning)
            </h3>
          </div>
          <span className="text-xs text-slate-400">
            拖动滑块可在建议值基础上进行人工二次微调
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400">
                <th className="py-3 px-4 font-semibold">策略参数名称 (Key)</th>
                <th className="py-3 px-4 font-semibold text-center">当前线上值 (Current)</th>
                <th className="py-3 px-4 font-semibold text-center">系统建议值 (Suggested)</th>
                <th className="py-3 px-4 font-semibold text-center">安全区间 (Safe Range)</th>
                <th className="py-3 px-4 font-semibold">归因调整理由 (Attribution Reason)</th>
                <th className="py-3 px-4 font-semibold text-right min-w-[200px]">人工微调确认 (Adjust)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {configDiff.map((item) => {
                const currentVal = item.current_value;
                const activeVal = getParamValue(item);
                const isIncreased = activeVal != null && currentVal != null && activeVal > currentVal;
                const isDecreased = activeVal != null && currentVal != null && activeVal < currentVal;
                const isPct = item.param_key.includes("ratio") || item.param_key.includes("rate") || item.param_key.includes("pct");

                const formatVal = (v: number | null | undefined) => {
                  if (v == null || typeof v !== "number" || isNaN(v)) return "--";
                  if (isPct) return `${(v * 100).toFixed(1)}%`;
                  return v.toString();
                };

                return (
                  <tr key={item.param_key} className="hover:bg-slate-800/40 transition">
                    <td className="py-4 px-4">
                      <div className="font-sans font-bold text-slate-200">{item.param_name}</div>
                      <div className="text-[11px] text-slate-400 font-mono">{item.param_key}</div>
                    </td>

                    <td className="py-4 px-4 text-center">
                      <span className="px-2.5 py-1 rounded bg-slate-800 text-slate-300 border border-slate-700 font-bold">
                        {formatVal(item.current_value)}
                      </span>
                    </td>

                    <td className="py-4 px-4 text-center">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded font-bold border ${
                          isIncreased
                            ? "bg-emerald-950/80 text-emerald-300 border-emerald-700/60"
                            : isDecreased
                            ? "bg-amber-950/80 text-amber-300 border-amber-700/60"
                            : "bg-slate-800 text-slate-300 border-slate-700"
                        }`}
                      >
                        {isIncreased && <ArrowUpRight className="w-3.5 h-3.5" />}
                        {isDecreased && <ArrowDownRight className="w-3.5 h-3.5" />}
                        {formatVal(item.suggested_value)}
                      </span>
                    </td>

                    <td className="py-4 px-4 text-center text-slate-400 font-mono text-[11px]">
                      [{formatVal(item.min_bound)} ~ {formatVal(item.max_bound)}]
                    </td>

                    <td className="py-4 px-4 font-sans text-slate-300 text-xs max-w-xs">
                      {item.reason}
                    </td>

                    <td className="py-4 px-4 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <input
                          type="range"
                          min={item.min_bound ?? 0}
                          max={item.max_bound ?? 1}
                          step={item.step || 0.005}
                          value={activeVal ?? 0}
                          onChange={(e) => handleParamChange(item.param_key, parseFloat(e.target.value))}
                          disabled={isApproved || isRejected}
                          className="w-28 accent-indigo-500 cursor-pointer"
                        />
                        <span className="w-14 text-right font-bold text-indigo-300 bg-indigo-950/60 px-2 py-0.5 rounded border border-indigo-800/40">
                          {formatVal(activeVal)}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* AREA C: DUAL EQUITY CURVE & CORE METRICS DIFF */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Recharts Dual Curve Chart (2 cols) */}
        <div className="lg:col-span-2 bg-slate-900/90 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-lg flex flex-col justify-between">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2.5">
              <TrendingUp className="w-5 h-5 text-emerald-400" />
              <h3 className="text-base font-bold text-slate-100">
                近30交易日影子回测净值曲线对比 (Dual Equity Curve)
              </h3>
            </div>
            <div className="flex items-center gap-4 text-xs font-mono">
              <span className="flex items-center gap-1.5 text-blue-400">
                <span className="w-3 h-0.5 bg-blue-500 inline-block"></span>
                当前线上配置
              </span>
              <span className="flex items-center gap-1.5 text-emerald-400">
                <span className="w-3 h-0.5 border-t-2 border-dashed border-emerald-400 inline-block"></span>
                候选自迭代配置
              </span>
            </div>
          </div>

          <div className="h-[280px] w-full pt-2">
            {equityCurve.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={equityCurve} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="date" stroke="#64748b" fontSize={10} tickLine={false} />
                <YAxis stroke="#64748b" fontSize={10} domain={["auto", "auto"]} tickFormatter={(v) => v.toFixed(3)} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#0f172a",
                    borderColor: "#334155",
                    borderRadius: "0.75rem",
                    fontSize: "12px",
                    color: "#f8fafc"
                  }}
                  formatter={(value: any, name: string) => [
                    Number(value).toFixed(4),
                    name === "candidate_nav" ? "候选配置净值" : "当前配置净值"
                  ]}
                  labelFormatter={(label) => `交易日: ${label}`}
                />
                <Line
                  type="monotone"
                  dataKey="current_nav"
                  name="current_nav"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="candidate_nav"
                  name="candidate_nav"
                  stroke="#10b981"
                  strokeWidth={2.5}
                  strokeDasharray="4 4"
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-500 text-sm">
                暂无影子回测净值数据（未执行真实回测）
              </div>
            )}
          </div>

          <p className="text-[11px] text-slate-400 text-center font-mono">
            * 影子回测完全严格复刻真实实盘滑点 (买入 0.08%, 卖出 0.15%) 与 T+1 集合竞价撮合限制
          </p>
        </div>

        {/* Right: Key Performance Metric Cards */}
        <div className="space-y-4 flex flex-col justify-between">
          {/* Card 1: Win Rate */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4.5 space-y-2 shadow-md">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="font-semibold text-slate-300">胜率对比 (Win Rate)</span>
              <span className="text-emerald-400 font-bold font-mono text-xs bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-800/40">
                {metrics.win_rate_delta || "--"}
              </span>
            </div>
            <div className="flex items-baseline justify-between pt-1">
              <div>
                <span className="text-xs text-slate-400 block">当前线上</span>
                <span className="text-lg font-bold font-mono text-slate-300">
                  {fmt(metrics.current_win_rate, 1, "", "%")}
                </span>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400" />
              <div className="text-right">
                <span className="text-xs text-emerald-400 block font-semibold">候选预期</span>
                <span className="text-xl font-extrabold font-mono text-emerald-400">
                  {fmt(metrics.candidate_win_rate, 1, "", "%")}
                </span>
              </div>
            </div>
          </div>

          {/* Card 2: Sharpe Ratio */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4.5 space-y-2 shadow-md">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="font-semibold text-slate-300">夏普比率 (Sharpe Ratio)</span>
              <span className="text-emerald-400 font-bold font-mono text-xs bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-800/40">
                {metrics.sharpe_delta || "--"}
              </span>
            </div>
            <div className="flex items-baseline justify-between pt-1">
              <div>
                <span className="text-xs text-slate-400 block">当前线上</span>
                <span className="text-lg font-bold font-mono text-slate-300">
                  {fmt(metrics.current_sharpe, 2)}
                </span>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400" />
              <div className="text-right">
                <span className="text-xs text-emerald-400 block font-semibold">候选预期</span>
                <span className="text-xl font-extrabold font-mono text-emerald-400">
                  {fmt(metrics.candidate_sharpe, 2)}
                </span>
              </div>
            </div>
          </div>

          {/* Card 3: Max Drawdown */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4.5 space-y-2 shadow-md">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="font-semibold text-slate-300">最大回撤 (Max Drawdown)</span>
              <span className="text-emerald-400 font-bold font-mono text-xs bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-800/40">
                {metrics.max_dd_delta ? `回撤收窄 ${metrics.max_dd_delta}` : "--"}
              </span>
            </div>
            <div className="flex items-baseline justify-between pt-1">
              <div>
                <span className="text-xs text-slate-400 block">当前线上</span>
                <span className="text-lg font-bold font-mono text-rose-400">
                  {fmt(metrics.current_max_dd, 1, "", "%")}
                </span>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-400" />
              <div className="text-right">
                <span className="text-xs text-emerald-400 block font-semibold">候选预期</span>
                <span className="text-xl font-extrabold font-mono text-emerald-400">
                  {fmt(metrics.candidate_max_dd, 1, "", "%")}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* AREA D: IMPACTED TRADES LIST */}
      <section className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-lg">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3.5">
          <div className="flex items-center gap-2.5">
            <Layers className="w-5 h-5 text-indigo-400" />
            <h3 className="text-base font-bold text-slate-100">
              受影响交易归因明细 (Impacted Trades Breakdown)
            </h3>
          </div>

          {/* Trade Filter Tabs */}
          <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => setSelectedTradeTab("ALL")}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
                selectedTradeTab === "ALL"
                  ? "bg-slate-800 text-white shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              全部影响 ({impactedTrades.length})
            </button>
            <button
              onClick={() => setSelectedTradeTab("FIX")}
              className={`flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-semibold transition ${
                selectedTradeTab === "FIX"
                  ? "bg-rose-950/80 text-rose-300 border border-rose-800/50 shadow-sm"
                  : "text-slate-400 hover:text-rose-300"
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              拦截炸板 ({fixCount})
            </button>
            <button
              onClick={() => setSelectedTradeTab("HIT")}
              className={`flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-semibold transition ${
                selectedTradeTab === "HIT"
                  ? "bg-emerald-950/80 text-emerald-300 border border-emerald-800/50 shadow-sm"
                  : "text-slate-400 hover:text-emerald-300"
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              挽回漏报 ({hitCount})
            </button>
            <button
              onClick={() => setSelectedTradeTab("MISS")}
              className={`flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-semibold transition ${
                selectedTradeTab === "MISS"
                  ? "bg-slate-800 text-slate-300 border border-slate-700 shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              错失交易 ({missCount})
            </button>
          </div>
        </div>

        {/* Trades Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredTrades.map((t, idx) => {
            const isFix = t.type === "FIX";
            const isHit = t.type === "HIT";
            const isMiss = t.type === "MISS";

            return (
              <div
                key={`${t.code}-${idx}`}
                className={`p-4 rounded-xl border transition ${
                  isFix
                    ? "bg-rose-950/20 border-rose-900/40 hover:border-rose-700/60"
                    : isHit
                    ? "bg-emerald-950/20 border-emerald-900/40 hover:border-emerald-700/60"
                    : "bg-slate-950/60 border-slate-800 hover:border-slate-700"
                }`}
              >
                <div className="flex items-center justify-between pb-2 border-b border-slate-800/60">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-slate-100">{t.name}</span>
                    <span className="font-mono text-xs text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded">
                      {t.code}
                    </span>
                    <span className="text-[11px] font-mono text-slate-400">{t.date}</span>
                  </div>

                  <span
                    className={`text-[11px] px-2 py-0.5 rounded-full font-bold border ${
                      isFix
                        ? "bg-rose-950 text-rose-300 border-rose-700/60"
                        : isHit
                        ? "bg-emerald-950 text-emerald-300 border-emerald-700/60"
                        : "bg-slate-800 text-slate-300 border-slate-700"
                    }`}
                  >
                    {t.action_tag || (isFix ? "拦截炸板" : isHit ? "捕捉连板" : "容忍漏报")}
                  </span>
                </div>

                <div className="py-2 space-y-1.5 text-xs font-mono">
                  {t.original_action && (
                    <div className="flex items-start justify-between text-slate-400">
                      <span className="text-slate-400">原配置行为:</span>
                      <span className="text-slate-300 text-right">{t.original_action}</span>
                    </div>
                  )}
                  {t.filtered_action && (
                    <div className="flex items-start justify-between">
                      <span className="text-slate-400">新配置判定:</span>
                      <span className={`font-semibold text-right ${isFix ? "text-rose-300" : isHit ? "text-emerald-300" : "text-slate-300"}`}>
                        {t.filtered_action}
                      </span>
                    </div>
                  )}
                  {t.pnl_saved_pct && (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">盈亏影响预估:</span>
                      <span className={`font-bold ${isFix || isHit ? "text-emerald-400" : "text-amber-400"}`}>
                        {t.pnl_saved_pct}
                      </span>
                    </div>
                  )}
                </div>

                <p className="text-xs text-slate-300 font-sans pt-2 border-t border-slate-800/40 leading-relaxed">
                  {t.description}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* AREA E: FLOATING ACTION BAR FOR HUMAN DECISION */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 max-w-3xl w-[92%] bg-slate-900/95 backdrop-blur-md border border-indigo-500/40 rounded-2xl px-6 py-3.5 shadow-2xl flex flex-wrap items-center justify-between gap-4 animate-fade-in">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center text-indigo-300">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <div className="text-xs font-bold text-slate-200">
              {isApproved ? "已成功应用上线" : isRejected ? "已驳回本次建议" : "人工决策确认 (Human in the Loop)"}
            </div>
            <div className="text-[11px] text-slate-400">
              {isApproved
                ? "新参数已热更新生效于模拟盘与选股系统"
                : isRejected
                ? "系统将继续保持当前线上策略参数运行"
                : "点击批准后将立即热更新生产参数，并于下个交易日生效"}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => onReject()}
            disabled={actionLoading || isRejected}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-300 hover:text-white text-xs font-semibold border border-slate-700 transition disabled:opacity-50"
          >
            拒绝建议 (Reject)
          </button>

          <button
            onClick={() => setShowConfirmModal(true)}
            disabled={actionLoading || isApproved}
            className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white text-xs font-bold shadow-lg shadow-emerald-950/50 transition disabled:opacity-50"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>批准并应用参数 (Approve)</span>
          </button>
        </div>
      </div>

      {/* CONFIRMATION MODAL */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl animate-fade-in">
            <div className="flex items-center gap-3 border-b border-slate-800 pb-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-950 border border-emerald-700 flex items-center justify-center text-emerald-400">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-base font-bold text-slate-100">确认批准策略参数热更新</h4>
                <p className="text-xs text-slate-400">此操作将即时热重载线上量化策略</p>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              您即将把以下参数微调方案写入生产配置，明日开盘起将执行新策略阈值：
            </p>

            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-2 text-xs font-mono">
              {configDiff.map((item) => {
                const val = getParamValue(item);
                const isPct = item.param_key.includes("ratio") || item.param_key.includes("rate") || item.param_key.includes("pct");
                const format = (v: number | null | undefined) => (v == null || typeof v !== "number" || isNaN(v) ? "--" : (isPct ? `${(v * 100).toFixed(1)}%` : v.toString()));
                return (
                  <div key={item.param_key} className="flex justify-between items-center">
                    <span className="text-slate-400">{item.param_name}:</span>
                    <span className="font-bold text-emerald-400">
                      {format(item.current_value)} → {format(val)}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setShowConfirmModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 transition"
              >
                取消
              </button>
              <button
                onClick={async () => {
                  setShowConfirmModal(false);
                  await onApprove(customParams);
                }}
                disabled={actionLoading}
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white shadow-lg transition"
              >
                {actionLoading ? "应用中..." : "确定批准上线"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
