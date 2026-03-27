import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { fetchScanResults, placeBetFromScan, triggerManualScan, fetchScanStatus, type ScanFilters } from '../lib/queries'
import { supabase } from '../lib/supabase'
import type { ScanResult } from '../lib/types'

export function useScanResults(filters: ScanFilters = {}) {
  return useQuery({
    queryKey: ['scan_results', filters],
    queryFn: () => fetchScanResults(filters),
    refetchInterval: 300000,
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

export function useTriggerScan() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (sportKey: string) => triggerManualScan(sportKey),
    onSuccess: () => {
      // Invalidate scan status so polling picks up the pending request
      queryClient.invalidateQueries({ queryKey: ['scan_status'] })
    },
  })
}

export function useScanStatus(enabled: boolean) {
  return useQuery({
    queryKey: ['scan_status'],
    queryFn: fetchScanStatus,
    refetchInterval: enabled ? 5000 : false, // Poll every 5s while scan is pending
    enabled,
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
