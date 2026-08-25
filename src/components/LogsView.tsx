import React, { useState } from "react";
import { SystemLogEntry } from "../types";
import { Terminal, Search, Filter, RefreshCw, Trash2 } from "lucide-react";

interface LogsViewProps {
  logs: SystemLogEntry[];
  loading: boolean;
  onRefresh: () => void;
}

export const LogsView: React.FC<LogsViewProps> = ({ logs, loading, onRefresh }) => {
  const [filterLevel, setFilterLevel] = useState<string>("ALL");
  const [searchTerm, setSearchTerm] = useState<string>("");

  const filteredLogs = logs.filter((log) => {
    if (filterLevel !== "ALL" && log.level !== filterLevel) return false;
    if (searchTerm) {
      const match =
        log.message.toLowerCase().includes(searchTerm.toLowerCase()) ||
        log.category.toLowerCase().includes(searchTerm.toLowerCase());
      if (!match) return false;
    }
    return true;
  });

  return (
    <div className="space-y-4">
      {/* Control Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300">
            <Terminal className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-200">系统运行与量化审计日志</h3>
            <p className="text-xs text-slate-400">实时记录多源抓取、情绪择时、因子打分、模拟撮合等事件</p>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Level Filter */}
          <div className="flex items-center gap-1 bg-slate-800 p-1 rounded-lg border border-slate-700 text-xs">
            {["ALL", "INFO", "WARNING", "ERROR"].map((lvl) => (
              <button
                key={lvl}
                onClick={() => setFilterLevel(lvl)}
                className={`px-2.5 py-1 rounded font-semibold transition ${
                  filterLevel === lvl
                    ? "bg-red-600 text-white shadow-sm"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {lvl}
              </button>
            ))}
          </div>

          {/* Search Box */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
            <input
              type="text"
              placeholder="搜索日志关键词..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded-lg pl-8 pr-3 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none font-mono w-48"
            />
          </div>

          <button
            onClick={onRefresh}
            disabled={loading}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
            title="刷新日志"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin text-emerald-400" : ""}`} />
          </button>
        </div>
      </div>

      {/* Terminal View */}
      <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 font-mono text-xs shadow-inner h-[600px] overflow-y-auto no-scrollbar space-y-2">
        {filteredLogs.length === 0 ? (
          <div className="text-center py-24 text-slate-600">
            暂无匹配的系统日志。
          </div>
        ) : (
          filteredLogs.map((log, idx) => {
            const isError = log.level === "ERROR";
            const isWarn = log.level === "WARNING";
            return (
              <div
                key={idx}
                className="flex items-start gap-3 p-1.5 rounded hover:bg-slate-900/60 transition border-b border-slate-900/40"
              >
                <span className="text-slate-500 shrink-0 select-none">
                  [{log.timestamp}]
                </span>

                <span
                  className={`px-1.5 py-0.2 rounded text-[10px] font-bold shrink-0 ${
                    isError
                      ? "bg-rose-950 text-rose-400 border border-rose-800"
                      : isWarn
                      ? "bg-amber-950 text-amber-400 border border-amber-800"
                      : "bg-slate-800 text-slate-400 border border-slate-700"
                  }`}
                >
                  {log.level}
                </span>

                <span className="text-purple-400 shrink-0 font-semibold">
                  [{log.category}]
                </span>

                <span className={`flex-1 break-all ${isError ? "text-rose-300 font-semibold" : (isWarn ? "text-amber-200" : "text-slate-300")}`}>
                  {log.message}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
