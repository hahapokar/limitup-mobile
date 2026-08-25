import React from "react";
import { SellAlertCardData } from "../types";
import { 
  AlertTriangle, 
  TrendingUp, 
  TrendingDown, 
  ShieldAlert, 
  Clock, 
  CheckCircle2, 
  X, 
  ArrowRight,
  Sparkles
} from "lucide-react";

interface SellAlertModalProps {
  alerts: SellAlertCardData[];
  onDismiss: (alertId: string) => void;
  onDismissAll: () => void;
}

export const SellAlertModal: React.FC<SellAlertModalProps> = ({
  alerts,
  onDismiss,
  onDismissAll,
}) => {
  if (!alerts || alerts.length === 0) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 max-w-md w-full space-y-3 pointer-events-auto">
      {alerts.slice(0, 3).map((alert) => {
        const isProfitable = alert.realized_pnl >= 0;
        
        let ruleBadge = {
          label: "移动止盈",
          bgColor: "bg-amber-950/80 text-amber-300 border-amber-600/60",
          icon: TrendingUp
        };

        if (alert.rule_type === "HARD_STOP") {
          ruleBadge = {
            label: "防洗盘硬止损",
            bgColor: "bg-rose-950/80 text-rose-300 border-rose-600/60",
            icon: ShieldAlert
          };
        } else if (alert.rule_type === "T2_FORCED") {
          ruleBadge = {
            label: "T+2 尾盘强平",
            bgColor: "bg-purple-950/80 text-purple-300 border-purple-600/60",
            icon: Clock
          };
        } else if (alert.rule_type === "MANUAL") {
          ruleBadge = {
            label: "手动平仓",
            bgColor: "bg-slate-800 text-slate-300 border-slate-600",
            icon: AlertTriangle
          };
        }

        const BadgeIcon = ruleBadge.icon;

        return (
          <div
            key={alert.alert_id}
            className={`rounded-xl border shadow-2xl p-4 bg-slate-900/95 backdrop-blur-md transition-all duration-300 transform animate-in slide-in-from-bottom-5 ${
              isProfitable 
                ? "border-red-500/50 shadow-red-950/40" 
                : "border-emerald-500/40 shadow-emerald-950/30"
            }`}
          >
            {/* Header */}
            <div className="flex items-center justify-between pb-2 mb-2.5 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold border ${ruleBadge.bgColor}`}>
                  <BadgeIcon className="w-3 h-3" />
                  {ruleBadge.label}
                </span>
                <span className="text-xs text-slate-400 font-mono">
                  {alert.time}
                </span>
              </div>
              <button
                onClick={() => onDismiss(alert.alert_id)}
                className="text-slate-400 hover:text-slate-200 p-1 rounded hover:bg-slate-800 transition"
                title="关闭通知"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Main Content */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-bold text-slate-100 flex items-center gap-1.5">
                    <span>{alert.name}</span>
                    <span className="text-xs text-slate-400 font-mono">({alert.code})</span>
                  </h4>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    已从盯盘池撤出 · 完成实盘模拟撮合结算
                  </p>
                </div>

                {/* Realized PnL Block */}
                <div className="text-right">
                  <div className={`text-base font-black font-mono ${isProfitable ? "text-red-400" : "text-emerald-400"}`}>
                    {isProfitable ? "+" : ""}¥{alert.realized_pnl.toFixed(2)}
                  </div>
                  <div className={`text-xs font-bold font-mono ${isProfitable ? "text-red-400" : "text-emerald-400"}`}>
                    {alert.realized_pnl_pct >= 0 ? "+" : ""}{alert.realized_pnl_pct.toFixed(2)}%
                  </div>
                </div>
              </div>

              {/* Execution Details Table */}
              <div className="grid grid-cols-3 gap-2 bg-slate-950/60 rounded-lg p-2 text-xs border border-slate-800/80 font-mono">
                <div>
                  <span className="text-[10px] text-slate-500 block">买入成本</span>
                  <span className="text-slate-300">¥{alert.entry_price.toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block">卖出成交价</span>
                  <span className="text-slate-200 font-bold">¥{alert.sell_price.toFixed(2)}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block">平仓数量</span>
                  <span className="text-slate-300">{alert.shares.toLocaleString()} 股</span>
                </div>
              </div>

              {/* Reason Explanation */}
              <div className="text-xs text-slate-300 bg-slate-800/40 rounded p-2 border border-slate-800 text-[11px] leading-relaxed">
                <span className="text-indigo-400 font-semibold">触发原因: </span>
                {alert.reason}
              </div>
            </div>

            {/* Action Bar */}
            <div className="mt-3 pt-2 border-t border-slate-800/60 flex items-center justify-between text-xs">
              <span className="text-[11px] text-slate-400 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                资金已实时返还可用现金
              </span>
              <button
                onClick={() => onDismiss(alert.alert_id)}
                className="px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-[11px] border border-slate-700 transition"
              >
                我知道了
              </button>
            </div>
          </div>
        );
      })}

      {alerts.length > 1 && (
        <div className="text-right">
          <button
            onClick={onDismissAll}
            className="text-xs text-slate-400 hover:text-slate-200 bg-slate-900/80 px-2.5 py-1 rounded border border-slate-800 transition"
          >
            一键清除所有卖出通知 ({alerts.length})
          </button>
        </div>
      )}
    </div>
  );
};
