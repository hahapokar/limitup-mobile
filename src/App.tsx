import { useEffect, useMemo, useState } from "react";
import type { CandidateStock, CandidatesPayload, SentimentData } from "./types";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
const STATIC_SNAPSHOT_MODE = import.meta.env.VITE_API_MODE === "static";

const getBeijingDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
const getBeijingTime = () => new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
}).format(new Date());

const formatPercent = (value: number | null | undefined, digits = 2) => {
  if (typeof value !== "number" || Number.isNaN(value)) return "--";
  return `${value.toFixed(digits)}%`;
};

const buildReason = (stock: CandidateStock) => {
  const reasonParts: string[] = [];
  if (stock.consecutive_boards) {
    reasonParts.push(`${stock.consecutive_boards}连板`);
  }
  if (stock.seal_ratio) {
    reasonParts.push(`封板比 ${(stock.seal_ratio * 100).toFixed(1)}%`);
  }
  if (stock.turnover_rate) {
    reasonParts.push(`换手 ${stock.turnover_rate.toFixed(1)}%`);
  }
  if (stock.factor_breakdown?.sector_resonance?.has_true_resonance) {
    reasonParts.push("板块共振");
  }
  if (stock.high_60d_breakout) {
    reasonParts.push("60日新高");
  }
  return reasonParts.join(" · ") || `${stock.sector} 强势标的`;
};

export default function App() {
  const [selectedDate, setSelectedDate] = useState(getBeijingDate());
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [currentTime, setCurrentTime] = useState(getBeijingTime());
  const [sentiment, setSentiment] = useState<SentimentData | null>(null);
  const [payload, setPayload] = useState<CandidatesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [calculation, setCalculation] = useState<{ status: string; trade_date?: string; candidate_count?: number; completed_at?: string; error?: string } | null>(null);
  const dateOptions = useMemo(() => Array.from(new Set([getBeijingDate(), ...availableDates])), [availableDates]);

  const fetchData = async (date: string, recalculate = false) => {
    setLoading(true);
    setError(null);
    setPayload(null);
    setSentiment(null);
    setCalculation(null);
    try {
      const q = `?date=${encodeURIComponent(date)}`;
      if (recalculate) {
        if (STATIC_SNAPSHOT_MODE) {
          setCalculation(null);
        } else {
          const refreshRes = await fetch(`${API_BASE_URL}/api/refresh${q}`, { method: "POST" });
          const refreshJson = await refreshRes.json().catch(() => null);
          if (!refreshRes.ok || refreshJson?.success === false) {
            throw new Error(refreshJson?.error || `云端刷新失败（HTTP ${refreshRes.status}）`);
          }
          setCalculation(refreshJson?.calculation ?? null);
        }
      }
      const [sentimentRes, candidatesRes] = STATIC_SNAPSHOT_MODE
        ? await Promise.all([
            fetch(`${API_BASE_URL}/snapshots/${date}/sentiment.json`),
            fetch(`${API_BASE_URL}/snapshots/${date}/candidates.json`),
          ])
        : await Promise.all([
            fetch(`${API_BASE_URL}/api/sentiment${q}`),
            fetch(`${API_BASE_URL}/api/candidates${q}`),
          ]);

      if (!sentimentRes.ok || !candidatesRes.ok) {
        throw new Error(`数据读取失败（HTTP ${sentimentRes.status}/${candidatesRes.status}）`);
      }

      const sentimentJson = await sentimentRes.json();
      const candidatesJson = await candidatesRes.json();

      setSentiment(STATIC_SNAPSHOT_MODE ? sentimentJson : sentimentJson?.data ?? null);
      setPayload(STATIC_SNAPSHOT_MODE ? candidatesJson : candidatesJson?.data ?? null);
      if (!recalculate) {
        if (STATIC_SNAPSHOT_MODE) {
          setCalculation({
            status: "PUBLISHED",
            trade_date: candidatesJson?.trade_date,
            candidate_count: candidatesJson?.candidates?.length ?? 0,
            completed_at: candidatesJson?.snapshot_generated_at,
          });
        } else {
          const healthRes = await fetch(`${API_BASE_URL}/api/health`);
          const healthJson = await healthRes.json().catch(() => null);
          setCalculation(healthJson?.data?.calculation ?? null);
        }
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "请求失败，请检查网络连接");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const today = getBeijingDate();
    if (STATIC_SNAPSHOT_MODE) {
      fetch(`${API_BASE_URL}/snapshots/index.json`)
        .then((response) => response.ok ? response.json() : Promise.reject(new Error("日期列表读取失败")))
        .then((index: { dates?: string[] }) => {
          const dates = Array.isArray(index.dates) ? index.dates : [];
          setAvailableDates(dates);
          const initialDate = dates.includes(today) ? today : dates[0] || today;
          setSelectedDate(initialDate);
          fetchData(initialDate);
        })
        .catch(() => fetchData(today));
    } else {
      fetchData(today);
    }
    const timer = window.setInterval(() => setCurrentTime(getBeijingTime()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const cards = useMemo(() => (payload?.candidates ?? []).slice(0, 8), [payload]);
  const tradeDate = payload?.trade_date || sentiment?.trade_date || "";

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-6 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-400">盘后选股</p>
            <h1 className="mt-2 text-2xl font-bold text-white">每日 Top 8 推荐看板</h1>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-300">
              <span>日期</span>
              <select
                value={selectedDate}
                onChange={(event) => {
                  const date = event.target.value;
                  setSelectedDate(date);
                  if (date) fetchData(date);
                }}
                className="rounded bg-slate-900 px-2 py-1 text-slate-100 outline-none"
              >
                {dateOptions.map((date) => <option key={date} value={date}>{date}{date === getBeijingDate() ? "（今天）" : ""}</option>)}
              </select>
            </label>
            <button
              onClick={() => fetchData(getBeijingDate(), true)}
              disabled={loading}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-500"
            >
              {loading ? "正在计算…" : "自动刷新数据"}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <section className="mb-6 grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <p className="text-xs uppercase tracking-wider text-slate-400">交易日</p>
            <p className="mt-3 text-2xl font-bold text-white">{selectedDate || getBeijingDate()}</p>
            <p className="mt-1 text-xs text-slate-300">当前北京时间 {getBeijingDate()} {currentTime}</p>
            <p className="mt-1 text-xs text-slate-500">每个交易日 15:30 生成当日盘后分析</p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <p className="text-xs uppercase tracking-wider text-slate-400">情绪状态</p>
            <p className="mt-3 text-2xl font-bold text-emerald-400">{sentiment?.sentiment_level || "--"}</p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
            <p className="text-xs uppercase tracking-wider text-slate-400">情绪得分</p>
            <p className="mt-3 text-2xl font-bold text-amber-400">{sentiment?.sentiment_score ?? "--"}</p>
          </div>
        </section>

        {(calculation?.status === "SUCCESS" || calculation?.status === "PUBLISHED") && (
          <p className="mb-4 rounded-lg border border-emerald-800 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-300">
            盘后分析快照：{calculation.trade_date || tradeDate}，生成 {calculation.candidate_count ?? payload?.candidates?.length ?? 0} 个候选。
          </p>
        )}
        {error && (
          <p className="mb-4 rounded-lg border border-rose-800 bg-rose-950/40 px-4 py-3 text-sm text-rose-300">
            {error}
          </p>
        )}

        {loading ? (
          <div className="flex min-h-[300px] items-center justify-center rounded-2xl border border-slate-800 bg-slate-900 text-slate-400">
            正在加载盘后候选结果…
          </div>
        ) : cards.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900 p-8 text-center text-slate-400">
            {selectedDate === getBeijingDate()
              ? "今日尚未生成盘后快照，请在15:30后点击“自动刷新数据”开始计算。"
              : `${selectedDate || "该日期"} 暂无盘后快照。`}
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {cards.map((stock, index) => (
              <article key={`${stock.code}-${stock.trade_date}`} className="rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-lg shadow-slate-950/10">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-red-500/15 text-xs font-bold text-red-300">
                        #{index + 1}
                      </span>
                      <p className="text-xs font-mono text-slate-400">{stock.code}</p>
                    </div>
                    <h2 className="mt-2 text-xl font-bold text-white">{stock.name}</h2>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-slate-400">量化分</p>
                    <p className="text-lg font-black text-red-400">{stock.quant_score?.toFixed(1) ?? "--"}</p>
                  </div>
                </div>

                <div className="mb-4 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">触发策略</p>
                  <p className="mt-2 text-sm text-slate-100">{buildReason(stock)}</p>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-slate-500">涨跌幅</p>
                    <p className={`mt-1 font-semibold ${stock.change_pct >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {formatPercent(stock.change_pct, 2)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-slate-500">量比</p>
                    <p className="mt-1 font-semibold text-sky-300">{stock.amount ? (stock.amount / 1000000).toFixed(1) + "M" : "--"}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-slate-500">封板率</p>
                    <p className="mt-1 font-semibold text-violet-300">{formatPercent((stock.seal_ratio ?? 0) * 100, 1)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-slate-500">换手率</p>
                    <p className="mt-1 font-semibold text-cyan-300">{formatPercent(stock.turnover_rate ?? 0, 1)}</p>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-slate-800 pt-3 text-xs text-slate-400">
                  <span>{stock.sector}</span>
                  <span>{stock.consecutive_boards}连板</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

