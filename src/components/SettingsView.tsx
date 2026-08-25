import React, { useState } from "react";
import { 
  Settings, 
  Activity, 
  TrendingUp, 
  ShieldAlert, 
  ShieldCheck, 
  Sliders, 
  Layers, 
  Award, 
  Clock, 
  Percent, 
  Calculator, 
  Zap, 
  AlertTriangle, 
  CheckCircle2, 
  Sparkles,
  HelpCircle,
  BarChart3,
  BookOpen
} from "lucide-react";

export const SettingsView: React.FC = () => {
  const [activeSubSection, setActiveSubSection] = useState<"all" | "sentiment" | "factors" | "trading" | "simulator">("all");

  // Simulator State for interactive factor score testing
  const [simConsecutive, setSimConsecutive] = useState<number>(2);
  const [simSentimentState, setSimSentimentState] = useState<string>("震荡/分化期");
  const [simIsLeader, setSimIsLeader] = useState<boolean>(false);
  const [simSealRatio, setSimSealRatio] = useState<number>(0.15);
  const [simSealTime, setSimSealTime] = useState<string>("09:42:00");
  const [simTurnover, setSimTurnover] = useState<number>(8.5);
  const [simBrokenCount, setSimBrokenCount] = useState<number>(0);
  const [simHighBreakout, setSimHighBreakout] = useState<boolean>(true);
  const [simSectorRank, setSimSectorRank] = useState<number>(85);
  const [simHasFollower, setSimHasFollower] = useState<boolean>(true);

  // Calculate simulated factor 1: 连板与情绪 (30%)
  const calculateSimFactor1 = () => {
    let base = 50;
    if (simConsecutive >= 5) base = 95;
    else if (simConsecutive >= 3) base = 75;
    else if (simConsecutive === 2) base = 65;

    let adj = 0;
    if (simSentimentState === "退潮/弱势期" || simSentimentState === "熔断状态") {
      if (simConsecutive === 3 || simConsecutive === 4) adj -= 30;
      else if (simConsecutive === 1 || simConsecutive === 2) adj += 10;
    } else if (simSentimentState === "主升/强势期") {
      if (simIsLeader) adj += 15;
    }

    const score = Math.max(0, Math.min(100, base + adj));
    return { score, base, adj };
  };

  // Calculate simulated factor 2: 封板强度 (25%)
  const calculateSimFactor2 = () => {
    // seal ratio percentile proxy
    const sealRatioScore = Math.min(100, (simSealRatio / 0.3) * 100);
    
    // time score
    let timeScore = 50;
    if (simSealTime <= "09:35:00") timeScore = 100;
    else if (simSealTime <= "09:45:00") timeScore = 90;
    else if (simSealTime <= "10:00:00") timeScore = 80;
    else if (simSealTime <= "11:30:00") timeScore = 60;
    else if (simSealTime <= "14:00:00") timeScore = 40;
    else timeScore = 20;

    const score = Math.round(sealRatioScore * 0.6 + timeScore * 0.4);
    return { score: Math.min(100, score), sealRatioScore, timeScore };
  };

  // Calculate simulated factor 3: 筹码与炸板 (25%)
  const calculateSimFactor3 = () => {
    let turnoverScore = 30;
    if (simTurnover >= 5.0 && simTurnover <= 18.0) turnoverScore = 100;
    else if (simTurnover >= 3.0 && simTurnover <= 25.0) turnoverScore = 75;
    else if (simTurnover < 3.0) turnoverScore = 45;

    const breakoutBonus = simHighBreakout ? 20 : 0;
    const chipSub = Math.min(100, turnoverScore * 0.8 + breakoutBonus);

    let brokenScore = 100;
    if (simBrokenCount === 1) brokenScore = 60;
    else if (simBrokenCount === 2) brokenScore = 30;
    else if (simBrokenCount >= 3) brokenScore = 10;

    const score = Math.round(chipSub * 0.6 + brokenScore * 0.4);
    return { score: Math.min(100, score), turnoverScore, brokenScore };
  };

  // Calculate simulated factor 4: 板块共振 (20%)
  const calculateSimFactor4 = () => {
    const followerScore = simHasFollower ? 30 : 0;
    const score = Math.round(Math.min(100, simSectorRank * 0.7 + followerScore));
    return { score, sectorScore: simSectorRank, followerScore };
  };

  const f1 = calculateSimFactor1();
  const f2 = calculateSimFactor2();
  const f3 = calculateSimFactor3();
  const f4 = calculateSimFactor4();

  const totalScore = Math.round((f1.score * 0.3 + f2.score * 0.25 + f3.score * 0.25 + f4.score * 0.2) * 100) / 100;

  return (
    <div className="space-y-8 animate-fade-in text-slate-100">
      {/* Top Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-indigo-500/20 rounded-xl p-6 shadow-xl relative overflow-hidden">
        <div className="absolute right-0 top-0 w-96 h-96 bg-indigo-500/5 rounded-full blur-3xl pointer-events-none" />
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                <BookOpen className="w-5 h-5" />
              </div>
              <h2 className="text-xl font-bold text-white tracking-tight">
                量化模型底层算法与实盘交易规则白皮书
              </h2>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-mono bg-indigo-950 text-indigo-300 border border-indigo-700/50">
                Core Math & Logic
              </span>
            </div>
            <p className="text-sm text-slate-300 mt-2 max-w-3xl leading-relaxed">
              系统严格遵循 A 股超短线打板逻辑与行为金融学统计规律，构建由“大盘情绪周期择时”、“四大因子分位数打分模型”与“T+1 集合竞价/防洗盘实盘风控引擎”组成的全自动化闭环。
            </p>
          </div>

          {/* Quick Filter Navigation */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => setActiveSubSection("all")}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${activeSubSection === "all" ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-400 hover:text-slate-200"}`}
            >
              全部白皮书
            </button>
            <button
              onClick={() => setActiveSubSection("sentiment")}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${activeSubSection === "sentiment" ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-400 hover:text-slate-200"}`}
            >
              大盘情绪模型
            </button>
            <button
              onClick={() => setActiveSubSection("factors")}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${activeSubSection === "factors" ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-400 hover:text-slate-200"}`}
            >
              四大因子体系
            </button>
            <button
              onClick={() => setActiveSubSection("trading")}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${activeSubSection === "trading" ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-400 hover:text-slate-200"}`}
            >
              实盘风控规则
            </button>
            <button
              onClick={() => setActiveSubSection("simulator")}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${activeSubSection === "simulator" ? "bg-amber-600 text-white font-bold" : "bg-slate-800 text-slate-400 hover:text-amber-300"}`}
            >
              🧮 交互试算器
            </button>
          </div>
        </div>
      </div>

      {/* SECTION 1: 大盘情绪模型 */}
      {(activeSubSection === "all" || activeSubSection === "sentiment") && (
        <section className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 space-y-6 shadow-md">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div className="flex items-center gap-2.5">
              <Activity className="w-5 h-5 text-red-400" />
              <h3 className="text-lg font-bold text-slate-100">
                一、大盘情绪周期量化模型 (Market Sentiment Timing)
              </h3>
            </div>
            <span className="text-xs text-slate-400 font-mono">15:30 盘后全市场多维实时计算</span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left: 4 Dimensions Calculation */}
            <div className="space-y-4">
              <h4 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-indigo-400" />
                1. 情绪打分四维构成与数学权重 (总分 100 分)
              </h4>

              <div className="space-y-3">
                <div className="bg-slate-800/60 border border-slate-700/60 rounded-lg p-3.5 space-y-1.5">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-bold text-red-400">① 涨停赚钱效应因子 (权重 30%)</span>
                    <span className="font-mono text-slate-400">Score = min(100, (涨停家数 / 80) × 100)</span>
                  </div>
                  <p className="text-[12px] text-slate-300 leading-relaxed">
                    以全市场 80 家自然涨停为满分基准。当市场涨停家数突破 80 家时，赚钱效应达到极致饱和。
                  </p>
                </div>

                <div className="bg-slate-800/60 border border-slate-700/60 rounded-lg p-3.5 space-y-1.5">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-bold text-amber-400">② 连板空间高度溢价 (权重 25%)</span>
                    <span className="font-mono text-slate-400">Score = min(100, ((最高连板 - 1) / 6) × 100)</span>
                  </div>
                  <p className="text-[12px] text-slate-300 leading-relaxed">
                    衡量游资主升浪空间拓展能力。当市场最高板达到 7 连板及以上时评分为 100 分，代表主线龙头效应极其强盛。
                  </p>
                </div>

                <div className="bg-slate-800/60 border border-slate-700/60 rounded-lg p-3.5 space-y-1.5">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-bold text-purple-400">③ 封板稳定性与炸板惩罚 (权重 25%)</span>
                    <span className="font-mono text-slate-400">Score = (涨停 / (涨停 + 炸板)) × 100</span>
                  </div>
                  <p className="text-[12px] text-slate-300 leading-relaxed">
                    计算封板成功率。封板成功率低于 60% 时，表明日内接力亏钱效应剧增，主力资金在涨停板分歧派发。
                  </p>
                </div>

                <div className="bg-slate-800/60 border border-slate-700/60 rounded-lg p-3.5 space-y-1.5">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-bold text-emerald-400">④ 全市场涨跌家数广度 (权重 20%)</span>
                    <span className="font-mono text-slate-400">Score = (上涨家数 / (上涨 + 下跌)) × 100</span>
                  </div>
                  <p className="text-[12px] text-slate-300 leading-relaxed">
                    反映全市场超 5300 只个股的普涨普跌情况，规避指数虚高而个股普跌的“赚指数亏钱”假象。
                  </p>
                </div>
              </div>
            </div>

            {/* Right: States & Circuit Breaker */}
            <div className="space-y-4">
              <h4 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-rose-400" />
                2. 情绪状态判定矩阵与全局熔断机制
              </h4>

              <div className="border border-slate-800 rounded-lg overflow-hidden bg-slate-950/40">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-800 text-slate-300 font-semibold border-b border-slate-700">
                    <tr>
                      <th className="py-2.5 px-3">情绪区间</th>
                      <th className="py-2.5 px-3">量化状态</th>
                      <th className="py-2.5 px-3">实盘风控动作</th>
                      <th className="py-2.5 px-3">连板因子策略调整</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80 font-mono text-slate-300">
                    <tr className="bg-rose-950/30">
                      <td className="py-2.5 px-3 text-rose-400 font-bold">&lt; 30 分</td>
                      <td className="py-2.5 px-3 text-rose-300 font-bold">熔断状态</td>
                      <td className="py-2.5 px-3 text-rose-400">强制 0 仓位锁定，禁止一切买入</td>
                      <td className="py-2.5 px-3 text-slate-400">中位股 -30 分，首板 +10 分</td>
                    </tr>
                    <tr className="bg-amber-950/20">
                      <td className="py-2.5 px-3 text-amber-400 font-bold">30 ~ 45 分</td>
                      <td className="py-2.5 px-3 text-amber-300 font-bold">退潮/弱势期</td>
                      <td className="py-2.5 px-3 text-amber-300">仓位降至 30%~50%，严格执行防洗盘止损</td>
                      <td className="py-2.5 px-3 text-amber-400">中位股 (3-4板) -30分 避险；首板 +10分</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 px-3 text-blue-400 font-bold">45 ~ 70 分</td>
                      <td className="py-2.5 px-3 text-blue-300 font-bold">震荡/分化期</td>
                      <td className="py-2.5 px-3 text-slate-300">标准 100% 仓位等权分配</td>
                      <td className="py-2.5 px-3 text-slate-400">常规身位打分，聚焦板块共振前排</td>
                    </tr>
                    <tr className="bg-red-950/30">
                      <td className="py-2.5 px-3 text-red-400 font-bold">&gt; 70 分</td>
                      <td className="py-2.5 px-3 text-red-300 font-bold">主升/强势期</td>
                      <td className="py-2.5 px-3 text-red-300">满仓积极参与，持股锁仓放宽止盈</td>
                      <td className="py-2.5 px-3 text-red-400">空间高度龙头额外 +15 分主升加成</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="p-3.5 bg-rose-950/20 border border-rose-900/40 rounded-lg text-xs text-rose-300/90 leading-relaxed flex items-start gap-2">
                <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold">防爆仓熔断原理：</span>
                  在极端退潮冰点（如千股跌停或连续大面积炸板），游资接力模型胜率大幅衰减。此时系统会自动启动冷冻锁仓，在次日 09:25 拒绝任何买入申报，从底层杜绝复利回撤。
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* SECTION 2: 四大因子体系 */}
      {(activeSubSection === "all" || activeSubSection === "factors") && (
        <section className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 space-y-6 shadow-md">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div className="flex items-center gap-2.5">
              <TrendingUp className="w-5 h-5 text-indigo-400" />
              <h3 className="text-lg font-bold text-slate-100">
                二、四大因子分位数相对排序打分模型 (4-Factor Model)
              </h3>
            </div>
            <span className="text-xs text-slate-400 font-mono">横截面 Percentile-Rank · 总分 100 分</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Factor 1 */}
            <div className="bg-slate-800/50 border border-purple-500/30 rounded-xl p-4 space-y-3 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 font-bold text-xs">
                    因子 1 · 权重 30%
                  </span>
                  <Layers className="w-4 h-4 text-purple-400" />
                </div>
                <h4 className="text-sm font-bold text-slate-100 mt-2">
                  连板阶梯与情绪联动
                </h4>
                <p className="text-xs text-slate-400 mt-1">
                  Consecutive Board & Sentiment Linkage
                </p>

                <div className="mt-3 space-y-2 text-xs text-slate-300 border-t border-slate-700/60 pt-2.5 font-mono">
                  <div className="flex justify-between">
                    <span className="text-slate-400">1 连板 (首板):</span>
                    <span className="text-purple-300 font-bold">50 分</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">2 连板:</span>
                    <span className="text-purple-300 font-bold">65 分</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">3-4 连板 (中位):</span>
                    <span className="text-purple-300 font-bold">75 分</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">≥5 连板 (高位):</span>
                    <span className="text-purple-300 font-bold">95 分</span>
                  </div>
                </div>
              </div>

              <div className="p-2.5 rounded bg-purple-950/40 border border-purple-900/50 text-[11px] text-purple-200">
                ⚡ <strong>联动避险逻辑：</strong>退潮期中位股(3-4板)扣减 30分防“断板A杀”，首板加 10分防守；主升期空间高度龙头额外追加 15分。
              </div>
            </div>

            {/* Factor 2 */}
            <div className="bg-slate-800/50 border border-amber-500/30 rounded-xl p-4 space-y-3 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold text-xs">
                    因子 2 · 权重 25%
                  </span>
                  <Zap className="w-4 h-4 text-amber-400" />
                </div>
                <h4 className="text-sm font-bold text-slate-100 mt-2">
                  封板强度因子
                </h4>
                <p className="text-xs text-slate-400 mt-1">
                  Seal Strength Factor
                </p>

                <div className="mt-3 space-y-2 text-xs text-slate-300 border-t border-slate-700/60 pt-2.5 font-mono">
                  <div className="flex justify-between">
                    <span className="text-slate-400">封成比分位数 (60%):</span>
                    <span className="text-amber-300 font-bold">封单额 / 成交额</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">09:30-09:45 封板:</span>
                    <span className="text-amber-300 font-bold">100 分 (秒板)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">09:45-10:00 封板:</span>
                    <span className="text-amber-300 font-bold">85 分</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">午后 14:30 以后:</span>
                    <span className="text-slate-400 font-bold">25 分 (尾盘弱板)</span>
                  </div>
                </div>
              </div>

              <div className="p-2.5 rounded bg-amber-950/40 border border-amber-900/50 text-[11px] text-amber-200">
                🔒 <strong>主力意图识别：</strong>越早封死涨停、封单资金占全天成交比例越高，说明多头做多决心越强，次日高开溢价概率超 82%。
              </div>
            </div>

            {/* Factor 3 */}
            <div className="bg-slate-800/50 border border-emerald-500/30 rounded-xl p-4 space-y-3 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold text-xs">
                    因子 3 · 权重 25%
                  </span>
                  <Percent className="w-4 h-4 text-emerald-400" />
                </div>
                <h4 className="text-sm font-bold text-slate-100 mt-2">
                  筹码结构与炸板惩罚
                </h4>
                <p className="text-xs text-slate-400 mt-1">
                  Chip Structure & Broken Penalty
                </p>

                <div className="mt-3 space-y-2 text-xs text-slate-300 border-t border-slate-700/60 pt-2.5 font-mono">
                  <div className="flex justify-between">
                    <span className="text-slate-400">5%~18% 黄金换手:</span>
                    <span className="text-emerald-300 font-bold">100 分</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">60日新高突破:</span>
                    <span className="text-emerald-300 font-bold">+20 分加成</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">0 次炸板一封到底:</span>
                    <span className="text-emerald-300 font-bold">100 分</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">≥2 次炸板烂板:</span>
                    <span className="text-rose-400 font-bold">20-30 分惩罚</span>
                  </div>
                </div>
              </div>

              <div className="p-2.5 rounded bg-emerald-950/40 border border-emerald-900/50 text-[11px] text-emerald-200">
                💎 <strong>分歧转一致：</strong>排除缩量无承接庄股(&lt;3%)和放量滞涨死筹(&gt;25%)，精选筹码充分换手、无套牢盘的强突破形态。
              </div>
            </div>

            {/* Factor 4 */}
            <div className="bg-slate-800/50 border border-blue-500/30 rounded-xl p-4 space-y-3 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 font-bold text-xs">
                    因子 4 · 权重 20%
                  </span>
                  <Sparkles className="w-4 h-4 text-blue-400" />
                </div>
                <h4 className="text-sm font-bold text-slate-100 mt-2">
                  板块共振因子
                </h4>
                <p className="text-xs text-slate-400 mt-1">
                  Sector Resonance Factor
                </p>

                <div className="mt-3 space-y-2 text-xs text-slate-300 border-t border-slate-700/60 pt-2.5 font-mono">
                  <div className="flex justify-between">
                    <span className="text-slate-400">行业涨停家数分位:</span>
                    <span className="text-blue-300 font-bold">占比 70%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">首板小弟跟风助攻:</span>
                    <span className="text-blue-300 font-bold">+30 分直接加满</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">单打独斗无板块:</span>
                    <span className="text-slate-400 font-bold">40 分基准</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">主线领涨身位:</span>
                    <span className="text-blue-300 font-bold">板块前排优先</span>
                  </div>
                </div>
              </div>

              <div className="p-2.5 rounded bg-blue-950/40 border border-blue-900/50 text-[11px] text-blue-200">
                🌊 <strong>大势所趋：</strong>A 股独有的“板块梯队效应”。主线板块个股有大量同梯队小弟助攻封板，安全性远高于孤立无援的独狼个股。
              </div>
            </div>
          </div>

          {/* Hard Filters (排雷硬性条件) */}
          <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 space-y-2">
            <h4 className="text-xs font-bold text-slate-200 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              排雷硬性过滤指标 (Hard Exclusion Filters)
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2.5 text-xs text-slate-300 pt-1">
              <div className="p-2 rounded bg-slate-900 border border-slate-800">
                <span className="text-red-400 font-bold">1. 严禁 ST / *ST：</span>
                <span className="text-slate-400 block mt-0.5">直接剔除退市警示与戴帽股票。</span>
              </div>
              <div className="p-2 rounded bg-slate-900 border border-slate-800">
                <span className="text-amber-400 font-bold">2. 市值门槛：</span>
                <span className="text-slate-400 block mt-0.5">15 亿 ≤ 总市值 ≤ 1500 亿，剔除微盘与大盘股。</span>
              </div>
              <div className="p-2 rounded bg-slate-900 border border-slate-800">
                <span className="text-blue-400 font-bold">3. 流动性底线：</span>
                <span className="text-slate-400 block mt-0.5">日成交额 ≥ 5000 万元，保障实盘顺畅进出。</span>
              </div>
              <div className="p-2 rounded bg-slate-900 border border-slate-800">
                <span className="text-purple-400 font-bold">4. 开盘价下限：</span>
                <span className="text-slate-400 block mt-0.5">次日开盘跌幅 &lt; -4.5% 严重破位股自动放弃。</span>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* SECTION 3: 模拟实盘操作规则 */}
      {(activeSubSection === "all" || activeSubSection === "trading") && (
        <section className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 space-y-6 shadow-md">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div className="flex items-center gap-2.5">
              <Clock className="w-5 h-5 text-emerald-400" />
              <h3 className="text-lg font-bold text-slate-100">
                三、模拟实盘账户操作规则与交易风控白皮书
              </h3>
            </div>
            <span className="text-xs text-slate-400 font-mono">T+1 集合竞价撮合 · 防洗盘动态离场</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Step 1: 集合竞价买入 */}
            <div className="bg-slate-800/40 border border-slate-700/60 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-red-600/20 text-red-400 border border-red-500/40 flex items-center justify-center font-bold text-xs">
                  1
                </div>
                <h4 className="text-sm font-bold text-slate-100">T+1 集合竞价撮合买入</h4>
              </div>
              <ul className="space-y-2 text-xs text-slate-300 list-disc list-inside leading-relaxed">
                <li>
                  <strong className="text-slate-100">执行时点：</strong>09:25 - 09:30 集合竞价定盘价。
                </li>
                <li>
                  <strong className="text-slate-100">仓位均分：</strong>针对前一日打分选出的 Top 3-5 只标的，按可用资金等权分配。
                </li>
                <li>
                  <strong className="text-rose-400">一字涨停跳过：</strong>开盘价涨幅 ≥ +9.8%（无量顶一字），判定无法买入并跳过。
                </li>
                <li>
                  <strong className="text-amber-400">超弱低开跳过：</strong>开盘价涨幅 &lt; -4.5%（竞价被核按钮），判定走弱自动放弃。
                </li>
                <li>
                  <strong className="text-slate-400">交易滑点摩擦：</strong>包含双边 0.15% 印花税与佣金损耗。
                </li>
              </ul>
            </div>

            {/* Step 2: 盘中防洗盘监控 */}
            <div className="bg-slate-800/40 border border-slate-700/60 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-amber-600/20 text-amber-400 border border-amber-500/40 flex items-center justify-center font-bold text-xs">
                  2
                </div>
                <h4 className="text-sm font-bold text-slate-100">盘中防洗盘动态出场</h4>
              </div>
              <ul className="space-y-2 text-xs text-slate-300 list-disc list-inside leading-relaxed">
                <li>
                  <strong className="text-emerald-400">移动止盈 (-2.5%)：</strong>当个股日内盈利从最高点回撤超过 2.5% 时，触发止盈平仓，锁定利润。
                </li>
                <li>
                  <strong className="text-rose-400">防洗盘止损 (-4.13%)：</strong>个股浮亏达到 -4.13% 且连续 3 笔 Tick 无法收回时触发止损，防止主力瞬间向下“假摔插针”。
                </li>
                <li>
                  <strong className="text-slate-100">涨停锁仓：</strong>若盘中牢牢封死涨停，持仓不动，享受次日高开连板溢价。
                </li>
              </ul>
            </div>

            {/* Step 3: T+2 强制离场 */}
            <div className="bg-slate-800/40 border border-slate-700/60 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-blue-600/20 text-blue-400 border border-blue-500/40 flex items-center justify-center font-bold text-xs">
                  3
                </div>
                <h4 className="text-sm font-bold text-slate-100">T+2 尾盘强制离场</h4>
              </div>
              <ul className="space-y-2 text-xs text-slate-300 list-disc list-inside leading-relaxed">
                <li>
                  <strong className="text-slate-100">清仓时点：</strong>次日 14:45 尾盘。
                </li>
                <li>
                  <strong className="text-indigo-300">弱势必出：</strong>若持仓个股至 14:45 仍未能封死涨停板，系统自动以市价清仓离场。
                </li>
                <li>
                  <strong className="text-slate-400">超短资金高周转：</strong>不参与隔夜未知利空博弈，资金快速归位，准备参与当晚新一轮候选打板选股。
                </li>
              </ul>
            </div>
          </div>
        </section>
      )}

      {/* SECTION 4: 交互式因子试算器 (Factor Simulator) */}
      {(activeSubSection === "all" || activeSubSection === "simulator") && (
        <section className="bg-gradient-to-b from-slate-900 to-slate-950 border border-amber-500/30 rounded-xl p-6 space-y-6 shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div className="flex items-center gap-2.5">
              <Calculator className="w-5 h-5 text-amber-400" />
              <h3 className="text-lg font-bold text-slate-100">
                四、四大因子打分动态试算器 (Interactive Factor Simulator)
              </h3>
            </div>
            <span className="text-xs px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-mono">
              实时公式验算
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Input Controls */}
            <div className="lg:col-span-2 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* 1. 连板与情绪 */}
                <div className="bg-slate-800/60 border border-slate-700/60 rounded-lg p-3.5 space-y-2.5">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-bold text-purple-400">连板身位 (1 - 8 板)</span>
                    <span className="font-mono text-purple-300 font-bold">{simConsecutive} 连板</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="8"
                    step="1"
                    value={simConsecutive}
                    onChange={(e) => setSimConsecutive(Number(e.target.value))}
                    className="w-full accent-purple-500 cursor-pointer"
                  />
                  <div className="pt-2 border-t border-slate-700/50 space-y-2">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-400">当前大盘情绪状态:</span>
                      <select
                        value={simSentimentState}
                        onChange={(e) => setSimSentimentState(e.target.value)}
                        className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
                      >
                        <option value="主升/强势期">主升/强势期 (&gt;70)</option>
                        <option value="震荡/分化期">震荡/分化期 (45-70)</option>
                        <option value="退潮/弱势期">退潮/弱势期 (30-45)</option>
                        <option value="熔断状态">熔断状态 (&lt;30)</option>
                      </select>
                    </div>
                    <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={simIsLeader}
                        onChange={(e) => setSimIsLeader(e.target.checked)}
                        className="rounded accent-purple-500"
                      />
                      <span>全市场最高板 (空间龙头)</span>
                    </label>
                  </div>
                </div>

                {/* 2. 封板强度 */}
                <div className="bg-slate-800/60 border border-slate-700/60 rounded-lg p-3.5 space-y-2.5">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-bold text-amber-400">封单金额占成交比 (封成比)</span>
                    <span className="font-mono text-amber-300 font-bold">{(simSealRatio * 100).toFixed(1)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0.01"
                    max="0.4"
                    step="0.01"
                    value={simSealRatio}
                    onChange={(e) => setSimSealRatio(Number(e.target.value))}
                    className="w-full accent-amber-500 cursor-pointer"
                  />
                  <div className="pt-2 border-t border-slate-700/50 flex justify-between items-center text-xs">
                    <span className="text-slate-400">首次封板时间:</span>
                    <select
                      value={simSealTime}
                      onChange={(e) => setSimSealTime(e.target.value)}
                      className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
                    >
                      <option value="09:32:00">09:30-09:35 (一开秒封)</option>
                      <option value="09:42:00">09:35-09:45 (早盘强势)</option>
                      <option value="09:55:00">09:45-10:00 (稳步推板)</option>
                      <option value="10:30:00">10:00-11:30 (上午封板)</option>
                      <option value="13:30:00">13:00-14:30 (午后封板)</option>
                      <option value="14:50:00">14:30-15:00 (尾盘偷袭板)</option>
                    </select>
                  </div>
                </div>

                {/* 3. 筹码与炸板 */}
                <div className="bg-slate-800/60 border border-slate-700/60 rounded-lg p-3.5 space-y-2.5">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-bold text-emerald-400">换手率 (Turnover Rate)</span>
                    <span className="font-mono text-emerald-300 font-bold">{simTurnover.toFixed(1)}%</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="35"
                    step="0.5"
                    value={simTurnover}
                    onChange={(e) => setSimTurnover(Number(e.target.value))}
                    className="w-full accent-emerald-500 cursor-pointer"
                  />
                  <div className="pt-2 border-t border-slate-700/50 space-y-2 text-xs">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400">日内炸板次数:</span>
                      <select
                        value={simBrokenCount}
                        onChange={(e) => setSimBrokenCount(Number(e.target.value))}
                        className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
                      >
                        <option value="0">0 次 (一封到底)</option>
                        <option value="1">1 次炸板回封</option>
                        <option value="2">2 次炸板烂板</option>
                        <option value="3">≥3 次频繁炸板</option>
                      </select>
                    </div>
                    <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={simHighBreakout}
                        onChange={(e) => setSimHighBreakout(e.target.checked)}
                        className="rounded accent-emerald-500"
                      />
                      <span>创 60 日新高突破 (+20分)</span>
                    </label>
                  </div>
                </div>

                {/* 4. 板块共振 */}
                <div className="bg-slate-800/60 border border-slate-700/60 rounded-lg p-3.5 space-y-2.5">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-bold text-blue-400">板块涨停家数分位排名</span>
                    <span className="font-mono text-blue-300 font-bold">{simSectorRank} 分位</span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="100"
                    step="5"
                    value={simSectorRank}
                    onChange={(e) => setSimSectorRank(Number(e.target.value))}
                    className="w-full accent-blue-500 cursor-pointer"
                  />
                  <div className="pt-2 border-t border-slate-700/50 flex justify-between items-center text-xs">
                    <span className="text-slate-400">首板跟风助攻:</span>
                    <label className="flex items-center gap-1.5 text-blue-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={simHasFollower}
                        onChange={(e) => setSimHasFollower(e.target.checked)}
                        className="rounded accent-blue-500"
                      />
                      <span>有首板助攻 (+30分)</span>
                    </label>
                  </div>
                </div>
              </div>
            </div>

            {/* Simulated Live Output Card */}
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 flex flex-col justify-between shadow-2xl">
              <div>
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <span className="text-xs font-bold text-slate-300">因子模拟总得分</span>
                  <span className="text-xs text-slate-400 font-mono">100 分制</span>
                </div>

                <div className="my-5 text-center">
                  <div className="text-5xl font-black font-mono tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-amber-400 via-red-400 to-purple-400">
                    {totalScore.toFixed(2)}
                  </div>
                  <div className="mt-2 flex items-center justify-center gap-2">
                    <span className={`px-2.5 py-0.5 rounded text-xs font-bold ${totalScore >= 80 ? "bg-red-500/20 text-red-300 border border-red-500/40" : (totalScore >= 65 ? "bg-amber-500/20 text-amber-300 border border-amber-500/40" : "bg-slate-800 text-slate-400")}`}>
                      {totalScore >= 80 ? "🎯 强力推荐候选 (Top Pick)" : (totalScore >= 65 ? "✓ 符合入围门槛" : "⚠️ 评级偏低")}
                    </span>
                  </div>
                </div>

                {/* Breakdown */}
                <div className="space-y-2 text-xs border-t border-slate-800/80 pt-3 font-mono">
                  <div className="flex justify-between items-center">
                    <span className="text-purple-400">1. 连板与情绪 (30%):</span>
                    <span className="text-slate-200 font-bold">{f1.score} 分 <span className="text-slate-500 font-normal">({(f1.score * 0.3).toFixed(1)}分)</span></span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-amber-400">2. 封板强度 (25%):</span>
                    <span className="text-slate-200 font-bold">{f2.score} 分 <span className="text-slate-500 font-normal">({(f2.score * 0.25).toFixed(1)}分)</span></span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-emerald-400">3. 筹码与炸板 (25%):</span>
                    <span className="text-slate-200 font-bold">{f3.score} 分 <span className="text-slate-500 font-normal">({(f3.score * 0.25).toFixed(1)}分)</span></span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-blue-400">4. 板块共振 (20%):</span>
                    <span className="text-slate-200 font-bold">{f4.score} 分 <span className="text-slate-500 font-normal">({(f4.score * 0.2).toFixed(1)}分)</span></span>
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-800 text-[11px] text-slate-400 text-center">
                调整左侧滑动条，可即时检验极端退潮期与主升浪下的因子响应表现。
              </div>
            </div>
          </div>
        </section>
      )}

      {/* SECTION 5: 策略修改与代码文件全景指引 */}
      <section className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 space-y-5 shadow-md">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3.5">
          <div className="flex items-center gap-2.5">
            <Sliders className="w-5 h-5 text-indigo-400" />
            <h3 className="text-lg font-bold text-slate-100">
              五、策略修改与代码文件全景索引 (Code Customization Guide)
            </h3>
          </div>
          <span className="text-xs font-mono text-indigo-300 bg-indigo-950/80 px-2.5 py-1 rounded border border-indigo-700/40">
            Developer Quick Reference
          </span>
        </div>

        <p className="text-xs text-slate-300 leading-relaxed">
          若您需要调整量化策略参数、修改选股因子计算规则或接入新的行情数据源，可直接在对应 Python 模块中进行修改：
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-purple-300 font-mono">1. quant_system/config.py</span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-800/40">核心全局配置</span>
            </div>
            <p className="text-slate-300 leading-relaxed">
              修改四大因子权重 (<code className="text-purple-300">FACTOR_WEIGHTS</code>)、情绪分界阈值 (<code className="text-purple-300">SENTIMENT_WEAK/STRONG_THRESHOLD</code>)、滑点手续费 (<code className="text-purple-300">BUY/SELL_FRICTION_RATE</code>)、止盈止损参数及市值排雷过滤边界。
            </p>
          </div>

          <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-amber-300 font-mono">2. quant_system/core/sentiment.py</span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800/40">大盘情绪择时</span>
            </div>
            <p className="text-slate-300 leading-relaxed">
              修改情绪评分算法（连板晋级率、最高板溢价、封板成功率、涨跌广度等子项权重）、熔断机制及动态目标仓位矩阵 (<code className="text-amber-300">target_position_ratio</code>)。
            </p>
          </div>

          <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-emerald-300 font-mono">3. quant_system/core/scoring.py</span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800/40">打分与选股逻辑</span>
            </div>
            <p className="text-slate-300 leading-relaxed">
              修改四大因子打分公式、分位数横截面排序、情绪周期与连板因子的加减分联动规则，以及多级排序优先级 (<code className="text-emerald-300">quant_score, -first_seal_time, seal_ratio</code>)。
            </p>
          </div>

          <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-blue-300 font-mono">4. quant_system/core/portfolio.py</span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-800/40">模拟实盘撮合</span>
            </div>
            <p className="text-slate-300 leading-relaxed">
              修改 T+1 集合竞价开盘买入逻辑（跳过一字板/高开&gt;8%）、动态仓位上限约束、移动止盈 2.5%、防洗盘硬止损 -4.13% 双重确认与 T+2 14:45 强制平仓撮合规则。
            </p>
          </div>

          <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2 md:col-span-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-indigo-300 font-mono">5. quant_system/core/data_fetcher.py</span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800/40">多源数据清洗与获取</span>
            </div>
            <p className="text-slate-300 leading-relaxed">
              修改数据清洗规范 (<code className="text-indigo-300">clean_raw_data</code>)、数据源请求超时重试、AkShare / 东方财富 / 新浪财经 / 腾讯财经多源降级兜底获取涨停池与全市场行情切片。
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};
