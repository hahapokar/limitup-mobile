import React from "react";
import { SentimentData } from "../types";
import { 
  Flame, 
  AlertTriangle, 
  TrendingUp, 
  TrendingDown, 
  ShieldAlert, 
  Zap, 
  Layers, 
  PieChart 
} from "lucide-react";

interface SentimentViewProps {
  sentiment: SentimentData | null;
  loading: boolean;
}

export const SentimentView: React.FC<SentimentViewProps> = ({ sentiment, loading }) => {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-400">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full animate-spin"></div>
          <span className="text-sm">正在拉取真实行情并计算大盘情绪...</span>
        </div>
      </div>
    );
  }

  if (!sentiment) {
    return (
      <div className="text-center py-16 text-slate-400">
        暂无情绪数据，系统将在 15:30 盘后自动生成当日 FINAL 情绪快照。
      </div>
    );
  }

  const score = sentiment.sentiment_score;
  const isCircuitBreaker = sentiment.sentiment_circuit_breaker;
  const sentimentState = sentiment.sentiment_state || (
    score < 30 ? "熔断状态" : (score < 45 ? "退潮/弱势期" : (score > 70 ? "主升/强势期" : "震荡/分化期"))
  );
  const c = sentiment.components;

  const getScoreColor = (val: number) => {
    if (val >= 75) return "text-red-500";
    if (val >= 60) return "text-orange-400";
    if (val >= 40) return "text-amber-400";
    if (val >= 30) return "text-cyan-400";
    return "text-rose-600";
  };

  const getScoreBg = (val: number) => {
    if (val >= 75) return "bg-red-500/10 border-red-500/30";
    if (val >= 60) return "bg-orange-500/10 border-orange-500/30";
    if (val >= 40) return "bg-amber-500/10 border-amber-500/30";
    return "bg-rose-500/10 border-rose-500/30";
  };

  const getStateBadgeStyle = (state: string) => {
    if (state.includes("熔断")) return "bg-rose-950/60 text-rose-300 border-rose-600/60";
    if (state.includes("退潮") || state.includes("弱势")) return "bg-amber-950/60 text-amber-300 border-amber-600/60";
    if (state.includes("主升") || state.includes("强势")) return "bg-red-950/60 text-red-300 border-red-600/60";
    return "bg-blue-950/60 text-blue-300 border-blue-600/60";
  };

  return (
    <div className="space-y-6">
      {/* Top Circuit Breaker Alert (if triggered) */}
      {isCircuitBreaker ? (
        <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-600/60 flex items-start gap-3 shadow-lg animate-pulse">
          <ShieldAlert className="w-6 h-6 text-rose-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-rose-300">
              🚨 大盘情绪冰点熔断机制已触发 (综合情绪得分 {score} 分 &lt; 30 分)
            </h3>
            <p className="text-xs text-rose-200/80 leading-relaxed">
              根据打板量化风控准则：在极度冰点行情下，接力首板与连板的亏钱效应极大（炸板率飙升、次日大幅低开）。
              系统已强制将明日目标建仓比例锁定为 <span className="font-bold underline">0% (禁止下单买入)</span>，以保护账户本金免受系统性杀跌风险。
            </p>
          </div>
        </div>
      ) : (
        <div className="p-4 rounded-xl bg-emerald-950/30 border border-emerald-600/40 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold">
              ✓
            </div>
            <div>
              <h3 className="text-sm font-bold text-emerald-300">
                情绪状态良好 · 允许量化打板建仓
              </h3>
              <p className="text-xs text-emerald-400/80">
                综合得分 {score} 分 ({sentiment.sentiment_level})，熔断开关未触发，次日建仓目标仓位比例 100%。
              </p>
            </div>
          </div>
          <span className="text-xs px-3 py-1 bg-emerald-900/50 text-emerald-200 border border-emerald-700/50 rounded-full font-mono font-medium">
            仓位限制: 100%
          </span>
        </div>
      )}

      {/* Main Score Hero Card */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Sentiment Gauge & Summary */}
        <div className="lg:col-span-1 bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col justify-between shadow-md">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                综合大盘情绪得分
              </span>
              <span className="text-xs font-mono text-slate-500">
                {sentiment.trade_date}
              </span>
            </div>

            <div className="mt-6 flex items-baseline justify-center gap-2">
              <span className={`text-6xl font-black font-mono tracking-tight ${getScoreColor(score)}`}>
                {score}
              </span>
              <span className="text-slate-500 text-lg font-mono">/ 100</span>
            </div>

            <div className="mt-4 flex flex-col items-center gap-1.5">
              <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold border ${getScoreBg(score)} ${getScoreColor(score)}`}>
                {sentiment.sentiment_level}
              </span>
              <span className={`inline-block px-2.5 py-0.5 rounded-md text-[11px] font-bold border font-mono ${getStateBadgeStyle(sentimentState)}`}>
                状态: {sentimentState}
              </span>
            </div>

            {/* Score Progress Bar */}
            <div className="mt-6 space-y-1.5">
              <div className="flex justify-between text-[11px] text-slate-400 font-mono">
                <span>0 极度冰点</span>
                <span className="text-rose-400">30 熔断线</span>
                <span>60 偏暖</span>
                <span>100 狂热</span>
              </div>
              <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden relative">
                <div 
                  className={`h-full transition-all duration-500 rounded-full ${
                    score < 30 ? "bg-rose-600" : (score < 60 ? "bg-amber-500" : "bg-red-500")
                  }`}
                  style={{ width: `${score}%` }}
                />
                {/* 30-point circuit breaker threshold marker */}
                <div 
                  className="absolute top-0 bottom-0 w-0.5 bg-rose-400" 
                  style={{ left: "30%" }} 
                  title="30分 冰点熔断警戒线"
                />
              </div>
            </div>
          </div>

          {/* Quick Breadth Stats */}
          <div className="mt-6 pt-4 border-t border-slate-800 grid grid-cols-3 gap-2 text-center">
            <div className="bg-slate-800/50 p-2 rounded-lg">
              <div className="text-[11px] text-slate-400">涨停家数</div>
              <div className="text-sm font-bold text-red-400 font-mono">
                {sentiment.market_summary.limit_up_count}
              </div>
            </div>
            <div className="bg-slate-800/50 p-2 rounded-lg">
              <div className="text-[11px] text-slate-400">跌停家数</div>
              <div className="text-sm font-bold text-emerald-400 font-mono">
                {sentiment.market_summary.limit_down_count}
              </div>
            </div>
            <div className="bg-slate-800/50 p-2 rounded-lg">
              <div className="text-[11px] text-slate-400">市场活跃度</div>
              <div className="text-sm font-bold text-amber-400 font-mono">
                {sentiment.market_summary.activity_pct}%
              </div>
            </div>
          </div>
        </div>

        {/* 4 Core Dimensions Breakdown */}
        <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Dimension 1: 昨日涨停今日平均溢价率 (35%) */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between shadow-sm hover:border-slate-700 transition">
            <div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-md bg-red-500/10 text-red-400">
                    <TrendingUp className="w-4 h-4" />
                  </div>
                  <span className="text-xs font-bold text-slate-200">昨日涨停今日溢价</span>
                </div>
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                  权重 35%
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-2">
                {c.yesterday_zt_premium.description}
              </p>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-800 flex items-end justify-between">
              <div>
                <span className="text-xs text-slate-500">实际均值:</span>
                <div className="text-lg font-bold font-mono text-slate-100">
                  {c.yesterday_zt_premium.raw_value >= 0 ? `+${c.yesterday_zt_premium.raw_value}` : c.yesterday_zt_premium.raw_value}%
                </div>
              </div>
              <div className="text-right">
                <span className="text-xs text-slate-500">因子得分:</span>
                <div className="text-base font-bold font-mono text-red-400">
                  {c.yesterday_zt_premium.score} <span className="text-xs text-slate-500">分</span>
                </div>
              </div>
            </div>
          </div>

          {/* Dimension 2: 全市场跌停家数 (25%) */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between shadow-sm hover:border-slate-700 transition">
            <div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-md bg-emerald-500/10 text-emerald-400">
                    <AlertTriangle className="w-4 h-4" />
                  </div>
                  <span className="text-xs font-bold text-slate-200">跌停恐慌家数</span>
                </div>
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                  权重 25%
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-2">
                {c.market_limit_down.description}
              </p>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-800 flex items-end justify-between">
              <div>
                <span className="text-xs text-slate-500">跌停数量:</span>
                <div className="text-lg font-bold font-mono text-slate-100">
                  {c.market_limit_down.raw_value} 家
                </div>
              </div>
              <div className="text-right">
                <span className="text-xs text-slate-500">因子得分:</span>
                <div className="text-base font-bold font-mono text-emerald-400">
                  {c.market_limit_down.score} <span className="text-xs text-slate-500">分</span>
                </div>
              </div>
            </div>
          </div>

          {/* Dimension 3: 连板最高高度与炸板率 (25%) */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between shadow-sm hover:border-slate-700 transition">
            <div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-md bg-purple-500/10 text-purple-400">
                    <Layers className="w-4 h-4" />
                  </div>
                  <span className="text-xs font-bold text-slate-200">连板高度与炸板率</span>
                </div>
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                  权重 25%
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-2">
                {c.max_consecutive_boards.description}
              </p>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-800 flex items-end justify-between">
              <div>
                <span className="text-xs text-slate-500">最高板/炸板率:</span>
                <div className="text-lg font-bold font-mono text-slate-100">
                  {c.max_consecutive_boards.raw_value}板 · {c.max_consecutive_boards.broken_rate_pct}%
                </div>
              </div>
              <div className="text-right">
                <span className="text-xs text-slate-500">因子得分:</span>
                <div className="text-base font-bold font-mono text-purple-400">
                  {c.max_consecutive_boards.score} <span className="text-xs text-slate-500">分</span>
                </div>
              </div>
            </div>
          </div>

          {/* Dimension 4: 全市场红盘上涨家数占比 (15%) */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between shadow-sm hover:border-slate-700 transition">
            <div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-md bg-blue-500/10 text-blue-400">
                    <PieChart className="w-4 h-4" />
                  </div>
                  <span className="text-xs font-bold text-slate-200">全市场赚钱效应</span>
                </div>
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                  权重 15%
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-2">
                {c.advance_decline_ratio.description}
              </p>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-800 flex items-end justify-between">
              <div>
                <span className="text-xs text-slate-500">上涨占比:</span>
                <div className="text-lg font-bold font-mono text-slate-100">
                  {c.advance_decline_ratio.raw_value}%
                </div>
              </div>
              <div className="text-right">
                <span className="text-xs text-slate-500">因子得分:</span>
                <div className="text-base font-bold font-mono text-blue-400">
                  {c.advance_decline_ratio.score} <span className="text-xs text-slate-500">分</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Market Advance vs Decline Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold text-slate-300">全市场涨跌分布</span>
          <div className="flex items-center gap-4 text-xs font-mono">
            <span className="text-red-400 font-semibold">上涨 {sentiment.market_summary.up_count} 家</span>
            <span className="text-slate-500">平盘 171 家</span>
            <span className="text-emerald-400 font-semibold">下跌 {sentiment.market_summary.down_count} 家</span>
          </div>
        </div>

        <div className="h-3 w-full bg-slate-800 rounded-full overflow-hidden flex">
          <div 
            className="bg-red-500 h-full"
            style={{ width: `${c.advance_decline_ratio.raw_value}%` }}
            title={`上涨占比 ${c.advance_decline_ratio.raw_value}%`}
          />
          <div 
            className="bg-emerald-500 h-full flex-1" 
            title="下跌占比"
          />
        </div>
      </div>
    </div>
  );
};
