export interface Bet {
  id: number
  created_at: string
  player: string
  market: string
  stat: string
  side: 'Over' | 'Under'
  line: number
  odds_american: number | null
  odds_decimal: number | null
  model_prob: number | null
  market_implied: number | null
  edge: number | null
  tier: 'STRONG' | 'MODERATE' | 'MARGINAL' | null
  bet_size: number | null
  bankroll_at_bet: number | null
  result: 'PENDING' | 'WIN' | 'LOSS'
  actual_stat: number | null
  pnl: number | null
  running_bankroll: number | null
  home_team: string | null
  away_team: string | null
  game_time: string | null
  jersey_number: string | null
  game_status: string | null
  home_score: number | null
  away_score: number | null
  game_clock: string | null
  live_stat: number | null
  live_model_prob: number | null
  settled_at: string | null
  commission_rate: number | null
  sport: string | null
  notes: string | null
}

export interface PerformanceSnapshot {
  id: number
  created_at: string
  date: string
  total_bets: number | null
  win_rate: number | null
  total_pnl: number | null
  roi: number | null
  bankroll: number | null
}

export interface MarketStats {
  market: string
  totalBets: number
  wins: number
  losses: number
  winRate: number
  totalPnl: number
  totalWagered: number
  roi: number
  avgEdge: number
  tierDistribution: Record<string, number>
}

export interface ScanResult {
  id: number
  created_at: string
  scan_id: string
  sport: string
  player: string
  market: string
  stat: string
  side: string
  line: number
  odds_american: number | null
  odds_decimal: number | null
  model_prob: number | null
  market_implied: number | null
  edge: number | null
  tier: string | null
  confidence: number | null
  kelly_pct: number | null
  suggested_bet_size: number | null
  home_team: string | null
  away_team: string | null
  game_time: string | null
  status: 'ACTIVE' | 'PLACED' | 'EXPIRED'
  placed_bet_id: number | null
}

export type TierType = 'STRONG' | 'MODERATE' | 'MARGINAL'

export const MARKET_LABELS: Record<string, string> = {
  // NBA
  player_points: 'Points',
  player_rebounds: 'Rebounds',
  player_assists: 'Assists',
  player_threes: 'Threes',
  player_steals: 'Steals',
  player_blocks: 'Blocks',
  player_turnovers: 'Turnovers',
  // Soccer
  player_goals: 'Goals',
  player_shots_on_target: 'Shots on Target',
  player_soccer_assists: 'Soccer Assists',
  player_tackles: 'Tackles',
  player_passes: 'Passes',
  // NFL
  player_pass_yds: 'Pass Yards',
  player_rush_yds: 'Rush Yards',
  player_reception_yds: 'Rec Yards',
  player_pass_tds: 'Pass TDs',
  player_anytime_td: 'Anytime TD',
  player_receptions: 'Receptions',
  player_rush_attempts: 'Rush Attempts',
  // AFL
  player_disposals: 'Disposals',
  player_marks: 'Marks',
}

export const SPORT_LABELS: Record<string, string> = {
  basketball_nba: 'NBA',
  soccer_epl: 'EPL',
  soccer_uefa_champions_league: 'UCL',
  americanfootball_nfl: 'NFL',
  aussierules_afl: 'AFL',
}

export const SPORT_COLORS: Record<string, string> = {
  basketball_nba: '#f97316',
  soccer_epl: '#8b5cf6',
  soccer_uefa_champions_league: '#3b82f6',
  americanfootball_nfl: '#ef4444',
  aussierules_afl: '#22c55e',
}

export const DATA_SOURCES: Record<string, string> = {
  basketball_nba: 'nba_api (NBA official stats)',
  soccer_epl: 'football-data.org API',
  soccer_uefa_champions_league: 'football-data.org API',
  americanfootball_nfl: 'nfl_data_py (NFL weekly stats)',
  aussierules_afl: 'Squiggle API (AFL community data)',
}

export const MODEL_METHODOLOGY: Record<string, string> = {
  player_points: 'Gaussian | 70% recent + 30% season | Home/away + rest adjustments',
  player_rebounds: 'Gaussian | 70% recent + 30% season | Home/away + rest adjustments',
  player_assists: 'Gaussian | 70% recent + 30% season | Home/away + rest adjustments',
  player_threes: 'Poisson | Blended with empirical rate | Low-count discrete',
  player_steals: 'Poisson | Season + recent averages | Low-count discrete',
  player_blocks: 'Poisson | Season + recent averages | Low-count discrete',
  player_turnovers: 'Poisson | Season + recent averages | Low-count discrete',
  player_goals: 'Poisson | Goals per match rate | Home advantage applied',
  player_shots_on_target: 'Poisson | Derived from goal rate | Home advantage applied',
  player_soccer_assists: 'Poisson | Assists per match | Home advantage applied',
  player_tackles: 'Poisson | Per-match rate | Home/away adjustment',
  player_passes: 'Gaussian | ~25% CV | High-volume stat',
  player_pass_yds: 'Gaussian | Season weekly stats | Home advantage applied',
  player_rush_yds: 'Gaussian | Season weekly stats | Home advantage applied',
  player_reception_yds: 'Gaussian | Season weekly stats | Home advantage applied',
  player_pass_tds: 'Poisson | Low-count discrete | Home advantage applied',
  player_anytime_td: 'Poisson | Combined pass+rush TDs | Home advantage applied',
  player_receptions: 'Gaussian | Season weekly stats | Home advantage applied',
  player_rush_attempts: 'Gaussian | Season weekly stats | Home advantage applied',
  player_disposals: 'Gaussian | Season per-game | AFL home advantage applied',
  player_marks: 'Gaussian | Season per-game | AFL home advantage applied',
}

export const DEFAULT_COMMISSION_RATE = 0.05

export const TIER_COLORS: Record<string, string> = {
  STRONG: '#22c55e',
  MODERATE: '#eab308',
  MARGINAL: '#f97316',
}

export const STARTING_BANKROLL = 5000
