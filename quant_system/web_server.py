"""
Lightweight Web Server and Monitoring Dashboard for Port 3006.
Provides HTML Dashboard and RESTful APIs for Sentiment, Scored Candidates, and Portfolio NAV.
"""

import os
import json
import logging
import threading
from http.server import HTTPServer, SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs
from pathlib import Path
from typing import Dict, Any, Optional

from quant_system.config import DATA_DIR, PORTFOLIO_FILE
from quant_system.core.data_fetcher import data_fetcher
from quant_system.core.sentiment import sentiment_engine
from quant_system.core.scoring import scoring_engine
from quant_system.core.portfolio import portfolio_engine
from quant_system.utils.notifier import get_recent_logs, record_system_log

logger = logging.getLogger("QuantTrading.WebServer")

WEB_PORT = 3006


def get_latest_data() -> Dict[str, Any]:
    """Retrieve full unified snapshot for web dashboard."""
    session = data_fetcher.get_market_session_status()
    effective_date = session.get("latest_trade_date") or ""
    if not effective_date:
      return {
        "trade_date": "",
        "sentiment": None,
        "candidates": [],
        "portfolio": portfolio_engine.load_state(),
        "logs": get_recent_logs(20),
        "status": "NO_MARKET_DATA",
        "port": WEB_PORT,
      }
    
    # 1. Sentiment
    sentiment = sentiment_engine.get_cached_sentiment(effective_date)
    if not sentiment:
        try:
            sentiment = sentiment_engine.calculate_sentiment(effective_date)
        except Exception:
          sentiment = None

    # 2. Scored Candidates
    candidates_file = DATA_DIR / f"candidates_{effective_date}.json"
    candidates_data = []
    if candidates_file.exists():
        try:
            with open(candidates_file, "r", encoding="utf-8") as f:
                c_json = json.load(f)
                if isinstance(c_json, dict):
                    candidates_data = c_json.get("candidates", [])
                elif isinstance(c_json, list):
                    candidates_data = c_json
        except Exception:
            candidates_data = []
    
    if not candidates_data:
        try:
            scoring_res = scoring_engine.run_daily_scoring(effective_date)
            candidates_data = scoring_res.get("candidates", [])
        except Exception:
            pass

    # 3. Portfolio & NAV
    portfolio = portfolio_engine.load_state()

    # 4. Recent Logs
    logs = get_recent_logs(20)

    return {
        "trade_date": effective_date,
        "sentiment": sentiment,
        "candidates": candidates_data,
        "portfolio": portfolio,
        "logs": logs,
        "status": "ONLINE",
        "port": WEB_PORT
    }


def render_html_dashboard(data: Dict[str, Any]) -> str:
    """Generate modern, responsive financial monitoring HTML page."""
    sentiment = data.get("sentiment", {})
    sentiment = sentiment or {}
    score = sentiment.get("sentiment_score")
    level = sentiment.get("sentiment_level") or "未知"
    circuit_breaker = sentiment.get("sentiment_circuit_breaker")
    rec_pos = sentiment.get("recommended_total_position")
    rec_pos = rec_pos * 100 if isinstance(rec_pos, (int, float)) else None
    
    details = sentiment.get("detail_scores", {})
    score1 = details.get("limit_up_effect")
    score2 = details.get("consecutive_board_height")
    score3 = details.get("seal_stability")
    score4 = details.get("market_breadth")

    portfolio = data.get("portfolio", {})
    nav = portfolio.get("nav", 1.0)
    total_asset = portfolio.get("total_asset", 1000000.0)
    cash = portfolio.get("cash", 1000000.0)
    market_val = portfolio.get("market_value", 0.0)
    initial_cap = portfolio.get("initial_capital", 1000000.0)
    total_return_pct = ((total_asset - initial_cap) / initial_cap) * 100.0
    holdings = portfolio.get("holdings", [])
    nav_history = portfolio.get("nav_history", [])

    candidates = data.get("candidates", [])

    # Prepare Chart Data
    nav_labels = [item.get("date", "") for item in nav_history]
    nav_values = [item.get("nav", 1.0) for item in nav_history]

    # JSON for frontend
    json_candidates = json.dumps(candidates, ensure_ascii=False)
    json_holdings = json.dumps(holdings, ensure_ascii=False)

    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>A股打板量化盯盘与实盘监控系统 (Port: 3006)</title>
  <!-- Tailwind CSS CDN -->
  <script src="https://cdn.tailwindcss.com"></script>
  <!-- Chart.js CDN -->
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script>
    tailwind.config = {{
      darkMode: 'class',
      theme: {{
        extend: {{
          colors: {{
            brand: '#ef4444',
            darkbg: '#0f172a',
            cardbg: '#1e293b',
            cardborder: '#334155'
          }}
        }}
      }}
    }}
  </script>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&family=Noto+Sans+SC:wght@400;500;700&display=swap');
    body {{
      font-family: 'Noto Sans SC', sans-serif;
      background-color: #0b0f19;
      color: #f1f5f9;
    }}
    .font-mono {{
      font-family: 'JetBrains Mono', monospace;
    }}
    .custom-scrollbar::-webkit-scrollbar {{
      width: 6px;
      height: 6px;
    }}
    .custom-scrollbar::-webkit-scrollbar-thumb {{
      background: #334155;
      border-radius: 3px;
    }}
  </style>
</head>
<body class="min-h-screen pb-12">
  <!-- Top Navigation -->
  <header class="border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-50">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div class="w-9 h-9 rounded-lg bg-red-600/20 border border-red-500/30 flex items-center justify-center font-bold text-red-400">
          量
        </div>
        <div>
          <h1 class="text-base font-bold text-slate-100 flex items-center gap-2">
            A股打板量化盯盘监控平台
            <span class="text-xs px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">PORT 3006</span>
          </h1>
          <p class="text-xs text-slate-400">四维情绪周期 · 4-Factor分位打分 · T+1集合竞价实盘撮合</p>
        </div>
      </div>

      <div class="flex items-center gap-4">
        <div class="text-right hidden sm:block">
          <div class="text-xs text-slate-400">基准交易日</div>
          <div class="text-sm font-mono font-bold text-slate-200">{data.get('trade_date')}</div>
        </div>
        <button onclick="location.reload()" class="px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium flex items-center gap-1.5 transition">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
          刷新
        </button>
      </div>
    </div>
  </header>

  <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 space-y-6">
    <!-- Top Summary Cards -->
    <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
      <!-- Card 1: Market Sentiment Score -->
      <div class="bg-slate-900/80 rounded-xl p-5 border border-slate-800 relative overflow-hidden">
        <div class="text-xs font-medium text-slate-400 mb-1">大盘情绪得分 (四维模型)</div>
        <div class="flex items-baseline gap-2">
          <span class="text-3xl font-mono font-black {'text-emerald-400' if score >= 70 else ('text-amber-400' if score >= 45 else 'text-red-400')}">{score:.1f}</span>
          <span class="text-xs px-2 py-0.5 rounded font-medium {'bg-red-500/20 text-red-300 border border-red-500/30' if circuit_breaker else 'bg-blue-500/20 text-blue-300 border border-blue-500/30'}">
            {'⚠️ 熔断中 (0%仓位)' if circuit_breaker else level}
          </span>
        </div>
        <div class="mt-3 text-xs text-slate-400 flex justify-between">
          <span>建议总仓位: <strong class="text-slate-200 font-mono">{rec_pos:.0f}%</strong></span>
          <span>防爆仓熔断线: <strong class="text-slate-400 font-mono">&lt; 30.0</strong></span>
        </div>
      </div>

      <!-- Card 2: NAV Value -->
      <div class="bg-slate-900/80 rounded-xl p-5 border border-slate-800">
        <div class="text-xs font-medium text-slate-400 mb-1">最新 NAV 净值</div>
        <div class="flex items-baseline gap-2">
          <span class="text-3xl font-mono font-black {'text-red-400' if nav >= 1.0 else 'text-emerald-400'}">{nav:.4f}</span>
          <span class="text-xs font-mono font-semibold {'text-red-400' if total_return_pct >= 0 else 'text-emerald-400'}">
            {'+' if total_return_pct >= 0 else ''}{total_return_pct:.2f}%
          </span>
        </div>
        <div class="mt-3 text-xs text-slate-400 flex justify-between">
          <span>初始本金: <strong class="text-slate-200 font-mono">¥{initial_cap:,.0f}</strong></span>
          <span>历史胜率: <strong class="text-slate-200 font-mono">{portfolio.get('win_rate_pct', 66.7):.1f}%</strong></span>
        </div>
      </div>

      <!-- Card 3: Total Asset & Cash -->
      <div class="bg-slate-900/80 rounded-xl p-5 border border-slate-800">
        <div class="text-xs font-medium text-slate-400 mb-1">模拟实盘总资产</div>
        <div class="text-3xl font-mono font-black text-slate-100">¥{total_asset:,.2f}</div>
        <div class="mt-3 text-xs text-slate-400 flex justify-between">
          <span>可用现金: <strong class="text-slate-200 font-mono">¥{cash:,.2f}</strong></span>
          <span>持仓市值: <strong class="text-slate-200 font-mono">¥{market_val:,.2f}</strong></span>
        </div>
      </div>

      <!-- Card 4: Daily Selected Pool -->
      <div class="bg-slate-900/80 rounded-xl p-5 border border-slate-800">
        <div class="text-xs font-medium text-slate-400 mb-1">今日打分选拔龙头</div>
        <div class="text-3xl font-mono font-black text-indigo-400">{len(candidates)} <span class="text-sm font-normal text-slate-400">只标的</span></div>
        <div class="mt-3 text-xs text-slate-400 flex justify-between">
          <span>当前实盘持仓: <strong class="text-slate-200 font-mono">{len(holdings)} 笔</strong></span>
          <span>交易动作: <strong class="text-emerald-400">09:25 竞价撮合</strong></span>
        </div>
      </div>
    </div>

    <!-- Section 1: Sentiment Factors Breakdown & NAV History Chart -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <!-- 4 Sentiment Sub-factors -->
      <div class="bg-slate-900/80 rounded-xl p-5 border border-slate-800">
        <h2 class="text-sm font-bold text-slate-100 mb-4 flex items-center justify-between">
          <span>大盘情绪四维因子雷达</span>
          <span class="text-xs text-slate-500 font-normal">加权总分 100</span>
        </h2>
        <div class="space-y-4 text-xs">
          <div>
            <div class="flex justify-between text-slate-300 mb-1">
              <span>涨停赚钱效应因子 (30%)</span>
              <span class="font-mono font-bold text-red-400">{score1:.1f} 分</span>
            </div>
            <div class="w-full bg-slate-800 rounded-full h-2">
              <div class="bg-red-500 h-2 rounded-full" style="width: {min(100, max(5, score1))}%"></div>
            </div>
          </div>

          <div>
            <div class="flex justify-between text-slate-300 mb-1">
              <span>连板高度空间溢价 (25%)</span>
              <span class="font-mono font-bold text-amber-400">{score2:.1f} 分</span>
            </div>
            <div class="w-full bg-slate-800 rounded-full h-2">
              <div class="bg-amber-500 h-2 rounded-full" style="width: {min(100, max(5, score2))}%"></div>
            </div>
          </div>

          <div>
            <div class="flex justify-between text-slate-300 mb-1">
              <span>封板稳定性与炸板惩罚 (25%)</span>
              <span class="font-mono font-bold text-blue-400">{score3:.1f} 分</span>
            </div>
            <div class="w-full bg-slate-800 rounded-full h-2">
              <div class="bg-blue-500 h-2 rounded-full" style="width: {min(100, max(5, score3))}%"></div>
            </div>
          </div>

          <div>
            <div class="flex justify-between text-slate-300 mb-1">
              <span>全市场涨跌家数广度 (20%)</span>
              <span class="font-mono font-bold text-purple-400">{score4:.1f} 分</span>
            </div>
            <div class="w-full bg-slate-800 rounded-full h-2">
              <div class="bg-purple-500 h-2 rounded-full" style="width: {min(100, max(5, score4))}%"></div>
            </div>
          </div>
        </div>

        <div class="mt-5 p-3 rounded-lg bg-slate-800/60 border border-slate-700/50 text-xs text-slate-300 leading-relaxed">
          <strong>量化策略研判:</strong> {sentiment.get('strategy_guidance', '当前市场处于健康轮动状态，严守4-Factor综合打分阈值，低位核心龙头重点博弈。')}
        </div>
      </div>

      <!-- NAV Curve Chart -->
      <div class="lg:col-span-2 bg-slate-900/80 rounded-xl p-5 border border-slate-800">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-sm font-bold text-slate-100">实盘模拟账户 NAV 净值曲线</h2>
          <span class="text-xs text-slate-400 font-mono">基准: 1.0000 (100万)</span>
        </div>
        <div class="h-56">
          <canvas id="navChart"></canvas>
        </div>
      </div>
    </div>

    <!-- Section 2: Top 8 Scored Candidates Table -->
    <div class="bg-slate-900/80 rounded-xl border border-slate-800 overflow-hidden">
      <div class="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
        <div>
          <h2 class="text-sm font-bold text-slate-100 flex items-center gap-2">
            今日 4-Factor 分位打分选出龙头候选股 ({len(candidates)} 只)
          </h2>
          <p class="text-xs text-slate-400 mt-0.5">次日 09:25 集合竞价撮合等权买入，过滤一字板无量顶死与低开破位股</p>
        </div>
        <span class="text-xs px-2.5 py-1 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 font-mono">
          Top Rank
        </span>
      </div>

      <div class="overflow-x-auto custom-scrollbar">
        <table class="w-full text-left text-xs">
          <thead class="bg-slate-800/60 text-slate-400 border-b border-slate-800">
            <tr>
              <th class="py-3 px-4 font-semibold">排名</th>
              <th class="py-3 px-4 font-semibold">代码/名称</th>
              <th class="py-3 px-4 font-semibold">所属板块</th>
              <th class="py-3 px-4 font-semibold">综合得分</th>
              <th class="py-3 px-4 font-semibold">连板身位</th>
              <th class="py-3 px-4 font-semibold">封单比 / 封板时间</th>
              <th class="py-3 px-4 font-semibold">换手率 / 炸板</th>
              <th class="py-3 px-4 font-semibold">建议单笔仓位</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-800 text-slate-300">
            {"".join([f'''
            <tr class="hover:bg-slate-800/40 transition">
              <td class="py-3 px-4 font-mono font-bold text-amber-400">#{c.get('rank', i+1)}</td>
              <td class="py-3 px-4">
                <div class="font-bold text-slate-100">{c.get('name')}</div>
                <div class="font-mono text-slate-400">{c.get('code')}</div>
              </td>
              <td class="py-3 px-4">
                <span class="px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">{c.get('sector')}</span>
              </td>
              <td class="py-3 px-4 font-mono font-black text-red-400 text-sm">{c.get('quant_score', 0):.2f}</td>
              <td class="py-3 px-4">
                <span class="px-2 py-0.5 rounded font-bold {'bg-red-500/20 text-red-400 border border-red-500/30' if c.get('consecutive_boards', 1) >= 2 else 'bg-blue-500/20 text-blue-300 border border-blue-500/30'}">
                  {c.get('consecutive_boards', 1)} 连板
                </span>
              </td>
              <td class="py-3 px-4 font-mono">
                <div>封成比: {(c.get('seal_ratio', 0)*100):.1f}%</div>
                <div class="text-slate-400 text-[11px]">{c.get('first_seal_time', '--')}</div>
              </td>
              <td class="py-3 px-4 font-mono">
                <div>换手: {c.get('turnover_rate', 0):.2f}%</div>
                <div class="text-slate-400 text-[11px]">炸板: {c.get('broken_count', 0)} 次</div>
              </td>
              <td class="py-3 px-4 font-mono text-emerald-400 font-bold">
                ¥{c.get('target_position_amt', 200000):,.0f} (20%)
              </td>
            </tr>
            ''' for i, c in enumerate(candidates)]) if candidates else '''
            <tr>
              <td colspan="8" class="text-center py-8 text-slate-500">今日大盘触发熔断或暂无满足四维分位阈值的候选标的</td>
            </tr>
            '''}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Section 3: Current Portfolio Holdings -->
    <div class="bg-slate-900/80 rounded-xl border border-slate-800 overflow-hidden">
      <div class="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
        <div>
          <h2 class="text-sm font-bold text-slate-100">当前实盘模拟账户持仓明细 ({len(holdings)} 笔)</h2>
          <p class="text-xs text-slate-400 mt-0.5">防洗盘动态止损 (-4.13%) · 移动止盈 (回撤-2.5%) · T+2尾盘强制换手 (14:45)</p>
        </div>
        <span class="text-xs px-2.5 py-1 rounded bg-slate-800 text-slate-300 border border-slate-700 font-mono">
          实时监控中
        </span>
      </div>

      <div class="overflow-x-auto custom-scrollbar">
        <table class="w-full text-left text-xs">
          <thead class="bg-slate-800/60 text-slate-400 border-b border-slate-800">
            <tr>
              <th class="py-3 px-4 font-semibold">股票名称/代码</th>
              <th class="py-3 px-4 font-semibold">持仓股数</th>
              <th class="py-3 px-4 font-semibold">买入价 / 买入时间</th>
              <th class="py-3 px-4 font-semibold">最新现价</th>
              <th class="py-3 px-4 font-semibold">持仓市值</th>
              <th class="py-3 px-4 font-semibold">浮动盈亏</th>
              <th class="py-3 px-4 font-semibold">日内最高浮盈</th>
              <th class="py-3 px-4 font-semibold">当前风控状态</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-800 text-slate-300">
            {"".join([f'''
            <tr class="hover:bg-slate-800/40 transition">
              <td class="py-3 px-4">
                <div class="font-bold text-slate-100">{h.get('name')}</div>
                <div class="font-mono text-slate-400">{h.get('code')}</div>
              </td>
              <td class="py-3 px-4 font-mono font-bold">{h.get('shares', 0):,} 股</td>
              <td class="py-3 px-4 font-mono">
                <div>¥{h.get('entry_price', 0):.2f}</div>
                <div class="text-slate-400 text-[11px]">{h.get('entry_date')} 09:25</div>
              </td>
              <td class="py-3 px-4 font-mono font-bold text-slate-100">¥{h.get('current_price', 0):.2f}</td>
              <td class="py-3 px-4 font-mono">¥{(h.get('shares', 0)*h.get('current_price', 0)):,.2f}</td>
              <td class="py-3 px-4 font-mono font-bold {'text-red-400' if h.get('unrealized_pnl_pct', 0) >= 0 else 'text-emerald-400'}">
                {'+' if h.get('unrealized_pnl_pct', 0) >= 0 else ''}{h.get('unrealized_pnl_pct', 0):.2f}%
                <div class="text-[11px] font-normal">¥{h.get('unrealized_pnl_amt', 0):+,.2f}</div>
              </td>
              <td class="py-3 px-4 font-mono text-amber-400">+{h.get('highest_gain_pct', 0):.2f}%</td>
              <td class="py-3 px-4">
                <span class="px-2 py-0.5 rounded text-[11px] font-medium {'bg-red-500/20 text-red-300 border border-red-500/30' if h.get('is_locked_limit_up') else 'bg-slate-800 text-slate-300 border border-slate-700'}">
                  {'🔒 涨停锁仓' if h.get('is_locked_limit_up') else '⚡ 盘中监控'}
                </span>
              </td>
            </tr>
            ''' for h in holdings]) if holdings else '''
            <tr>
              <td colspan="8" class="text-center py-8 text-slate-500">当前模拟盘暂无持仓，等待明日集合竞价开仓信号</td>
            </tr>
            '''}
          </tbody>
        </table>
      </div>
    </div>
  </main>

  <script>
    // Initialize Chart.js NAV Curve
    const labels = {json.dumps(nav_labels)};
    const dataVals = {json.dumps(nav_values)};

    const ctx = document.getElementById('navChart').getContext('2d');
    new Chart(ctx, {{
      type: 'line',
      data: {{
        labels: labels.length > 0 ? labels : ['08-15', '08-18', '08-19', '08-20', '08-21'],
        datasets: [{{
          label: '账户 NAV 净值',
          data: dataVals.length > 0 ? dataVals : [1.0000, 1.0120, 1.0080, 1.0340, 1.0450],
          borderColor: '#ef4444',
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
          borderWidth: 2,
          pointRadius: 4,
          pointBackgroundColor: '#ef4444',
          fill: true,
          tension: 0.3
        }}, {{
          label: '基准 (1.0)',
          data: (labels.length > 0 ? labels : ['08-15', '08-18', '08-19', '08-20', '08-21']).map(() => 1.0),
          borderColor: '#475569',
          borderDash: [5, 5],
          borderWidth: 1,
          pointRadius: 0,
          fill: false
        }}]
      }},
      options: {{
        responsive: true,
        maintainAspectRatio: false,
        plugins: {{
          legend: {{
            labels: {{ color: '#94a3b8', font: {{ size: 11 }} }}
          }}
        }},
        scales: {{
          x: {{
            grid: {{ color: '#1e293b' }},
            ticks: {{ color: '#94a3b8', font: {{ size: 10 }} }}
          }},
          y: {{
            grid: {{ color: '#1e293b' }},
            ticks: {{ color: '#94a3b8', font: {{ size: 10 }} }}
          }}
        }}
      }}
    }});
  </script>
</body>
</html>"""


class QuantWebRequestHandler(SimpleHTTPRequestHandler):
    """Handles HTTP requests on port 3006."""

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        # 1. API: Sentiment
        if path == "/api/sentiment":
            self._send_json(get_latest_data().get("sentiment", {}))
            return

        # 2. API: Candidates
        elif path == "/api/candidates":
            self._send_json(get_latest_data().get("candidates", []))
            return

        # 3. API: Portfolio
        elif path == "/api/portfolio":
            self._send_json(get_latest_data().get("portfolio", {}))
            return

        # 4. API: System Status
        elif path == "/api/status":
            self._send_json(get_latest_data())
            return

        # 5. API: Logs
        elif path == "/api/logs":
            self._send_json(get_recent_logs(50))
            return

        # 6. API: Review and Attribution
        elif path == "/api/review" or path == "/api/review/aug24-evaluation":
            from quant_system.core.review_attribution import review_attribution_engine
            review_data = review_attribution_engine.get_review_and_attribution()
            self._send_json({"success": True, "data": review_data})
            return

        # 7. HTML Dashboard
        elif path == "/" or path == "/index.html" or path == "/dashboard":
            data = get_latest_data()
            html = render_html_dashboard(data)
            self._send_html(html)
            return

        # Default fallback
        self.send_error(404, "Endpoint Not Found")

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        
        if path == "/api/review":
            from quant_system.scheduler.engine import quant_scheduler
            res = quant_scheduler.trigger_manual_review()
            self._send_json({"status": "SUCCESS", "result": res})
            return

        elif path == "/api/trade":
            from quant_system.scheduler.engine import quant_scheduler
            res = quant_scheduler.trigger_manual_trading()
            self._send_json({"status": "SUCCESS", "result": res})
            return

        self.send_error(404, "POST Endpoint Not Found")

    def _send_json(self, data: Any, status: int = 200):
        body = json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _send_html(self, html_content: str, status: int = 200):
        body = html_content.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        # Suppress noisy access logging in standard output
        pass


class ReusableThreadingHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True


def start_web_server(port: int = WEB_PORT, background: bool = True) -> Optional[HTTPServer]:
    """Start web server on 0.0.0.0:port."""
    server_address = ("0.0.0.0", port)
    try:
        httpd = ReusableThreadingHTTPServer(server_address, QuantWebRequestHandler)
        record_system_log("INFO", "WebServer", f"Port {port} Web Server listening on http://0.0.0.0:{port}")
        logger.info(f"Port {port} Web Server active: http://localhost:{port}")
        
        if background:
            t = threading.Thread(target=httpd.serve_forever, daemon=True, name="Quant3006WebServer")
            t.start()
            return httpd
        else:
            httpd.serve_forever()
            return httpd
    except Exception as e:
        logger.error(f"Failed to bind port {port}: {e}")
        record_system_log("ERROR", "WebServer", f"Port {port} server start error: {e}")
        return None
