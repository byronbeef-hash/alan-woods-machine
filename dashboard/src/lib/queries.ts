import { supabase } from './supabase'
import type { Bet, PerformanceSnapshot, ScanResult } from './types'

export async function fetchAllBets(): Promise<Bet[]> {
  const { data, error } = await supabase
    .from('bets')
    .select('*')
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data || []) as Bet[]
}

export async function fetchSettledBets(): Promise<Bet[]> {
  const { data, error } = await supabase
    .from('bets')
    .select('*')
    .in('result', ['WIN', 'LOSS'])
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data || []) as Bet[]
}

export async function fetchPendingBets(): Promise<Bet[]> {
  const { data, error } = await supabase
    .from('bets')
    .select('*')
    .eq('result', 'PENDING')
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data || []) as Bet[]
}

export async function fetchPerformanceSnapshots(): Promise<PerformanceSnapshot[]> {
  const { data, error } = await supabase
    .from('performance_snapshots')
    .select('*')
    .order('date', { ascending: true })

  if (error) throw error
  return (data || []) as PerformanceSnapshot[]
}

export interface BetFilters {
  market?: string
  tier?: string
  result?: string
  sport?: string
  dateFrom?: string
  dateTo?: string
}

export async function fetchFilteredBets(filters: BetFilters): Promise<Bet[]> {
  let query = supabase.from('bets').select('*')

  if (filters.market) query = query.eq('market', filters.market)
  if (filters.tier) query = query.eq('tier', filters.tier)
  if (filters.result) query = query.eq('result', filters.result)
  if (filters.sport) query = query.eq('sport', filters.sport)
  if (filters.dateFrom) query = query.gte('created_at', filters.dateFrom)
  if (filters.dateTo) query = query.lte('created_at', filters.dateTo)

  const { data, error } = await query.order('created_at', { ascending: false })

  if (error) throw error
  return (data || []) as Bet[]
}

// System config
export interface SystemConfigRow {
  key: string
  value: unknown
  updated_at: string
}

export async function fetchSystemConfig(): Promise<Record<string, unknown>> {
  const { data, error } = await supabase
    .from('system_config')
    .select('key, value')

  if (error) throw error
  const cfg: Record<string, unknown> = {}
  for (const row of data || []) {
    cfg[row.key] = row.value
  }
  return cfg
}

export async function updateSystemConfig(key: string, value: unknown): Promise<void> {
  const { error } = await supabase
    .from('system_config')
    .upsert({ key, value, updated_at: new Date().toISOString() })

  if (error) throw error
}

// Delete a bet
export async function deleteBet(betId: number): Promise<void> {
  const { error } = await supabase
    .from('bets')
    .delete()
    .eq('id', betId)

  if (error) throw error
}

// Mirror bets to live
export async function requestMirrorBets(betIds: number[], liveStake: number): Promise<void> {
  const { error } = await supabase
    .from('system_config')
    .upsert({
      key: 'mirror_bet_request',
      value: {
        bet_ids: betIds,
        live_stake: liveStake,
        requested_at: new Date().toISOString(),
        status: 'pending',
      },
      updated_at: new Date().toISOString(),
    })

  if (error) throw error
}

// Scan results
export interface ScanFilters {
  sport?: string
  market?: string
  tier?: string
  status?: string
}

export async function fetchScanResults(filters: ScanFilters = {}): Promise<ScanResult[]> {
  let query = supabase
    .from('scan_results')
    .select('*')
    .in('status', ['ACTIVE', 'PLACED'])
    .order('edge', { ascending: false })

  if (filters.sport) query = query.eq('sport', filters.sport)
  if (filters.market) query = query.eq('market', filters.market)
  if (filters.tier) query = query.eq('tier', filters.tier)
  if (filters.status) query = query.eq('status', filters.status)

  const { data, error } = await query
  if (error) throw error
  return (data || []) as ScanResult[]
}

export async function triggerManualScan(sportKey: string): Promise<void> {
  const { error } = await supabase
    .from('system_config')
    .upsert({
      key: 'manual_scan_request',
      value: { sport_key: sportKey || 'all', requested_at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    })

  if (error) throw error
}

export async function fetchScanStatus(): Promise<{ sport_key: string; requested_at: string } | null> {
  const { data, error } = await supabase
    .from('system_config')
    .select('value')
    .eq('key', 'manual_scan_request')
    .single()

  if (error || !data) return null
  const val = data.value as { sport_key?: string; requested_at?: string } | null
  if (!val || !val.sport_key) return null
  return val as { sport_key: string; requested_at: string }
}

export async function placeBetFromScan(scanResult: ScanResult): Promise<void> {
  // Insert into bets table
  const { data: betData, error: betError } = await supabase
    .from('bets')
    .insert({
      player: scanResult.player,
      market: scanResult.market,
      stat: scanResult.stat,
      side: scanResult.side,
      line: scanResult.line,
      odds_american: scanResult.odds_american,
      odds_decimal: scanResult.odds_decimal,
      model_prob: scanResult.model_prob,
      market_implied: scanResult.market_implied,
      edge: scanResult.edge,
      tier: scanResult.tier,
      bet_size: scanResult.suggested_bet_size,
      bankroll_at_bet: null,
      home_team: scanResult.home_team,
      away_team: scanResult.away_team,
      game_time: scanResult.game_time,
      sport: scanResult.sport,
      commission_rate: 0.05,
      result: 'PENDING',
    })
    .select('id')
    .single()

  if (betError) throw betError

  // Mark scan result as placed
  const { error: updateError } = await supabase
    .from('scan_results')
    .update({ status: 'PLACED', placed_bet_id: betData.id })
    .eq('id', scanResult.id)

  if (updateError) throw updateError
}
