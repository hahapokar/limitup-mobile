import React from "react";
import { 
  Activity, 
  ShieldAlert, 
  TrendingUp, 
  RefreshCw, 
  RotateCcw, 
  Cpu,
  Settings,
  Brain,
  Eye,
  Radio
} from "lucide-react";
import { MarketSessionInfo } from "../types";

interface HeaderProps {
  nav: number;
  totalAsset: number;
  tradeDate: string;
  sentimentScore: number;
  circuitBreaker: boolean;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onResetAccount: () => void;
  loadingAction: string | null;
  marketSession?: MarketSessionInfo | null;
}

export const Header: React.FC<HeaderProps> = ({
  nav,
  totalAsset,
  tradeDate,
  sentimentScore,
  circuitBreaker,
  activeTab,
  setActiveTab,
  onResetAccount,
  loadingAction,
  marketSession
}) => {
  const liveTabs = [
    { id: "portfolio", label: "模拟盘与实时盯盘", icon: Eye },
    { id: "limitup", label: "全量涨停池", icon: Activity },
  ];
  const evaluationTabs = [
    { id: "aug24review", label: "盘后选股", icon: Brain },
    { id: "candidates", label: "四大因子池", icon: TrendingUp },
    { id: "iteration", label: "自迭代", icon: RefreshCw },
  ];

  const isTrading = marketSession?.is_trading_active ?? false;
  const sessionName = marketSession?.session_name || "盘后休市 (显示最终收盘价)";
  const updateIntervalSec = marketSession?.update_interval_sec || 15;
  const todayDate = marketSession?.today_date || new Date().toISOString().slice(0, 10);
  const latestTradeDate = marketSession?.latest_trade_date || tradeDate || "—";
  const nextTradeDate = marketSession?.next_trade_date || "—";
  const bjTime = marketSession?.current_time_beijing || "";

  return (
    <header className="bg-slate-900 border-b border-slate-800 sticky top-0 z-40 shadow-lg">
      {/* Top Status Bar */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-red-600/20 border border-red-500/40 flex items-center justify-center text-red-400 font-bold text-lg shadow-inner">
            板
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-slate-100 tracking-tight">
                A股首板量化复盘与前瞻测试系统
              </h1>
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700 font-mono">
                实时自动更新
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5 flex-wrap">
              <span>北京时间: <span className="text-amber-300 font-mono font-semibold">{todayDate} {bjTime}</span></span>
              <span className="text-slate-600">|</span>
              <span>最新行情交易日: <span className="text-emerald-400 font-mono font-semibold">{latestTradeDate}</span></span>
              <span className="text-slate-600">|</span>
              <span>下个开盘日: <span className="text-blue-400 font-mono font-semibold">{nextTradeDate}</span></span>
              <span className="text-slate-600">|</span>
              <span className="flex items-center gap-1 font-mono text-slate-300">
                <Radio className={`w-3 h-3 ${isTrading ? "text-emerald-400 animate-pulse" : "text-slate-500"}`} />
                <span>{sessionName}</span>
                <span className={`text-[11px] px-1.5 py-0.2 rounded font-semibold ${isTrading ? "bg-emerald-950/80 text-emerald-300 border border-emerald-700" : "bg-slate-800 text-slate-400"}`}>
                  {isTrading ? `${updateIntervalSec}s 实时高频` : "休市收盘价"}
                </span>
              </span>
            </div>
          </div>
        </div>

        {/* Global Key Metrics Badges */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Circuit Breaker Status */}
          <div className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium border ${
            circuitBreaker 
              ? "bg-rose-950/60 border-rose-600 text-rose-300 animate-pulse" 
              : "bg-slate-800/80 border-slate-700 text-slate-300"
          }`}>
            {circuitBreaker ? (
              <>
                <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
                <span>情绪熔断 (锁定0仓位)</span>
              </>
            ) : (
              <>
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
                <span>情绪正常 ({sentimentScore}分)</span>
              </>
            )}
          </div>

          {/* Account NAV */}
          <div className="flex items-center gap-2 px-3 py-1 bg-slate-800/90 rounded-md border border-slate-700">
            <span className="text-xs text-slate-400">模拟盘净值:</span>
            <span className={`text-sm font-bold font-mono ${nav >= 1.0 ? "text-red-400" : "text-emerald-400"}`}>
              {nav.toFixed(4)}
            </span>
            <span className="text-xs text-slate-400 border-l border-slate-700 pl-2 font-mono">
              ¥{(totalAsset).toLocaleString("zh-CN", { maximumFractionDigits: 0 })}
            </span>
          </div>

          {/* Quick Action Buttons */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={onResetAccount}
              disabled={!!loadingAction}
              className="p-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition"
              title="重置模拟盘账户资金至 ¥100,000"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setActiveTab("settings")}
              className={`p-1.5 rounded-md border transition ${activeTab === "settings" ? "bg-indigo-600/20 border-indigo-500 text-indigo-300" : "bg-slate-800 border-slate-700 text-slate-300 hover:text-white"}`}
              title="设置与模型底层逻辑"
              aria-label="设置与模型底层逻辑"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <nav className="flex items-center gap-3 overflow-x-auto no-scrollbar py-2">
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[10px] uppercase tracking-widest text-emerald-400/80 px-1">实时更新</span>
            {liveTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${isActive ? "bg-slate-800 text-slate-100 border border-slate-700 shadow-sm" : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"}`}>
                  <Icon className={`w-4 h-4 ${isActive ? "text-emerald-400" : "text-slate-400"}`} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
          <span className="h-6 w-px bg-slate-700 shrink-0" />
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[10px] uppercase tracking-widest text-amber-400/80 px-1">盘后评估</span>
            {evaluationTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${isActive ? "bg-slate-800 text-slate-100 border border-slate-700 shadow-sm" : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"}`}>
                  <Icon className={`w-4 h-4 ${isActive ? "text-amber-400" : "text-slate-400"}`} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
          {activeTab === "settings" && (
            <span className="h-6 w-px bg-slate-700 shrink-0" />
          )}
        </nav>
      </div>
    </header>
  );
};
