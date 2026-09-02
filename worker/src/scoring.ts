export type Stock = {
  code: string;
  name: string;
  price: number;
  change_pct: number;
  amount: number;
  turnover_rate: number;
  float_market_cap: number;
  total_market_cap: number;
  seal_amount: number | null;
  seal_ratio: number | null;
  first_seal_time: string | null;
  last_seal_time: string | null;
  broken_count: number;
  consecutive_boards: number | null;
  sector: string | null;
  is_st: boolean;
  institution_ratio: number | null;
  high_60d_breakout: boolean;
  trade_date: string;
  data_source: string;
  quant_score?: number;
  rank?: number;
  factor_breakdown?: Record<string, unknown>;
};

const clamp = (value: number) => Math.max(0, Math.min(100, value));

export function percentile(values: Array<number | null>): number[] {
  const valid = values.map((value, index) => ({ value, index })).filter(({ value }) => value !== null);
  const result = values.map(() => 50);
  if (valid.length === 1) {
    result[valid[0].index] = 100;
    return result;
  }
  const sorted = [...valid].sort((a, b) => (a.value as number) - (b.value as number));
  let start = 0;
  while (start < sorted.length) {
    let end = start;
    while (end < sorted.length && sorted[end].value === sorted[start].value) end++;
    const score = sorted.length > 1 ? ((start + end - 1) / 2 / (sorted.length - 1)) * 100 : 100;
    for (let i = start; i < end; i++) result[sorted[i].index] = Math.round(score * 100) / 100;
    start = end;
  }
  return result;
}

function timeMinutes(value: string | null): number {
  if (!value) return 600;
  const match = value.match(/^(\d{2}):?(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : 600;
}

function sealTimeScore(value: string | null): number {
  const minutes = timeMinutes(value);
  if (minutes <= 585) return 100;
  if (minutes <= 630) return 80;
  if (minutes <= 840) return 50;
  return 20;
}

export function scoreTopEight(pool: Stock[], sentimentState = "震荡/分化期") {
  const stats = { total: pool.length, st_excluded: 0, cap_out_of_range: 0, price_out_of_range: 0, inst_ratio_high: 0, incomplete_data: 0, passed: 0 };
  const filtered = pool.filter((stock) => {
    if ([stock.price, stock.float_market_cap, stock.turnover_rate, stock.seal_ratio, stock.consecutive_boards, stock.sector].some((value) => value === null)) {
      stats.incomplete_data++;
      return false;
    }
    if (stock.is_st) { stats.st_excluded++; return false; }
    if (stock.float_market_cap < 1.5e9 || stock.float_market_cap > 15e9) { stats.cap_out_of_range++; return false; }
    if (stock.price < 5 || stock.price > 50) { stats.price_out_of_range++; return false; }
    if (stock.institution_ratio !== null && stock.institution_ratio > 0.15) { stats.inst_ratio_high++; return false; }
    return true;
  });
  stats.passed = filtered.length;

  const marketMax = Math.max(1, ...filtered.map((stock) => stock.consecutive_boards || 1));
  const sectorCounts = new Map<string, number>();
  const sectorHeight = new Map<string, number>();
  for (const stock of pool) {
    const sector = stock.sector || "";
    sectorCounts.set(sector, (sectorCounts.get(sector) || 0) + 1);
    sectorHeight.set(sector, (sectorHeight.get(sector) || 0) + (stock.consecutive_boards && stock.consecutive_boards >= 2 ? 1 : 0));
  }
  const sealPercentiles = percentile(filtered.map((stock) => stock.seal_ratio));
  const scored = filtered.map((stock, index) => {
    const boards = stock.consecutive_boards || 1;
    let boardScore = boards >= 5 ? 100 : boards >= 3 ? 85 : boards === 2 ? 70 : 45;
    const spatialLeader = boards >= marketMax && marketMax > 1;
    let sentimentAdjustment = 0;
    if (sentimentState === "退潮/弱势期" || sentimentState === "熔断状态") sentimentAdjustment = boards >= 3 && boards <= 4 ? -30 : boards <= 2 ? 10 : 0;
    else if (sentimentState === "主升/强势期" && spatialLeader) sentimentAdjustment = 18;
    else if (sentimentState === "震荡/分化期") sentimentAdjustment = spatialLeader ? 12 : boards === 2 ? 3 : 0;
    boardScore = clamp(boardScore + sentimentAdjustment);

    let sealScore = Math.min(100, sealPercentiles[index] * 0.6 + sealTimeScore(stock.first_seal_time) * 0.4);
    if ((stock.seal_ratio || 0) < 0.1 && boards < 4) sealScore = Math.max(0, sealScore - 30);

    const turnover = stock.turnover_rate;
    const turnoverScore = turnover >= 5 && turnover <= 18 ? 90 - Math.abs(turnover - 10) * 1.5 : turnover >= 3 && turnover < 5 ? 65 : turnover > 18 && turnover <= 28 ? 60 - (turnover - 18) * 2 : 30;
    const chipScore = Math.min(100, turnoverScore * 0.8 + (stock.high_60d_breakout ? 20 : 0));
    const brokenScore = stock.broken_count === 0 ? 100 : stock.broken_count === 1 ? 60 : stock.broken_count === 2 ? 30 : 10;
    const factorChip = chipScore * 0.6 + brokenScore * 0.4;

    const sector = stock.sector || "";
    const count = sectorCounts.get(sector) || 0;
    const heightCount = sectorHeight.get(sector) || 0;
    const sectorScore = count >= 7 ? 30 : count <= 2 ? (boards >= Math.max(2, marketMax - 1) ? 95 : 55) : heightCount > 0 && count - heightCount > 0 ? 88 : 58;
    const quantScore = boardScore * 0.35 + sealScore * 0.15 + factorChip * 0.3 + sectorScore * 0.2;
    return { ...stock, quant_score: Math.round(quantScore * 100) / 100, factor_breakdown: { consecutive_board_sentiment: { score: boardScore, weight: 0.35 }, seal_strength: { score: sealScore, weight: 0.15 }, chip_structure: { score: factorChip, weight: 0.3 }, sector_resonance: { score: sectorScore, weight: 0.2, has_true_resonance: heightCount > 0 && count - heightCount > 0 } } };
  });
  scored.sort((a, b) => (b.quant_score! - a.quant_score!) || (timeMinutes(a.first_seal_time) - timeMinutes(b.first_seal_time)) || ((b.seal_ratio || 0) - (a.seal_ratio || 0)));
  scored.forEach((stock, index) => { stock.rank = index + 1; });
  return { candidates: scored.slice(0, 8), all_scored_stocks: scored.slice(0, 20), filter_stats: stats, total_limit_up_count: pool.length, passed_filter_count: filtered.length };
}
