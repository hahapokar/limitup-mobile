import React, { useState } from "react";
import { PortfolioState, HoldingPosition, TradeOrder } from "../types";
import { 
  DollarSign, 
  TrendingUp, 
  TrendingDown, 
  Shield, 
  Clock, 
  AlertCircle, 
  ListOrdered, 
  ArrowUpRight, 
  ArrowDownRight,
  Zap,
  Eye,
  RefreshCw,
  Sliders,
  CheckCircle2,
  Lock,
  Unlock,
  Flame
} from "lucide-react";
import { 
  ResponsiveContainer, 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  Tooltip, 
  CartesianGrid, 
  ReferenceLine 
} from "recharts";

interface PortfolioViewProps {
  portfolio: PortfolioState | null;
  loading: boolean;
  onSyncRealtime?: () => void;
  onManualSell?: (code: string) => Promise<void>;
  syncLoading?: boolean;
}

export const PortfolioView: React.FC<PortfolioViewProps> = ({ 
  portfolio, 
  loading,
  onSyncRealtime,
  onManualSell,
  syncLoading = false
}) => {
  const [sellingCode, setSellingCode] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-400">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
          <span className="text-sm">加载模拟盘数据...</span>
        </div>
      </div>
    );
  }

  if (!portfolio) {
    return (
      <div className="text-center py-16 text-slate-400">
        暂无模拟盘数据。
      </div>
    );
  }

  const {
    initial_capital,
    cash,
    market_value,
    total_asset,
    nav,
    total_pnl,
    holdings = [],
    trade_history = [],
    nav_history = []
  } = portfolio;

  // Safe number formatter for nullable numeric fields
  const fmtNum = (v: number | null | undefined, digits = 2, prefix = "") =>
    v != null && typeof v === "number" && !isNaN(v)
      ? `${prefix}${v.toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
      : "--";
  const fmtPct = (v: number | null | undefined, digits = 2, signed = false) =>
    v != null && typeof v === "number" && !isNaN(v)
      ? `${signed && v >= 0 ? "+" : ""}${v.toFixed(digits)}%`
      : "--";

  const pnlPercent = initial_capital > 0 ? (total_pnl / initial_capital) * 100 : 0;

  // Chart data format
  const chartData = (nav_history && nav_history.length > 0) ? nav_history : [
    { date: "—", nav: 1.0000, total_asset: initial_capital }
  ];

  const handleSellClick = async (code: string, name: string) => {
    if (!onManualSell) return;
    if (confirm(`确认手动对持仓标的 [${name} (${code})] 执行平仓并结算收益吗？`)) {
      setSellingCode(code);
      try {
        await onManualSell(code);
      } finally {
        setSellingCode(null);
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* 0. Automated Trading & Live Watchlist Status Header */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4 shadow-md">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-950/60 border border-emerald-700/50 flex items-center justify-center text-emerald-400">
            <Zap className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-slate-100">
                模拟盘全自动托管与实时盯盘清单 (Live Auto-Trader)
              </h2>
              <span className="px-2 py-0.5 rounded-full bg-emerald-950/80 text-emerald-400 border border-emerald-800 text-[11px] font-semibold flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
                自动执行中
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              系统每日按排名前 8 名候选评估三类买入策略，并实时计算持仓净值
            </p>
            <span className="text-[11px] text-emerald-300">
              行情状态：实时行情优先，失败时仅保留旧值展示并标记为 STALE
              {holdings.length > 0 && ` · 最近更新 ${holdings[0].quote_status_at || "—"}`}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block">
            <div className="text-[11px] text-slate-400">当前在盯标的</div>
            <div className="text-sm font-bold font-mono text-indigo-300">
              {holdings.length} / 5 只标的
            </div>
          </div>

          {onSyncRealtime && (
            <button
              onClick={onSyncRealtime}
              disabled={syncLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 border border-slate-700 text-xs font-semibold transition disabled:opacity-50"
              title="立即拉取腾讯/新浪最新分时行情与封成比"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-indigo-400 ${syncLoading ? "animate-spin" : ""}`} />
              <span>{syncLoading ? "刷新中..." : "实时刷新行情"}</span>
            </button>
          )}
        </div>
      </div>

      {/* 1. Top Key Account Metrics Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {/* NAV */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm">
          <div className="text-xs font-semibold text-slate-400">模拟盘净值 (NAV)</div>
          <div className={`text-2xl font-black font-mono mt-1 ${nav >= 1.0 ? "text-red-400" : "text-emerald-400"}`}>
            {nav.toFixed(4)}
          </div>
          <div className="text-[11px] text-slate-500 mt-1 font-mono">
            基准初始: 1.0000
          </div>
        </div>

        {/* Total Asset */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm">
          <div className="text-xs font-semibold text-slate-400">账户总资产</div>
          <div className="text-2xl font-bold font-mono text-slate-100 mt-1">
            ¥{total_asset.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-slate-500 mt-1 font-mono">
            初始本金: ¥{initial_capital.toLocaleString()}
          </div>
        </div>

        {/* Total PnL */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm">
          <div className="text-xs font-semibold text-slate-400">累计浮动盈亏</div>
          <div className={`text-2xl font-bold font-mono mt-1 flex items-center gap-1 ${
            total_pnl >= 0 ? "text-red-400" : "text-emerald-400"
          }`}>
            {total_pnl >= 0 ? "+" : ""}¥{total_pnl.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className={`text-[11px] font-mono mt-1 font-semibold ${total_pnl >= 0 ? "text-red-400" : "text-emerald-400"}`}>
            {pnlPercent >= 0 ? "+" : ""}{pnlPercent.toFixed(2)}%
          </div>
        </div>

        {/* Available Cash */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm">
          <div className="text-xs font-semibold text-slate-400">可用现金</div>
          <div className="text-2xl font-bold font-mono text-slate-100 mt-1">
            ¥{cash.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-slate-500 mt-1 font-mono">
            现金占比: {((cash / total_asset) * 100).toFixed(1)}%
          </div>
        </div>

        {/* Market Value of Holdings */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm col-span-2 lg:col-span-1">
          <div className="text-xs font-semibold text-slate-400">持仓总市值</div>
          <div className="text-2xl font-bold font-mono text-slate-100 mt-1">
            ¥{market_value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-slate-500 mt-1 font-mono">
            持仓数: {holdings.length} 只标的
          </div>
        </div>
      </div>

      {/* 2. REAL-TIME WATCHLIST (已买入股票专属盯盘清单) */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-md space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-indigo-950/70 border border-indigo-700/50 text-indigo-400">
              <Eye className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                已买入股票盯盘清单 (Live Position Watchlist)
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono">
                  {holdings.length} 标的在盯
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                实时监控：现价、封成比、换手率、高点回撤、移动止盈与防洗盘止损 · 触发条件时自动弹窗提示并撤出
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="px-2.5 py-1 rounded bg-slate-800/80 border border-slate-700 text-slate-300 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
              封成比 &gt; 3% 强力封死
            </span>
            <span className="px-2.5 py-1 rounded bg-slate-800/80 border border-slate-700 text-slate-300 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-400"></span>
              移动止盈: 峰值回撤 ≥ 2.5%
            </span>
          </div>
        </div>

        {holdings.length === 0 ? (
          <div className="text-center py-12 px-6 text-slate-400 border border-dashed border-slate-800 rounded-xl space-y-4 bg-slate-950/40">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-emerald-950/40 border border-emerald-800/40 flex items-center justify-center text-emerald-400">
              <CheckCircle2 className="w-7 h-7" />
            </div>
            <div>
              <div className="text-base font-bold text-slate-200">模拟盘资金已清空就绪 (¥{cash.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}) · 空仓待命</div>
              <p className="text-xs text-slate-400 max-w-lg mx-auto mt-1.5 leading-relaxed">
                已按要求清空上一轮模拟持仓数据。系统将在下一个开盘日（09:15 早盘集合竞价 ~ 09:30 开盘）自动监控候选标的池，按照集合竞价开盘偏离度与四大因子评分自动撮合建仓！
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3 pt-2 text-xs">
              <span className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-emerald-400" />
                <span>100% 纯现金待命 (¥100,000)</span>
              </span>
              <span className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-indigo-400" />
                <span>开盘自动监控与撮合</span>
              </span>
              <span className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-amber-400" />
                <span>T+1 制度与分时盯盘防护</span>
              </span>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-800/70 text-slate-300 border-b border-slate-700 font-mono">
                <tr>
                  <th className="py-3 px-3">标的名称/代码</th>
                  <th className="py-3 px-3">实时现价 (今日涨跌)</th>
                  <th className="py-3 px-3">实时封成比</th>
                  <th className="py-3 px-3">实时换手率</th>
                  <th className="py-3 px-3">买入价/成本价</th>
                  <th className="py-3 px-3">持仓市值/股数</th>
                  <th className="py-3 px-3">持仓浮动盈亏</th>
                  <th className="py-3 px-3">最高价/高点回撤</th>
                  <th className="py-3 px-3">移动止盈线 (峰值-2.5%)</th>
                  <th className="py-3 px-3">防洗盘硬止损 (-4.13%)</th>
                  <th className="py-3 px-3">持股周期</th>
                  <th className="py-3 px-3">风控状态</th>
                  <th className="py-3 px-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 font-mono">
                {holdings.map((h) => {
                  const isPositive = (h.unrealized_pnl ?? 0) >= 0;
                  const isDayPositive = (h.change_pct ?? 0) >= 0;
                  const sealRatio = h.seal_ratio ?? 0.0;
                  const turnoverRate = h.turnover_rate ?? 0.0;
                  const pullbackPct = h.pullback_pct ?? 0.0;
                  const trailingStopLine = h.trailing_stop_price ?? (h.high_price != null ? h.high_price * 0.975 : 0);

                  // Status Badge Styling
                  let statusBadge = {
                    label: "正常持股",
                    color: "bg-slate-800 text-slate-300 border-slate-700"
                  };
                  if (h.status_tag === "LOCKED_ZT" || (h.change_pct || 0) >= 9.8) {
                    statusBadge = {
                      label: "牢牢封死涨停",
                      color: "bg-red-950/80 text-red-300 border-red-700"
                    };
                  } else if (h.status_tag === "TRAILING_WARN" || pullbackPct >= 1.8) {
                    statusBadge = {
                      label: "逼近止盈线",
                      color: "bg-amber-950/80 text-amber-300 border-amber-700"
                    };
                  } else if (h.status_tag === "HARD_STOP_WARN") {
                    statusBadge = {
                      label: "止损观察中",
                      color: "bg-rose-950/80 text-rose-300 border-rose-700"
                    };
                  } else if (h.status_tag === "T2_EXIT_PENDING") {
                    statusBadge = {
                      label: "T+2待尾盘平仓",
                      color: "bg-purple-950/80 text-purple-300 border-purple-700"
                    };
                  }

                  return (
                    <tr key={h.code} className="hover:bg-slate-800/50 transition">
                      {/* Name & Code */}
                      <td className="py-3.5 px-3">
                        <div className="font-bold text-slate-100 text-sm font-sans flex items-center gap-1.5">
                          <span>{h.name}</span>
                          {(h.change_pct || 0) >= 9.8 && (
                            <span className="text-[10px] px-1 rounded bg-red-600 text-white font-bold">板</span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          {h.code} · {h.sector}
                          <span className={`ml-2 ${h.quote_status === "LIVE" ? "text-emerald-400" : "text-amber-400"}`}>
                            {h.quote_status === "LIVE" ? "LIVE" : "STALE"}
                          </span>
                        </div>
                      </td>

                      {/* Realtime Price & Today Change */}
                      <td className="py-3.5 px-3">
                        <div className={`text-sm font-black ${isDayPositive ? "text-red-400" : "text-emerald-400"}`}>
                          {fmtNum(h.current_price, 2, "¥")}
                        </div>
                        <div className={`text-[11px] font-bold ${isDayPositive ? "text-red-400" : "text-emerald-400"}`}>
                          {h.change_pct != null ? `${isDayPositive ? "+" : ""}${h.change_pct.toFixed(2)}%` : "--"}
                        </div>
                      </td>

                      {/* Seal Ratio 封成比 */}
                      <td className="py-3.5 px-3">
                        {sealRatio > 0 ? (
                          <div>
                            <span className={`px-2 py-0.5 rounded font-bold text-[11px] ${
                              sealRatio >= 10.0
                                ? "bg-red-950/80 text-red-300 border border-red-700"
                                : (sealRatio >= 3.0 ? "bg-amber-950/80 text-amber-300 border border-amber-700" : "bg-slate-800 text-slate-300")
                            }`}>
                              {sealRatio.toFixed(1)}%
                            </span>
                            <div className="text-[10px] text-slate-500 mt-0.5">
                              {sealRatio >= 10 ? "强力封单" : (sealRatio >= 3 ? "稳健封板" : "弱封/试盘")}
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-500">-- (未封板)</span>
                        )}
                      </td>

                      {/* Turnover Rate 换手率 */}
                      <td className="py-3.5 px-3">
                        <span className="text-slate-200 font-bold">
                          {turnoverRate.toFixed(2)}%
                        </span>
                        <div className="text-[10px] text-slate-500">
                          {turnoverRate > 20 ? "高换手" : (turnoverRate > 8 ? "良性活跃" : "缩量")}
                        </div>
                      </td>

                      {/* Entry & Cost Price */}
                      <td className="py-3.5 px-3">
                        <div className="text-slate-200">{fmtNum(h.entry_price, 2, "¥")}</div>
                        <div className="text-[10px] text-slate-500">成本: {fmtNum(h.cost_price, 3, "¥")}</div>
                      </td>

                      {/* Shares & Market Value */}
                      <td className="py-3.5 px-3">
                        <div className="text-slate-200 font-bold">
                          {fmtNum(h.market_value, 2, "¥")}
                        </div>
                        <div className="text-[10px] text-slate-400">{h.shares.toLocaleString()} 股</div>
                      </td>

                      {/* Unrealized PnL */}
                      <td className="py-3.5 px-3">
                        <div className={`font-bold ${isPositive ? "text-red-400" : "text-emerald-400"}`}>
                          {h.unrealized_pnl != null ? `${isPositive ? "+" : ""}¥${h.unrealized_pnl.toFixed(2)}` : "--"}
                        </div>
                        <div className={`text-[11px] font-semibold ${isPositive ? "text-red-400" : "text-emerald-400"}`}>
                          {fmtPct(h.unrealized_pnl_pct, 2, true)}
                        </div>
                      </td>

                      {/* High Price & Pullback % */}
                      <td className="py-3.5 px-3">
                        <div className="text-slate-300">{fmtNum(h.high_price, 2, "¥")}</div>
                        <div className={`text-[10px] ${pullbackPct >= 2.0 ? "text-amber-400 font-bold" : "text-slate-500"}`}>
                          回撤: -{pullbackPct.toFixed(2)}%
                        </div>
                      </td>

                      {/* Trailing Stop Line */}
                      <td className="py-3.5 px-3">
                        <div className="text-amber-300 font-bold">{fmtNum(trailingStopLine, 2, "¥")}</div>
                        <div className="text-[10px] text-slate-500">距现价: {h.current_price != null ? fmtNum(h.current_price - trailingStopLine, 2) : "--"}</div>
                      </td>

                      {/* Hard Stop Line */}
                      <td className="py-3.5 px-3">
                        <div className="text-rose-300">{fmtNum(h.hard_stop_price, 2, "¥")}</div>
                        <div className="text-[10px] text-slate-500">
                          防洗盘: {h.anti_shakeout_count > 0 ? `${h.anti_shakeout_count}/3次` : "安全"}
                        </div>
                      </td>

                      {/* Holding Days & T+1 Lock Status */}
                      <td className="py-3.5 px-3">
                        {h.holding_days === 0 || h.can_sell === false ? (
                          <div>
                            <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-950/80 text-amber-300 border border-amber-800 flex items-center gap-1 w-fit">
                              <Lock className="w-3 h-3" />
                              <span>T+0 当日建仓</span>
                            </span>
                            <div className="text-[10px] text-amber-400/80 mt-0.5">
                              A股T+1锁仓 · {h.sell_available_date ? h.sell_available_date.slice(5).replace("-", "/") : "下一交易日"}可卖
                            </div>
                          </div>
                        ) : (
                          <div>
                            <span className={`px-2 py-0.5 rounded text-[11px] font-semibold flex items-center gap-1 w-fit ${
                              h.holding_days >= 2 
                                ? "bg-purple-950/80 text-purple-300 border border-purple-800" 
                                : "bg-emerald-950/80 text-emerald-300 border border-emerald-800"
                            }`}>
                              <Unlock className="w-3 h-3" />
                              <span>T+{h.holding_days} (可卖出)</span>
                            </span>
                            {h.holding_days >= 2 && (
                              <div className="text-[10px] text-purple-400 mt-0.5">
                                尾盘强制平仓预警
                              </div>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Status Tag */}
                      <td className="py-3.5 px-3">
                        <span className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${statusBadge.color}`}>
                          {statusBadge.label}
                        </span>
                      </td>

                      {/* Manual Action */}
                      <td className="py-3.5 px-3 text-right">
                        {h.holding_days === 0 || h.can_sell === false ? (
                          <span 
                            className="px-2.5 py-1 rounded bg-slate-800/60 text-slate-500 border border-slate-800 text-[11px] cursor-not-allowed flex items-center gap-1 justify-end"
                            title="A股T+1制度：8月24日买入锁仓中，最早在8月25日才能卖出"
                          >
                            <Lock className="w-3 h-3 text-slate-500" />
                            <span>T+1锁仓</span>
                          </span>
                        ) : (
                          <button
                            onClick={() => handleSellClick(h.code, h.name)}
                            disabled={sellingCode === h.code}
                            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-rose-950 hover:text-rose-300 text-slate-300 border border-slate-700 hover:border-rose-700 transition text-[11px] disabled:opacity-50"
                            title="手动平仓离场并结算收益"
                          >
                            {sellingCode === h.code ? "平仓中..." : "平仓"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 3. NAV Cumulative Curve Chart */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-md">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-slate-200">模拟盘净值走势图 (NAV Tracking Curve)</h3>
            <p className="text-xs text-slate-400">100% 真实行情逐笔撮合计提 · 严格扣除单边 0.15% 交易摩擦成本</p>
          </div>
          <span className="text-xs px-2.5 py-1 rounded bg-slate-800 border border-slate-700 text-slate-300 font-mono">
            样本周期: {chartData[0]?.date} ~ {chartData[chartData.length - 1]?.date}
          </span>
        </div>

        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 10, right: 20, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.5} />
              <XAxis 
                dataKey="date" 
                stroke="#64748b" 
                fontSize={11} 
                tickLine={false} 
              />
              <YAxis 
                stroke="#64748b" 
                fontSize={11} 
                domain={['auto', 'auto']} 
                tickFormatter={(v) => v.toFixed(3)}
                tickLine={false} 
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: '#0f172a', 
                  borderColor: '#334155',
                  borderRadius: '0.5rem',
                  fontSize: '12px',
                  color: '#f8fafc'
                }}
                formatter={(value: any) => [`${Number(value).toFixed(4)}`, "NAV净值"]}
                labelFormatter={(label) => `交易日: ${label}`}
              />
              <ReferenceLine y={1.0000} stroke="#64748b" strokeDasharray="4 4" label={{ value: "基准 1.0", fill: "#64748b", fontSize: 10 }} />
              <Line 
                type="monotone" 
                dataKey="nav" 
                stroke="#ef4444" 
                strokeWidth={2.5} 
                dot={{ r: 3, fill: "#ef4444" }}
                activeDot={{ r: 6, fill: "#f87171" }} 
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 4. Trade Execution Orders Log (含平仓撤出记录) */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-md space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ListOrdered className="w-5 h-5 text-slate-400" />
            <h3 className="text-sm font-bold text-slate-200">模拟交易成交明细与平仓离场记录 (Trade Log)</h3>
          </div>
          <span className="text-xs text-slate-400">
            共记录 {trade_history.length} 笔撮合订单 (已平仓标的已从盯盘池撤出)
          </span>
        </div>

        {trade_history.length === 0 ? (
          <div className="text-center py-8 text-slate-500 text-xs">
            暂无历史交易订单记录。
          </div>
        ) : (
          <div className="overflow-x-auto max-h-80 no-scrollbar">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-800/60 text-slate-400 border-b border-slate-700 font-mono sticky top-0">
                <tr>
                  <th className="py-2 px-3">时间/日期</th>
                  <th className="py-2 px-3">操作类型</th>
                  <th className="py-2 px-3">标的名称/代码</th>
                  <th className="py-2 px-3">成交价格</th>
                  <th className="py-2 px-3">数量</th>
                  <th className="py-2 px-3">成交金额</th>
                  <th className="py-2 px-3">摩擦成本</th>
                  <th className="py-2 px-3">已实现盈亏</th>
                  <th className="py-2 px-3">买入/卖出策略</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 font-mono">
                {trade_history.map((t) => (
                  <tr key={t.order_id} className="hover:bg-slate-800/30 transition">
                    <td className="py-2.5 px-3 text-slate-400">
                      {t.date} {t.time}
                    </td>
                    <td className="py-2.5 px-3">
                      {t.type === "BUY" ? (
                        <span className="px-2 py-0.5 rounded bg-red-950/60 text-red-400 border border-red-800/40 text-[11px] font-bold">
                          买入建仓
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded bg-indigo-950/60 text-indigo-400 border border-indigo-800/40 text-[11px] font-bold">
                          平仓离场
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="font-bold text-slate-200 font-sans">{t.name}</span>
                      <span className="text-slate-400 ml-1">({t.code})</span>
                    </td>
                    <td className="py-2.5 px-3 text-slate-200">¥{t.price.toFixed(2)}</td>
                    <td className="py-2.5 px-3 text-slate-300">{t.shares.toLocaleString()} 股</td>
                    <td className="py-2.5 px-3 text-slate-200">¥{t.amount.toLocaleString()}</td>
                    <td className="py-2.5 px-3 text-slate-400">¥{t.friction.toFixed(2)}</td>
                    <td className="py-2.5 px-3">
                      {t.realized_pnl !== undefined ? (
                        <span className={`font-bold ${t.realized_pnl >= 0 ? "text-red-400" : "text-emerald-400"}`}>
                          {t.realized_pnl >= 0 ? "+" : ""}¥{t.realized_pnl.toFixed(2)} ({t.realized_pnl_pct! >= 0 ? "+" : ""}{t.realized_pnl_pct?.toFixed(2)}%)
                        </span>
                      ) : (
                        <span className="text-slate-500">--</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-slate-300 font-sans text-[11px]">
                      {t.strategy_name && (
                        <div className="text-indigo-300 font-semibold mb-0.5">{t.strategy_name}</div>
                      )}
                      <div>{t.reason}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
