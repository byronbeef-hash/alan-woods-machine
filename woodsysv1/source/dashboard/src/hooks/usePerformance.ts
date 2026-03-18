import { useQuery } from '@tanstack/react-query'
import { fetchPerformanceSnapshots } from '../lib/queries'

export function usePerformanceSnapshots() {
  return useQuery({
    queryKey: ['performance'],
    queryFn: fetchPerformanceSnapshots,
    refetchInterval: 60000,
  })
}
