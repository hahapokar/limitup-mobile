import express from "express";
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const app = express();
const PORT = Number(process.env.PORT || 3008);
const DATA_DIR = path.join(process.cwd(), "quant_system", "data");
const execFileAsync = promisify(execFile);

app.use(express.json());

const allowedOrigins = new Set(
  (process.env.CORS_ORIGINS || "https://localhost,http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

function readJsonSafe(filename: string, fallback: any = null) {
  try {
    const filePath = path.join(DATA_DIR, filename);
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
  } catch (err) {
    console.warn(`readJsonSafe failed for ${filename}:`, err);
  }
  return fallback;
}

function getBeijingNow() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    minutes: Number(values.hour) * 60 + Number(values.minute),
  };
}

function availableCandidateDates(): string[] {
  try {
    return fs.readdirSync(DATA_DIR)
      .map((filename) => filename.match(/^candidates_(\d{4}-\d{2}-\d{2})\.json$/)?.[1])
      .filter((date): date is string => Boolean(date))
      .sort();
  } catch {
    return [];
  }
}

function resolveTradeDate(requestedDate?: string): string {
  if (requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) return requestedDate;

  const { date: today, minutes } = getBeijingNow();
  const dates = availableCandidateDates();
  const currentSnapshotReady = minutes >= 15 * 60 + 30 && dates.includes(today);
  const eligibleDates = dates.filter((candidateDate) => candidateDate <= today);

  if (currentSnapshotReady) return today;
  return eligibleDates.at(-1) || dates.at(-1) || readJsonSafe("latest_candidates.json", {})?.trade_date || "";
}

app.get("/api/status", (_req, res) => {
  const tradeDate = resolveTradeDate();
  const sentiment = readJsonSafe(`sentiment_${tradeDate}.json`, readJsonSafe("latest_sentiment.json", {}));
  const candidates = readJsonSafe(`candidates_${tradeDate}.json`, readJsonSafe("latest_candidates.json", {}));
  const { minutes } = getBeijingNow();
  const currentTime = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

  res.json({
    success: true,
    data: {
      trade_date: tradeDate,
      sentiment_score: sentiment?.sentiment_score ?? null,
      sentiment_level: sentiment?.sentiment_level ?? "",
      circuit_breaker: Boolean(sentiment?.sentiment_circuit_breaker),
      candidates_count: Array.isArray(candidates?.candidates) ? candidates.candidates.length : 0,
      market_session: {
        today_date: tradeDate,
        latest_trade_date: tradeDate,
        current_time_beijing: currentTime,
        session_phase: minutes >= 15 * 60 + 30 ? "POST_REVIEW" : "PRE_REVIEW",
        session_name: "盘后选股模式",
        is_trading_active: false,
        selection_mode: minutes >= 15 * 60 + 30 ? "当日盘后 Top 8" : "上一交易日 Top 8",
      },
    },
  });
});

app.get("/api/sentiment", (req, res) => {
  const date = (req.query.date as string) || getBeijingNow().date;
  const data = readJsonSafe(`sentiment_${date}.json`);
  res.json({ success: true, data });
});

app.get("/api/candidates", (req, res) => {
  const date = (req.query.date as string) || getBeijingNow().date;
  const data = readJsonSafe(`candidates_${date}.json`);
  res.json({ success: true, data });
});

app.get("/api/health", (_req, res) => {
  res.json({
    success: true,
    data: {
      status: "READY",
      mode: "post_market_selection",
      latest_trade_date: resolveTradeDate(),
    },
  });
});

app.post("/api/refresh", async (req, res) => {
  const requestedDate = typeof req.query.date === "string" ? req.query.date : "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : getBeijingNow().date;
  try {
    await execFileAsync("python3", ["app.py", "review", "--date", date], {
      cwd: process.cwd(),
      timeout: 180000,
      maxBuffer: 1024 * 1024 * 4,
    });
    const candidates = readJsonSafe(`candidates_${date}.json`);
    const sentiment = readJsonSafe(`sentiment_${date}.json`);
    if (!candidates || !sentiment) {
      res.status(502).json({ success: false, error: `本地后端未生成 ${date} 的完整快照` });
      return;
    }
    res.json({
      success: true,
      data: candidates,
      calculation: {
        status: "SUCCESS",
        trade_date: date,
        candidate_count: Array.isArray(candidates.candidates) ? candidates.candidates.length : 0,
        completed_at: candidates.snapshot_generated_at,
      },
    });
  } catch (error: any) {
    const detail = error?.stderr || error?.stdout || error?.message || "本地盘后计算失败";
    res.status(502).json({ success: false, error: String(detail).slice(-2000) });
  }
});

app.get("/api/limitup-pool", (req, res) => {
  const date = resolveTradeDate(req.query.date as string);
  const data = date ? readJsonSafe(`limitup_${date}.json`, []) : [];
  res.json({ success: true, data });
});

const distDir = path.join(process.cwd(), "dist");
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`Post-market selection server running on http://localhost:${PORT}`);
});
