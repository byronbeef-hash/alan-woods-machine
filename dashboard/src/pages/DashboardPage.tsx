import { useQuery } from '@tanstack/react-query'
import { useAllBets, useRealtimeBets } from '../hooks/useBets'
import { fetchSystemConfig } from '../lib/queries'
import { KPICards } from '../components/dashboard/KPICards'
import { BankrollChart } from '../components/dashboard/BankrollChart'
import { RecentBets } from '../components/dashboard/RecentBets'
import { TierBreakdown } from '../components/dashboard/TierBreakdown'
import { ActivityLog } from '../components/dashboard/ActivityLog'
import { LoadingSpinner } from '../components/common/LoadingSpinner'
import { useViewMode } from '../components/layout/PageShell'

export function DashboardPage() {
  const { data: bets, isLoading, error } = useAllBets()
  const viewMode = useViewMode()
  useRealtimeBets()

  const { data: config } = useQuery({
    queryKey: ['system-config'],
    queryFn: fetchSystemConfig,
  })

  if (isLoading) return <LoadingSpinner />
  if (error) return <div className="text-red-400">Error loading data: {error.message}</div>

  // Filter by view mode
  const rawBets = bets || []
  const allBets = viewMode === 'live'
    ? rawBets.filter(b => b.notes?.includes('LIVE'))
    : rawBets.filter(b => !b.notes?.includes('LIVE'))
  const isDemo = !config || (config['woods_mode'] as string) !== 'live'

  return (
    <div className="space-y-6">
      {isDemo && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-center">
          <span className="text-sm font-bold tracking-wide text-emerald-400">
            DEMO MODE
          </span>
          <span className="ml-2 text-xs text-emerald-400/70">
            Paper trading only — no real money at risk
          </span>
        </div>
      )}
      <h2 className="text-xl font-bold text-white">Dashboard</h2>
      <KPICards bets={allBets} />
      <div className="grid gap-6 lg:grid-cols-2">
        <BankrollChart bets={allBets} />
        <TierBreakdown bets={allBets} />
      </div>
      <RecentBets bets={allBets} />
      <ActivityLog />
    </div>
  )
}
