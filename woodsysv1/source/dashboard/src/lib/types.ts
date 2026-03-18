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

export type TierType = 'STRONG' | 'MODERATE' | 'MARGINAL'

export const MARKET_LABELS: Record<string, string> = {
  // NBA
  player_points: 'Points',
  player_rebounds: 'Rebounds',
  player_assists: 'Assists',
  player_threes: 'Threes',
  // Soccer
  player_goals: 'Goals',
  player_shots_on_target: 'Shots on Target',
  player_soccer_assists: 'Assists',
  // NFL
  player_pass_yds: 'Pass Yards',
  player_rush_yds: 'Rush Yards',
  player_reception_yds: 'Rec Yards',
  player_pass_tds: 'Pass TDs',
  player_anytime_td: 'Anytime TD',
}

export const SPORT_LABELS: Record<string, string> = {
  basketball_nba: 'NBA',
  soccer_epl: 'EPL',
  soccer_uefa_champions_league: 'UCL',
  americanfootball_nfl: 'NFL',
}

export const DEFAULT_COMMISSION_RATE = 0.05

export const TIER_COLORS: Record<string, string> = {
  STRONG: '#22c55e',
  MODERATE: '#eab308',
  MARGINAL: '#f97316',
}

export const STARTING_BANKROLL = 5000
