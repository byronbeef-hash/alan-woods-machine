import { useAllBets, useRealtimeBets } from '../hooks/useBets'
import { KPICards } from '../components/dashboard/KPICards'
import { BankrollChart } from '../components/dashboard/BankrollChart'
import { RecentBets } from '../components/dashboard/RecentBets'
import { TierBreakdown } from '../components/dashboard/TierBreakdown'
import { LoadingSpinner } from '../components/common/LoadingSpinner'

export function DashboardPage() {
  const { data: bets, isLoading, error } = useAllBets()
  useRealtimeBets()

  if (isLoading) return <LoadingSpinner />
  if (error) return <div className="text-red-400">Error loading data: {error.message}</div>

  const allBets = bets || []

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-white">Dashboard</h2>
      <KPICards bets={allBets} />
      <div className="grid gap-6 lg:grid-cols-2">
        <BankrollChart bets={allBets} />
        <TierBreakdown bets={allBets} />
      </div>
      <RecentBets bets={allBets} />
    </div>
  )
}
