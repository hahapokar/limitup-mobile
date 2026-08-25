import React, { useState, useMemo } from "react";
import { CandidateStock } from "../types";
import { Search, Filter, Check, X, Shield, Sparkles } from "lucide-react";

interface LimitUpPoolViewProps {
  pool: CandidateStock[];
  loading: boolean;
  tradeDate: string;
}

export const LimitUpPoolView: React.FC<LimitUpPoolViewProps> = ({ pool, loading, tradeDate }) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterTab, setFilterTab] = useState<"all" | "passed" | "st" | "cap" | "price">("all");
  const [sortBy, setSortBy] = useState<"consecutive_boards" | "seal_ratio" | "turnover_rate" | "amount" | "quant_score">("quant_score");

  const filteredPool = useMemo(() => {
    return pool.filter((item) => {
      // Search
      const matchSearch =
        item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.code.includes(searchTerm) ||
        item.sector.toLowerCase().includes(searchTerm.toLowerCase());
      if (!matchSearch) return false;

      // Filter tabs
      const isST = item.is_st || item.name.includes("ST");
      const capIn15_150B = item.float_market_cap >= 1.5e9 && item.float_market_cap <= 15e9;
      const priceIn5_50 = item.price >= 5.0 && item.price <= 50.0;
      const passedAll = !isST && capIn15_150B && priceIn5_50;

      if (filterTab === "passed") return passedAll;
      if (filterTab === "st") return isST;
      if (filterTab === "cap") return !capIn15_150B;
      if (filterTab === "price") return !priceIn5_50;
      return true;
    }).sort((a, b) => {
      if (sortBy === "quant_score") return (b.quant_score || 0) - (a.quant_score || 0);
      if (sortBy === "consecutive_boards") return b.consecutive_boards - a.consecutive_boards;
      if (sortBy === "seal_ratio") return b.seal_ratio - a.seal_ratio;
      if (sortBy === "turnover_rate") return b.turnover_rate - a.turnover_rate;
      if (sortBy === "amount") return b.amount - a.amount;
      return 0;
    });
  }, [pool, searchTerm, filterTab, sortBy]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-400">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full animate-spin"></div>
          <span className="text-sm">正在加载全量真实涨停池数据...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Top Search & Filter Control Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm flex flex-wrap items-center justify-between gap-4">
        {/* Filter Tabs */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={() => setFilterTab("all")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              filterTab === "all"
                ? "bg-red-600 text-white shadow-sm"
                : "bg-slate-800 text-slate-400 hover:text-slate-200"
            }`}
          >
            全部涨停池 ({pool.length})
          </button>
          <button
            onClick={() => setFilterTab("passed")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              filterTab === "passed"
                ? "bg-emerald-600 text-white shadow-sm"
                : "bg-slate-800 text-slate-400 hover:text-slate-200"
            }`}
          >
            ✓ 基础排雷合格
          </button>
          <button
            onClick={() => setFilterTab("st")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              filterTab === "st"
                ? "bg-rose-600 text-white shadow-sm"
                : "bg-slate-800 text-slate-400 hover:text-slate-200"
            }`}
          >
            剔除ST股
          </button>
          <button
            onClick={() => setFilterTab("cap")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              filterTab === "cap"
                ? "bg-amber-600 text-white shadow-sm"
                : "bg-slate-800 text-slate-400 hover:text-slate-200"
            }`}
          >
            市值不符(&lt;15亿/&gt;150亿)
          </button>
          <button
            onClick={() => setFilterTab("price")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              filterTab === "price"
                ? "bg-purple-600 text-white shadow-sm"
                : "bg-slate-800 text-slate-400 hover:text-slate-200"
            }`}
          >
            股价不符(&lt;5元/&gt;50元)
          </button>
        </div>

        {/* Search Bar & Sorter */}
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-60">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="搜索股票名称 / 代码 / 板块..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-red-500 font-mono"
            />
          </div>

          <select
            value={sortBy}
            onChange={(e: any) => setSortBy(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none font-mono"
          >
            <option value="quant_score">按量化总分排序</option>
            <option value="consecutive_boards">按连板高度排序</option>
            <option value="seal_ratio">按封成比排序</option>
            <option value="turnover_rate">按换手率排序</option>
            <option value="amount">按成交额排序</option>
          </select>
        </div>
      </div>

      {/* Pool Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-md">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-800/80 text-slate-400 border-b border-slate-700 font-mono">
              <tr>
                <th className="py-3 px-3">序号</th>
                <th className="py-3 px-3">标的代码/名称</th>
                <th className="py-3 px-3">所属细分行业</th>
                <th className="py-3 px-3">最新收盘价</th>
                <th className="py-3 px-3">连板高度</th>
                <th className="py-3 px-3">首次封板时间</th>
                <th className="py-3 px-3">封成比 (封单/成交)</th>
                <th className="py-3 px-3">换手率</th>
                <th className="py-3 px-3">自由流通市值</th>
                <th className="py-3 px-3">炸板次数</th>
                <th className="py-3 px-3">硬排雷状态</th>
                <th className="py-3 px-3">量化得分</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 font-mono">
              {filteredPool.map((stock, idx) => {
                const isST = stock.is_st || stock.name.includes("ST");
                const capIn15_150B = stock.float_market_cap >= 1.5e9 && stock.float_market_cap <= 15e9;
                const priceIn5_50 = stock.price >= 5.0 && stock.price <= 50.0;
                const isPass = !isST && capIn15_150B && priceIn5_50;

                return (
                  <tr key={stock.code} className="hover:bg-slate-800/40 transition">
                    <td className="py-3 px-3 text-slate-500">#{idx + 1}</td>
                    <td className="py-3 px-3">
                      <div className="font-bold text-slate-100 font-sans">{stock.name}</div>
                      <div className="text-[11px] text-slate-400">{stock.code}</div>
                    </td>
                    <td className="py-3 px-3 text-slate-300 font-sans">
                      <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-[11px]">
                        {stock.sector}
                      </span>
                    </td>
                    <td className="py-3 px-3 font-bold text-red-400">
                      ¥{stock.price?.toFixed(2) ?? "--"}
                    </td>
                    <td className="py-3 px-3">
                      <span className="px-2 py-0.5 rounded bg-red-950/60 text-red-400 border border-red-800/40 font-bold">
                        {stock.consecutive_boards ?? "--"} 连板
                      </span>
                    </td>
                    <td className="py-3 px-3 text-amber-300">
                      {stock.first_seal_time ?? "--"}
                    </td>
                    <td className="py-3 px-3 text-slate-200">
                      {stock.seal_ratio != null ? `${(stock.seal_ratio * 100).toFixed(1)}%` : "--"}
                    </td>
                    <td className="py-3 px-3 text-slate-300">
                      {stock.turnover_rate != null ? `${stock.turnover_rate.toFixed(2)}%` : "--"}
                    </td>
                    <td className="py-3 px-3 text-slate-300">
                      {stock.float_market_cap != null ? `${(stock.float_market_cap / 1e8).toFixed(2)} 亿` : "--"}
                    </td>
                    <td className="py-3 px-3 text-slate-400">
                      {stock.broken_count} 次
                    </td>
                    <td className="py-3 px-3">
                      {isPass ? (
                        <span className="inline-flex items-center gap-1 text-emerald-400 text-[11px] font-sans">
                          <Check className="w-3.5 h-3.5" /> 合格
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-rose-400 text-[11px] font-sans">
                          <X className="w-3.5 h-3.5" /> 
                          {isST ? "ST排除" : (!capIn15_150B ? "市值不符" : "股价不符")}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3">
                      <span className="font-bold text-slate-100 text-sm">
                        {stock.quant_score ? stock.quant_score.toFixed(1) : "--"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
