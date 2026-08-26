import React, { useState } from "react";
import { CandidatesPayload, CandidateStock, MarketSessionInfo } from "../types";
import { SentimentView } from "./SentimentView";
import { 
  Award, 
  Clock, 
  Flame, 
  ShieldCheck, 
  BarChart2, 
  Layers, 
  Zap, 
  CheckCircle2, 
  Info,
  Sliders
} from "lucide-react";

interface CandidatesViewProps {
  payload: CandidatesPayload | null;
  loading: boolean;
  sentiment: import("../types").SentimentData | null;
  marketSession?: MarketSessionInfo | null;
}

export const CandidatesView: React.FC<CandidatesViewProps> = ({ payload, loading, sentiment, marketSession }) => {
  const [selectedCandidate, setSelectedCandidate] = useState<CandidateStock | null>(null);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-400">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full animate-spin"></div>
          <span className="text-sm">正在运行四大因子百分位排名打分选股模型...</span>
        </div>
      </div>
    );
  }

  if (!payload || !payload.candidates || payload.candidates.length === 0) {
    return (
      <div className="text-center py-16 text-slate-400">
        暂无选股结果，系统将在 15:30 盘后自动生成当日 FINAL 选股快照。
      </div>
    );
  }

  const candidates = payload.all_scored_stocks?.length
    ? payload.all_scored_stocks.slice(0, 8)
    : payload.candidates;
  const currentSelected = selectedCandidate || candidates[0];
  const stats = payload.filter_stats;

  return (
    <div className="space-y-6">
      <section className="border-b border-slate-800 pb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-100">实时情绪与四大因子选股</h2>
            <p className="text-xs text-slate-400 mt-1">
              情绪择时作为四大因子选股的前置风控，数据日期：{sentiment?.trade_date || "—"}
              {marketSession?.today_date && <span className="ml-2 text-amber-300">将于 {marketSession.today_date} 15:30 更新</span>}
            </p>
          </div>
          <span className="text-[11px] px-2 py-1 rounded border border-emerald-700/50 bg-emerald-950/40 text-emerald-300">盘后 FINAL</span>
        </div>
        <SentimentView sentiment={sentiment} loading={false} />
      </section>
      {/* Top Filter Stats Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-red-600/10 text-red-400 flex items-center justify-center font-bold">
            <Sliders className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-200">
              今日涨停排雷与四大因子打分结果 ({payload.trade_date})
            </h3>
            <p className="text-xs text-slate-400">
              全量涨停池共 <span className="text-slate-200 font-mono font-semibold">{payload.total_limit_up_count}</span> 只标的，经基础排雷硬过滤后剩余 <span className="text-emerald-400 font-mono font-semibold">{payload.passed_filter_count}</span> 只，当前展示量化排名前 {candidates.length} 名，买入策略按排名顺序评估。
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span className="px-2.5 py-1 rounded bg-slate-800 border border-slate-700 text-slate-300">
            ST排雷: 剔除 {stats?.st_excluded || 0} 只
          </span>
          <span className="px-2.5 py-1 rounded bg-slate-800 border border-slate-700 text-slate-300">
            市值15-150亿过滤: 剔除 {stats?.cap_out_of_range || 0} 只
          </span>
          <span className="px-2.5 py-1 rounded bg-slate-800 border border-slate-700 text-slate-300">
            股价5-50元过滤: 剔除 {stats?.price_out_of_range || 0} 只
          </span>
        </div>
      </div>

      {/* Main Grid: Candidates List + Factor Deep Dive Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Top 8 candidate cards */}
        <div className="lg:col-span-5 space-y-3">
          <div className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
            <span>量化推荐标的清单 (Top {candidates.length})</span>
            <span>点击查看因子画像</span>
          </div>

          {candidates.map((c, index) => {
            const isSelected = currentSelected?.code === c.code;
            return (
              <div
                key={c.code}
                onClick={() => setSelectedCandidate(c)}
                className={`p-4 rounded-xl border transition-all cursor-pointer shadow-sm relative ${
                  isSelected
                    ? "bg-slate-800/90 border-red-500/80 ring-1 ring-red-500/50"
                    : "bg-slate-900 border-slate-800 hover:border-slate-700 hover:bg-slate-850"
                }`}
              >
                {/* Rank Badge */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className={`w-7 h-7 rounded-md flex items-center justify-center font-bold text-xs font-mono shadow-sm ${
                      index === 0 
                        ? "bg-amber-500 text-slate-950" 
                        : (index === 1 ? "bg-slate-300 text-slate-950" : (index === 2 ? "bg-amber-700 text-amber-100" : "bg-slate-800 text-slate-400"))
                    }`}>
                      #{index + 1}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-base font-bold text-slate-100">{c.name}</span>
                        <span className="text-xs font-mono text-slate-400">{c.code}</span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                          {c.sector}
                        </span>
                        <span className="text-[11px] px-1.5 py-0.5 rounded bg-red-950/40 text-red-400 border border-red-800/40 font-mono">
                          {c.consecutive_boards}连板
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Quant Score Badge */}
                  <div className="text-right">
                    <div className="text-xl font-black font-mono text-red-400 tracking-tight">
                      {c.quant_score?.toFixed(2) ?? "--"}
                    </div>
                    <span className="text-[10px] text-slate-400 block -mt-0.5">量化总分</span>
                  </div>
                </div>

                {/* Quick Key Metrics Grid */}
                <div className="mt-3 pt-3 border-t border-slate-800/80 grid grid-cols-4 gap-2 text-center text-xs font-mono">
                  <div>
                    <span className="text-[10px] text-slate-500 block">收盘价</span>
                    <span className="font-bold text-red-400">¥{c.price?.toFixed(2) ?? "--"}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 block">封成比</span>
                    <span className="font-medium text-slate-300">{c.seal_ratio != null ? `${(c.seal_ratio * 100).toFixed(1)}%` : "--"}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 block">换手率</span>
                    <span className="font-medium text-slate-300">{c.turnover_rate != null ? `${c.turnover_rate.toFixed(1)}%` : "--"}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 block">首封时间</span>
                    <span className="font-medium text-amber-300">{c.first_seal_time?.slice(0, 5) ?? "--"}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Right: Selected Candidate 4-Factor Deep Dive (7 cols) */}
        <div className="lg:col-span-7">
          {currentSelected ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-md space-y-6">
              {/* Header Info */}
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
                <div>
                  <div className="flex items-center gap-3">
                    <span className="text-2xl font-black text-slate-100">{currentSelected.name}</span>
                    <span className="text-sm font-mono text-slate-400 bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
                      {currentSelected.code}
                    </span>
                    <span className="text-xs px-2.5 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30 font-semibold font-mono">
                      {currentSelected.consecutive_boards} 连板
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    所属细分行业: <span className="text-slate-200 font-medium">{currentSelected.sector}</span> · 自由流通市值: <span className="text-slate-200 font-mono">{(currentSelected.float_market_cap / 1e8).toFixed(2)} 亿元</span>
                  </p>
                </div>

                <div className="text-right">
                  <div className="text-3xl font-black font-mono text-red-400">
                    {currentSelected.quant_score.toFixed(2)}
                  </div>
                  <span className="text-xs text-slate-400">四大因子综合得分 (100分制)</span>
                </div>
              </div>

              {/* 4 Factor Score Bars */}
              <div className="space-y-4">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                  四大因子相对分位数 (Percentile Rank) 打分明细
                </h4>

                {/* Factor 1: 连板阶梯与情绪联动因子 (30%) */}
                {(() => {
                  const fConsec = currentSelected.factor_breakdown.consecutive_board_sentiment || currentSelected.factor_breakdown.status_stability;
                  const scoreVal = fConsec?.score ?? 70;
                  const adj = fConsec?.sentiment_adjustment ?? 0;
                  const stateStr = fConsec?.sentiment_state || payload.sentiment_state || "常规状态";
                  const isLeader = fConsec?.is_spatial_leader;

                  return (
                    <div className="bg-slate-800/60 border border-slate-700/60 rounded-lg p-3.5 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Layers className="w-4 h-4 text-purple-400" />
                          <span className="text-xs font-bold text-slate-200">1. 连板阶梯与情绪联动因子</span>
                          <span className="text-[11px] text-slate-400"> (权重 30%)</span>
                        </div>
                        <span className="text-sm font-bold font-mono text-purple-400">
                          {scoreVal} 分
                        </span>
                      </div>
                      <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
                        <div 
                          className="bg-purple-400 h-full rounded-full transition-all"
                          style={{ width: `${Math.min(100, scoreVal)}%` }}
                        />
                      </div>
                      <div className="flex flex-wrap items-center justify-between text-[11px] text-slate-400 font-mono pt-1 gap-1">
                        <span>
                          连板身位: <span className="text-slate-200 font-semibold">{currentSelected.consecutive_boards} 连板</span> 
                          (基础分 {fConsec?.base_board_score ?? (currentSelected.consecutive_boards >= 5 ? 95 : (currentSelected.consecutive_boards >= 3 ? 75 : (currentSelected.consecutive_boards === 2 ? 65 : 50)))}分)
                        </span>
                        <span className="flex items-center gap-1.5">
                          {isLeader && (
                            <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px]">
                              👑 空间高度龙头
                            </span>
                          )}
                          {adj !== 0 && (
                            <span className={`px-1.5 py-0.2 rounded text-[10px] ${adj > 0 ? "bg-red-950 text-red-400 border border-red-800" : "bg-blue-950 text-blue-400 border border-blue-800"}`}>
                              {adj > 0 ? `+${adj}分 (情绪加成)` : `${adj}分 (退潮避险)`}
                            </span>
                          )}
                          <span>情绪联动: {stateStr}</span>
                        </span>
                      </div>
                    </div>
                  );
                })()}

                {/* Factor 2: 封板强度因子 (25%) */}
                <div className="bg-slate-800/60 border border-slate-700/60 rounded-lg p-3.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Zap className="w-4 h-4 text-amber-400" />
                      <span className="text-xs font-bold text-slate-200">2. 封板强度因子</span>
                      <span className="text-[11px] text-slate-400"> (权重 25%)</span>
                    </div>
                    <span className="text-sm font-bold font-mono text-amber-400">
                      {currentSelected.factor_breakdown.seal_strength.score} 分
                    </span>
                  </div>
                  <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
                    <div 
                      className="bg-amber-400 h-full rounded-full transition-all"
                      style={{ width: `${Math.min(100, currentSelected.factor_breakdown.seal_strength.score)}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[11px] text-slate-400 font-mono pt-1">
                    <span>封成比: {(currentSelected.seal_ratio * 100).toFixed(2)}% (排名分位)</span>
                    <span>首次封板: {currentSelected.first_seal_time}</span>
                  </div>
                </div>

                {/* Factor 3: 筹码结构与炸板惩罚因子 (25%) */}
                <div className="bg-slate-800/60 border border-slate-700/60 rounded-lg p-3.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <BarChart2 className="w-4 h-4 text-emerald-400" />
                      <span className="text-xs font-bold text-slate-200">3. 筹码结构与炸板惩罚</span>
                      <span className="text-[11px] text-slate-400"> (权重 25%)</span>
                    </div>
                    <span className="text-sm font-bold font-mono text-emerald-400">
                      {currentSelected.factor_breakdown.chip_structure.score} 分
                    </span>
                  </div>
                  <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
                    <div 
                      className="bg-emerald-400 h-full rounded-full transition-all"
                      style={{ width: `${Math.min(100, currentSelected.factor_breakdown.chip_structure.score)}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[11px] text-slate-400 font-mono pt-1">
                    <span>当日换手率: {currentSelected.turnover_rate.toFixed(2)}% (5%-18%黄金区间)</span>
                    <span>
                      炸板回封: {currentSelected.broken_count} 次 
                      {currentSelected.high_60d_breakout ? " · 60日新高突破" : ""}
                    </span>
                  </div>
                </div>

                {/* Factor 4: 板块共振因子 (20%) */}
                <div className="bg-slate-800/60 border border-slate-700/60 rounded-lg p-3.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-blue-400" />
                      <span className="text-xs font-bold text-slate-200">4. 板块共振因子</span>
                      <span className="text-[11px] text-slate-400"> (权重 20%)</span>
                    </div>
                    <span className="text-sm font-bold font-mono text-blue-400">
                      {currentSelected.factor_breakdown.sector_resonance.score} 分
                    </span>
                  </div>
                  <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
                    <div 
                      className="bg-blue-400 h-full rounded-full transition-all"
                      style={{ width: `${Math.min(100, currentSelected.factor_breakdown.sector_resonance.score)}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[11px] text-slate-400 font-mono pt-1">
                    <span>板块涨停家数: {currentSelected.factor_breakdown.sector_resonance.sector_zt_count} 家</span>
                    <span>首板跟风助攻: {currentSelected.factor_breakdown.sector_resonance.has_follower ? "✓ 有助攻(+30分)" : "无助攻"}</span>
                  </div>
                </div>
              </div>

              {/* T+1 Execution Rules Note */}
              <div className="bg-slate-800/40 border border-slate-700/40 rounded-lg p-3 text-xs text-slate-400 space-y-1">
                <div className="flex items-center gap-1.5 text-slate-300 font-semibold">
                  <Info className="w-3.5 h-3.5 text-amber-400" />
                  <span>次日 (T+1) 模拟盘撮合开盘判定准则:</span>
                </div>
                <ul className="list-disc pl-5 space-y-0.5 text-[11px]">
                  <li>若次日开盘涨幅 &gt;= +9.8%（巨量一字涨停），现实中散户无法买入，系统将自动跳过放弃。</li>
                  <li>若次日开盘低开 &lt; -4.5%，判定为极弱开盘，系统将放弃建仓。</li>
                  <li>其余正常开盘标的，按可用资金等权重挂单买入，并计提 0.15% 单边摩擦成本。</li>
                </ul>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};
