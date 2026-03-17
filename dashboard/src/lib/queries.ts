import { supabase } from './supabase'
import type { Bet, PerformanceSnapshot } from './types'

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
  dateFrom?: string
  dateTo?: string
}

export async function fetchFilteredBets(filters: BetFilters): Promise<Bet[]> {
  let query = supabase.from('bets').select('*')

  if (filters.market) query = query.eq('market', filters.market)
  if (filters.tier) query = query.eq('tier', filters.tier)
  if (filters.result) query = query.eq('result', filters.result)
  if (filters.dateFrom) query = query.gte('created_at', filters.dateFrom)
  if (filters.dateTo) query = query.lte('created_at', filters.dateTo)

  const { data, error } = await query.order('created_at', { ascending: false })

  if (error) throw error
  return (data || []) as Bet[]
}
