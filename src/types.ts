export interface SentimentComponent {
  raw_value: number;
  score: number;
  weight: number;
  weighted_score: number;
  unit: string;
  description: string;
  broken_rate_pct?: number;
}

export interface SentimentData {
  trade_date: string;
  sentiment_score: number;
  sentiment_state?: string;
  sentiment_level: string;
  sentiment_circuit_breaker: boolean;
  target_position_ratio: number;
  components: {
    yesterday_zt_premium: SentimentComponent;
    market_limit_down: SentimentComponent;
    max_consecutive_boards: SentimentComponent;
    advance_decline_ratio: SentimentComponent;
  };
  market_summary: {
    limit_up_count: number;
    limit_down_count: number;
    up_count: number;
    down_count: number;
    activity_pct: number;
  };
}

export interface FactorScoreItem {
  score: number;
  weight: number;
  weighted_score: number;
  [key: string]: any;
}

export interface CandidateStock {
  code: string;
  name: string;
  price: number;
  change_pct: number;
  amount: number;
  turnover_rate: number;
  float_market_cap: number;
  total_market_cap: number;
  seal_amount: number;
  seal_ratio: number;
  first_seal_time: string;
  last_seal_time: string;
  broken_count: number;
  consecutive_boards: number;
  sector: string;
  is_st: boolean;
  institution_ratio: number;
  high_60d_breakout: boolean;
  trade_date: string;
  data_source: string;
  quant_score: number;
  rank: number;
  factor_breakdown: {
    consecutive_board_sentiment?: FactorScoreItem;
    seal_strength: FactorScoreItem;
    chip_structure: FactorScoreItem;
    sector_resonance: FactorScoreItem;
    status_stability?: FactorScoreItem;
  };
}

export interface CandidatesPayload {
  trade_date: string;
  generate_time: string;
  sentiment_state?: string;
  total_limit_up_count: number;
  passed_filter_count: number;
  filter_stats: {
    total: number;
    st_excluded: number;
    cap_out_of_range: number;
    price_out_of_range: number;
    inst_ratio_high: number;
    passed: number;
  };
  candidates_count: number;
  candidates: CandidateStock[];
  all_scored_stocks?: CandidateStock[];
}

export interface HoldingPosition {
  code: string;
  name: string;
  shares: number;
  entry_price: number;
  cost_price: number;
  entry_date: string;
  holding_days: number;
  can_sell?: boolean;
  t1_lock_text?: string;
  high_price: number;
  current_price: number;
  change_pct?: number;
  pullback_pct?: number;
  turnover_rate?: number;
  seal_ratio?: number;
  trailing_stop_price?: number;
  status_tag?: "LOCKED_ZT" | "TRAILING_WARN" | "HARD_STOP_WARN" | "T2_EXIT_PENDING" | "NORMAL";
  market_value: number;
  unrealized_pnl: number;
  unrealized_pnl_pct: number;
  anti_shakeout_count: number;
  hard_stop_price: number;
  sector: string;
}

export interface Aug21EvaluationItem {
  code: string;
  name: string;
  aug21_rank: number;
  aug21_score: number;
  aug21_consecutive_boards: number;
  sector: string;
  aug24_open_price: number;
  aug24_open_pct: number;
  aug24_buy_status: string;
  aug24_buy_reason: string;
  aug24_close_price: number;
  aug24_close_pct: number;
  aug24_consecutive_boards: number;
  is_consecutive_board_success: boolean;
  aug24_intraday_high: number;
  aug24_intraday_low: number;
  aug24_seal_time: string;
  aug24_seal_ratio: number;
  aug24_turnover: number;
  aug24_floating_pnl: number;
  aug24_floating_pnl_pct: number;
  t1_holding_status: string;
  evaluation_verdict: string;
  detailed_analysis: string;
}

export interface Aug24AttributionItem {
  code: string;
  name: string;
  sector: string;
  aug21_score: number;
  aug21_rank: number;
  aug24_board_status: string;
  aug24_change_pct: number;
  factor_rejection_breakdown: Record<string, {
    value: string;
    score: number;
    impact: string;
  }>;
  why_not_in_top5: string;
}

export interface Aug25RecommendationItem {
  code: string;
  name: string;
  price: number;
  change_pct: number;
  consecutive_boards: number;
  sector: string;
  quant_score: number;
  turnover_rate: number;
  seal_ratio: number;
  first_seal_time: string;
  recommend_reason: string;
  operation_guide: string;
}

export interface ReviewAttributionPayload {
  review_date: string;
  review_time: string;
  prev_trade_date?: string;
  next_trade_date?: string;
  market_summary: {
    sentiment_state?: string;
    sentiment_score?: number;
    total_limit_up_count?: number;
    consecutive_limit_up_count?: number;
    max_consecutive_boards?: number;
    total_limit_down_count?: number;
    broken_up_count?: number;
    advance_ratio?: number;
    up_count?: number;
    down_count?: number;
    top4_hit_rate?: string;
    total_portfolio_floating_pnl?: number;
    total_portfolio_floating_pnl_pct?: number;
    target_position_ratio?: number;
  };
  // New deep-review sections
  prev_day_candidates_review?: {
    prev_trade_date?: string;
    review_trade_date?: string;
    total_reviewed?: number;
    success_consecutive_board_count?: number;
    win_count?: number;
    loss_count?: number;
    hit_rate_pct?: number;
    avg_pnl_pct?: number;
    items?: PrevDayCandidateItem[];
  };
  closed_positions_attribution?: {
    attribution_date?: string;
    total_exits?: number;
    loss_exit_count?: number;
    items?: ClosedPositionAttributionItem[];
  };
  consecutive_board_success_analysis?: {
    total_success?: number;
    items?: ConsecutiveBoardSuccessItem[];
  };
  next_day_prediction?: {
    prediction_for_trade_date?: string;
    prevailing_sentiment_state?: string;
    prevailing_sentiment_score?: number;
    market_level_prediction?: string;
    item_predictions?: NextDayPredictionItem[];
  };
  // Legacy (preserved)
  top_candidate_evaluations?: Aug21EvaluationItem[];
  lower_ranked_attributions?: Aug24AttributionItem[];
  next_day_recommended_candidates?: Aug25RecommendationItem[];
  aug21_top4_evaluations: Aug21EvaluationItem[];
  aug24_consecutive_board_attributions: Aug24AttributionItem[];
  aug25_recommended_candidates: Aug25RecommendationItem[];
}

export interface PrevDayCandidateItem {
  code?: string;
  name?: string;
  sector?: string;
  prev_day_quant_score?: number;
  prev_day_rank?: number;
  prev_day_factor_breakdown?: any;
  prev_day_consecutive_boards?: number;
  prev_day_close_price?: number;
  buy_price?: number;
  buy_reason?: string;
  from_portfolio_buy?: boolean;
  today_close_price?: number;
  today_change_pct?: number;
  today_consecutive_boards?: number;
  today_rank_in_candidates?: number;
  today_seal_ratio_pct?: number;
  today_turnover_rate?: number;
  today_broken_count?: number;
  today_first_seal_time?: string;
  today_factor_breakdown?: any;
  pnl_amount?: number;
  pnl_pct?: number;
  outcome?: string;
  outcome_cn?: string;
  still_holding?: boolean;
  exit_logs?: any[];
}

export interface ClosedPositionAttributionItem {
  code?: string;
  name?: string;
  sell_time?: string;
  sell_price?: number;
  realized_pnl?: number;
  realized_pnl_pct?: number;
  exit_rule_type?: string;
  exit_reason?: string;
  prev_day_quant_score?: number;
  prev_day_rank?: number;
  prev_day_factor_breakdown_snapshot?: any;
  today_factor_breakdown_snapshot?: any;
  is_loss_exit?: boolean;
  evidence?: any;
  attribution_reasons?: string[];
  attribution_summary?: string;
}

export interface ConsecutiveBoardSuccessItem {
  code?: string;
  name?: string;
  sector?: string;
  prev_day_consecutive_boards?: number;
  today_consecutive_boards?: number;
  board_advancement?: string;
  today_quant_score?: number;
  today_rank?: number;
  today_price?: number;
  today_change_pct?: number;
  today_amount?: number;
  today_turnover_rate?: number;
  today_seal_ratio_pct?: number;
  today_first_seal_time?: string;
  today_last_seal_time?: string;
  today_broken_count?: number;
  today_institution_ratio_pct?: number;
  factor_scores_today?: {
    consecutive_board_sentiment?: number;
    seal_strength?: number;
    chip_structure?: number;
    sector_resonance?: number;
  };
  factor_details_today?: any;
  verdict?: string;
}

export interface NextDayPredictionItem {
  code?: string;
  name?: string;
  sector?: string;
  rank?: number;
  today_quant_score?: number;
  today_consecutive_boards?: number;
  today_close_price?: number;
  today_change_pct?: number;
  direction?: string;
  confidence_level?: string;
  confidence_pct?: number;
  key_drivers?: string[];
  today_factor_scores?: {
    consecutive_board_sentiment?: number;
    seal_strength?: number;
    chip_structure?: number;
    sector_resonance?: number;
  };
  risk_flags?: {
    broken_count?: number;
    high_turnover?: number;
    low_seal_ratio?: number;
  };
  operation_guide?: string;
  prediction_summary?: string;
}

export interface SellAlertCardData {
  alert_id: string;
  code: string;
  name: string;
  time: string;
  date: string;
  sell_price: number;
  shares: number;
  entry_price: number;
  realized_pnl: number;
  realized_pnl_pct: number;
  rule_type: "TRAILING_STOP" | "HARD_STOP" | "T2_FORCED" | "MANUAL";
  reason: string;
  details?: {
    high_price?: number;
    pullback_pct?: number;
    stop_price?: number;
    holding_days?: number;
  };
}

export interface TradeOrder {
  order_id: string;
  type: "BUY" | "SELL";
  code: string;
  name: string;
  date: string;
  time: string;
  price: number;
  shares: number;
  amount: number;
  friction: number;
  realized_pnl?: number;
  realized_pnl_pct?: number;
  holding_days?: number;
  rule_type?: string;
  reason: string;
}

export interface NavHistoryItem {
  date: string;
  total_asset: number;
  nav: number;
  cash: number;
  market_value: number;
}

export interface PortfolioState {
  initial_capital: number;
  cash: number;
  market_value: number;
  total_asset: number;
  nav: number;
  daily_pnl: number;
  total_pnl: number;
  current_step?: string;
  current_step_name?: string;
  holdings: HoldingPosition[];
  trade_history: TradeOrder[];
  nav_history: NavHistoryItem[];
  recent_sell_alerts?: SellAlertCardData[];
  last_update: string;
}

export interface DataSourceHealth {
  name: string;
  status: "ONLINE" | "DEGRADED" | "OFFLINE";
  latency_ms: number;
  priority: number;
  endpoint: string;
  error?: string;
}

export interface SystemLogEntry {
  timestamp: string;
  level: "INFO" | "WARNING" | "ERROR";
  category: string;
  message: string;
  details?: Record<string, any>;
}

export interface ConfigDiffItem {
  param_key: string;
  param_name: string;
  current_value: number;
  suggested_value: number;
  min_bound: number;
  max_bound: number;
  step?: number;
  unit?: string;
  reason: string;
}

export interface IterationMetrics {
  current_win_rate: number;
  candidate_win_rate: number;
  win_rate_delta?: string;
  current_sharpe: number;
  candidate_sharpe: number;
  sharpe_delta?: string;
  current_max_dd: number;
  candidate_max_dd: number;
  max_dd_delta?: string;
  current_profit_loss_ratio?: number;
  candidate_profit_loss_ratio?: number;
  evaluated_trades_count?: number;
}

export interface ImpactedTrade {
  code: string;
  name: string;
  date: string;
  type: "FIX" | "HIT" | "MISS";
  action_tag?: string;
  original_action?: string;
  filtered_action?: string;
  pnl_saved_pct?: string;
  description: string;
}

export interface EquityCurvePoint {
  date: string;
  current_nav: number;
  candidate_nav: number;
  excess_return?: number;
}

export interface MarketSessionInfo {
  current_time_beijing: string;
  today_date?: string;
  trade_date: string;
  latest_trade_date?: string;
  prev_trade_date?: string;
  next_trade_date?: string;
  session_phase: string;
  session_name: string;
  is_trading_active: boolean;
  update_interval_sec: number;
}

export interface IterationData {
  trade_date: string;
  has_recommendation: boolean;
  status?: "PENDING_REVIEW" | "APPROVED" | "REJECTED";
  summary: string;
  last_evaluated?: string;
  config_diff: ConfigDiffItem[];
  metrics: IterationMetrics;
  equity_curve?: EquityCurvePoint[];
  impacted_trades: ImpactedTrade[];
  applied_params?: Record<string, number>;
}

