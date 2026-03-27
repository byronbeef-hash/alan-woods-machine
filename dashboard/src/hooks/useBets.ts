import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { fetchAllBets, fetchSettledBets, fetchPendingBets, fetchFilteredBets, type BetFilters } from '../lib/queries'
import { supabase } from '../lib/supabase'
import { useQueryClient } from '@tanstack/react-query'

export function useAllBets() {
  return useQuery({
    queryKey: ['bets', 'all'],
    queryFn: fetchAllBets,
    refetchInterval: 300000,
  })
}

export function useSettledBets() {
  return useQuery({
    queryKey: ['bets', 'settled'],
    queryFn: fetchSettledBets,
    refetchInterval: 300000,
  })
}

export function usePendingBets() {
  return useQuery({
    queryKey: ['bets', 'pending'],
    queryFn: fetchPendingBets,
    refetchInterval: 300000,
  })
}

export function useFilteredBets(filters: BetFilters) {
  return useQuery({
    queryKey: ['bets', 'filtered', filters],
    queryFn: () => fetchFilteredBets(filters),
    refetchInterval: 300000,
  })
}

export function useRealtimeBets() {
  const queryClient = useQueryClient()

  useEffect(() => {
    const channel = supabase
      .channel('bets-changes')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'bets',
      }, () => {
        queryClient.invalidateQueries({ queryKey: ['bets'] })
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [queryClient])
}
