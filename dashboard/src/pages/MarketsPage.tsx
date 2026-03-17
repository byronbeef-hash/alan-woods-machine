import { useAllBets, useRealtimeBets } from '../hooks/useBets'
import { MarketComparison } from '../components/markets/MarketComparison'
import { MarketOverlayChart } from '../components/markets/MarketOverlayChart'
import { MarketROIChart } from '../components/markets/MarketROIChart'
import { LoadingSpinner } from '../components/common/LoadingSpinner'
import { computeMarketStats } from '../lib/utils'

export function MarketsPage() {
  const { data: bets, isLoading, error } = useAllBets()
  useRealtimeBets()

  if (isLoading) return <LoadingSpinner />
  if (error) return <div className="text-red-400">Error loading data: {error.message}</div>

  const allBets = bets || []
  const marketStats = computeMarketStats(allBets)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white">Market Analysis</h2>
        <p className="mt-1 text-sm text-gray-400">
          Compare overlay performance across prop markets to identify the best opportunities
        </p>
      </div>
      <MarketComparison stats={marketStats} />
      <div className="grid gap-6 lg:grid-cols-2">
        <MarketOverlayChart stats={marketStats} />
        <MarketROIChart bets={allBets} />
      </div>
    </div>
  )
}
