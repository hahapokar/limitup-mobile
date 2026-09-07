var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// server.ts
var import_express = __toESM(require("express"), 1);
var import_fs = __toESM(require("fs"), 1);
var import_path = __toESM(require("path"), 1);
var import_child_process = require("child_process");
var import_util = require("util");
var app = (0, import_express.default)();
var PORT = Number(process.env.PORT || 3008);
var DATA_DIR = import_path.default.join(process.cwd(), "quant_system", "data");
var execFileAsync = (0, import_util.promisify)(import_child_process.execFile);
app.use(import_express.default.json());
var allowedOrigins = new Set(
  (process.env.CORS_ORIGINS || "https://localhost,http://localhost:5173").split(",").map((origin) => origin.trim()).filter(Boolean)
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
function readJsonSafe(filename, fallback = null) {
  try {
    const filePath = import_path.default.join(DATA_DIR, filename);
    if (import_fs.default.existsSync(filePath)) {
      return JSON.parse(import_fs.default.readFileSync(filePath, "utf-8"));
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
    hour12: false
  }).formatToParts(/* @__PURE__ */ new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    minutes: Number(values.hour) * 60 + Number(values.minute)
  };
}
function availableCandidateDates() {
  try {
    return import_fs.default.readdirSync(DATA_DIR).map((filename) => filename.match(/^candidates_(\d{4}-\d{2}-\d{2})\.json$/)?.[1]).filter((date) => Boolean(date)).sort();
  } catch {
    return [];
  }
}
function resolveTradeDate(requestedDate) {
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
        session_name: "\u76D8\u540E\u9009\u80A1\u6A21\u5F0F",
        is_trading_active: false,
        selection_mode: minutes >= 15 * 60 + 30 ? "\u5F53\u65E5\u76D8\u540E Top 8" : "\u4E0A\u4E00\u4EA4\u6613\u65E5 Top 8"
      }
    }
  });
});
app.get("/api/sentiment", (req, res) => {
  const date = req.query.date || getBeijingNow().date;
  const data = readJsonSafe(`sentiment_${date}.json`);
  res.json({ success: true, data });
});
app.get("/api/candidates", (req, res) => {
  const date = req.query.date || getBeijingNow().date;
  const data = readJsonSafe(`candidates_${date}.json`);
  res.json({ success: true, data });
});
app.get("/api/health", (_req, res) => {
  res.json({
    success: true,
    data: {
      status: "READY",
      mode: "post_market_selection",
      latest_trade_date: resolveTradeDate()
    }
  });
});
app.post("/api/refresh", async (req, res) => {
  const requestedDate = typeof req.query.date === "string" ? req.query.date : "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : getBeijingNow().date;
  try {
    await execFileAsync("python3", ["app.py", "review", "--date", date], {
      cwd: process.cwd(),
      timeout: 18e4,
      maxBuffer: 1024 * 1024 * 4
    });
    const candidates = readJsonSafe(`candidates_${date}.json`);
    const sentiment = readJsonSafe(`sentiment_${date}.json`);
    if (!candidates || !sentiment) {
      res.status(502).json({ success: false, error: `\u672C\u5730\u540E\u7AEF\u672A\u751F\u6210 ${date} \u7684\u5B8C\u6574\u5FEB\u7167` });
      return;
    }
    res.json({
      success: true,
      data: candidates,
      calculation: {
        status: "SUCCESS",
        trade_date: date,
        candidate_count: Array.isArray(candidates.candidates) ? candidates.candidates.length : 0,
        completed_at: candidates.snapshot_generated_at
      }
    });
  } catch (error) {
    const detail = error?.stderr || error?.stdout || error?.message || "\u672C\u5730\u76D8\u540E\u8BA1\u7B97\u5931\u8D25";
    res.status(502).json({ success: false, error: String(detail).slice(-2e3) });
  }
});
app.get("/api/limitup-pool", (req, res) => {
  const date = resolveTradeDate(req.query.date);
  const data = date ? readJsonSafe(`limitup_${date}.json`, []) : [];
  res.json({ success: true, data });
});
var distDir = import_path.default.join(process.cwd(), "dist");
if (import_fs.default.existsSync(distDir)) {
  app.use(import_express.default.static(distDir));
  app.get("*", (_req, res) => {
    res.sendFile(import_path.default.join(distDir, "index.html"));
  });
}
app.listen(PORT, () => {
  console.log(`Post-market selection server running on http://localhost:${PORT}`);
});
//# sourceMappingURL=server.cjs.map
