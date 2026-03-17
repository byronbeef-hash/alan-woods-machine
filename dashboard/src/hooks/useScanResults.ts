import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { fetchScanResults, placeBetFromScan, type ScanFilters } from '../lib/queries'
import { supabase } from '../lib/supabase'
import type { ScanResult } from '../lib/types'

export function useScanResults(filters: ScanFilters = {}) {
  return useQuery({
    queryKey: ['scan_results', filters],
    queryFn: () => fetchScanResults(filters),
    refetchInterval: 30000,
  })
}

export function usePlaceBetFromScan() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (scanResult: ScanResult) => placeBetFromScan(scanResult),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scan_results'] })
      queryClient.invalidateQueries({ queryKey: ['bets'] })
    },
  })
}

export function useRealtimeScanResults() {
  const queryClient = useQueryClient()

  useEffect(() => {
    const channel = supabase
      .channel('scan-results-changes')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'scan_results',
      }, () => {
        queryClient.invalidateQueries({ queryKey: ['scan_results'] })
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [queryClient])
}
