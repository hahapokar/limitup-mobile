import { scoreTopEight, type Stock } from "./scoring";

type Env = {
  SNAPSHOTS: KVNamespace;
};

const EASTMONEY_BASE = "https://push2ex.eastmoney.com";
const EASTMONEY_QUERY = "ut=7eea3ed07936ac3c4c830215651a3819&dpt=wz.ztzt&Pageindex=0&pagesize=150&sort=fbt%3Aasc";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" },
  });
}

function beijingNow() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return { date: `${values.year}-${values.month}-${values.day}`, minutes: Number(values.hour) * 60 + Number(values.minute) };
}

function number(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sealTime(value: unknown): string | null {
  const raw = String(value ?? "").padStart(6, "0");
  return /^\d{6}$/.test(raw) ? `${raw.slice(0, 2)}:${raw.slice(2, 4)}:${raw.slice(4, 6)}` : null;
}

function normalizeStock(raw: Record<string, unknown>, tradeDate: string): Stock {
  const amount = number(raw.amount);
  const sealAmount = number(raw.fund, 0) || null;
  return {
    code: String(raw.c ?? "").replace(/\D/g, "").padStart(6, "0").slice(-6),
    name: String(raw.n ?? "").trim(),
    price: Math.round(number(raw.p) / 1000 * 100) / 100,
    change_pct: number(raw.zdp),
    amount,
    turnover_rate: number(raw.hs),
    float_market_cap: number(raw.ltsz),
    total_market_cap: number(raw.totsz),
    seal_amount: sealAmount,
    seal_ratio: sealAmount && amount > 0 ? Math.round(sealAmount / amount * 10000) / 10000 : null,
    first_seal_time: sealTime(raw.fbt),
    last_seal_time: sealTime(raw.lbt),
    broken_count: number(raw.zbc),
    consecutive_boards: number(raw.lbc) || null,
    sector: String(raw.hybk ?? "").trim() || null,
    is_st: /ST/i.test(String(raw.n ?? "")),
    institution_ratio: null,
    high_60d_breakout: false,
    trade_date: tradeDate,
    data_source: "eastmoney-worker",
  };
}

async function fetchPool(tradeDate: string, broken = false): Promise<Stock[]> {
  const endpoint = broken ? "getTopicZTBoomPool" : "getTopicZTPool";
  const url = `${EASTMONEY_BASE}/${endpoint}?${EASTMONEY_QUERY}&date=${tradeDate.replaceAll("-", "")}`;
  const response = await fetch(url, { headers: { "user-agent": "limitupnewapp-worker" } });
  if (!response.ok) throw new Error(`EastMoney returned ${response.status}`);
  const payload = await response.json() as { data?: { pool?: Record<string, unknown>[] } };
  return (payload.data?.pool || []).map((item) => normalizeStock(item, tradeDate)).filter((stock) => stock.code !== "000000");
}

function sentimentSnapshot(tradeDate: string, pool: Stock[], brokenPool: Stock[]) {
  const maxBoards = Math.max(1, ...pool.map((stock) => stock.consecutive_boards || 1));
  const brokenRate = pool.length + brokenPool.length > 0 ? brokenPool.length / (pool.length + brokenPool.length) * 100 : null;
  const boardScore = maxBoards >= 6 ? 100 : maxBoards === 5 ? 90 : maxBoards === 4 ? 80 : maxBoards === 3 ? 65 : maxBoards === 2 ? 50 : 30;
  const brokenScore = brokenRate === null ? 50 : brokenRate <= 12 ? 100 : brokenRate <= 20 ? 85 : brokenRate <= 30 ? 65 : brokenRate <= 40 ? 40 : brokenRate <= 55 ? 20 : 5;
  const score = Math.round((50 * 0.35 + 50 * 0.25 + ((boardScore + brokenScore) / 2) * 0.25 + 50 * 0.15) * 100) / 100;
  const state = score < 30 ? "熔断状态" : score < 45 ? "退潮/弱势期" : score > 70 ? "主升/强势期" : "震荡/分化期";
  return {
    trade_date: tradeDate, snapshot_status: "FINAL", sentiment_score: score,
    sentiment_state: state, sentiment_level: score >= 60 ? "偏暖积极" : score >= 40 ? "震荡分化" : "冰点低迷",
    sentiment_circuit_breaker: score < 30, target_position_ratio: score < 30 ? 0 : score < 45 ? 0.35 : score > 70 ? 1 : 0.65,
    components: {
      yesterday_zt_premium: { raw_value: null, score: 50, weight: 0.35 },
      market_limit_down: { raw_value: null, score: 50, weight: 0.25 },
      max_consecutive_boards: { raw_value: maxBoards, broken_rate_pct: brokenRate, score: (boardScore + brokenScore) / 2, weight: 0.25 },
      advance_decline_ratio: { raw_value: null, score: 50, weight: 0.15 },
    },
    market_summary: { limit_up_count: pool.length, broken_up_count: brokenPool.length, limit_down_count: null, up_count: null, down_count: null, activity_pct: null },
    data_quality: "partial_market_overview",
  };
}

async function listSnapshotDates(env: Env): Promise<string[]> {
  const listed = await env.SNAPSHOTS.list({ prefix: "candidates:" });
  return listed.keys.map((key) => key.name.slice("candidates:".length)).sort();
}

async function resolveDate(env: Env, requested?: string): Promise<string> {
  if (requested && /^\d{4}-\d{2}-\d{2}$/.test(requested)) return requested;
  const { date: today, minutes } = beijingNow();
  const dates = await listSnapshotDates(env);
  if (minutes >= 930 && dates.includes(today)) return today;
  return dates.filter((date) => date <= today).at(-1) || dates.at(-1) || "";
}

async function generateSnapshot(env: Env, tradeDate: string) {
  const [pool, brokenPool] = await Promise.all([fetchPool(tradeDate), fetchPool(tradeDate, true)]);
  const sentiment = sentimentSnapshot(tradeDate, pool, brokenPool);
  const result = scoreTopEight(pool, sentiment.sentiment_state);
  const candidates = { trade_date: tradeDate, snapshot_status: "FINAL", snapshot_generated_at: new Date().toISOString(), sentiment_state: sentiment.sentiment_state, ...result };
  await Promise.all([
    env.SNAPSHOTS.put(`candidates:${tradeDate}`, JSON.stringify(candidates)),
    env.SNAPSHOTS.put(`sentiment:${tradeDate}`, JSON.stringify(sentiment)),
    env.SNAPSHOTS.put("latest:candidates", JSON.stringify(candidates)),
    env.SNAPSHOTS.put("latest:sentiment", JSON.stringify(sentiment)),
  ]);
  return candidates;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,OPTIONS" } });
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/health") return json({ success: true, data: { status: "READY", mode: "cloudflare_worker", latest_trade_date: await resolveDate(env) } });
      if (url.pathname === "/api/candidates") {
        const date = await resolveDate(env, url.searchParams.get("date") || undefined);
        const value = await env.SNAPSHOTS.get(`candidates:${date}`, "json");
        return json({ success: true, data: value || await env.SNAPSHOTS.get("latest:candidates", "json") });
      }
      if (url.pathname === "/api/sentiment") {
        const date = await resolveDate(env, url.searchParams.get("date") || undefined);
        const value = await env.SNAPSHOTS.get(`sentiment:${date}`, "json");
        return json({ success: true, data: value || await env.SNAPSHOTS.get("latest:sentiment", "json") });
      }
      return json({ success: false, error: "Not found" }, 404);
    } catch (error) {
      return json({ success: false, error: error instanceof Error ? error.message : "Worker error" }, 502);
    }
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const { date } = beijingNow();
    await generateSnapshot(env, date);
  },
};
