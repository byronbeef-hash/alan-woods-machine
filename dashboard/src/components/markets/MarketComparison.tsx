import type { MarketStats } from '../../lib/types'
import { formatCurrency, formatPercent, formatEdge, getMarketLabel } from '../../lib/utils'

interface MarketComparisonProps {
  stats: MarketStats[]
}

export function MarketComparison({ stats }: MarketComparisonProps) {
  if (stats.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-xl border border-gray-800 bg-gray-900 text-sm text-gray-500">
        No settled bets yet — market comparison will appear here
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-800 bg-gray-900">
      <div className="border-b border-gray-800 px-5 py-3">
        <h3 className="text-sm font-semibold text-gray-300">Market Performance Comparison</h3>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-800 text-left text-xs text-gray-500">
            <th className="px-4 py-2.5">Market</th>
            <th className="px-4 py-2.5 text-center">Bets</th>
            <th className="px-4 py-2.5 text-center">Win Rate</th>
            <th className="px-4 py-2.5 text-right">P&L</th>
            <th className="px-4 py-2.5 text-right">ROI</th>
            <th className="px-4 py-2.5 text-right">Avg Edge</th>
            <th className="px-4 py-2.5 text-center">Strong</th>
            <th className="px-4 py-2.5 text-center">Moderate</th>
            <th className="px-4 py-2.5 text-center">Marginal</th>
          </tr>
        </thead>
        <tbody>
          {stats.map(s => (
            <tr key={s.market} className="border-b border-gray-800/50 hover:bg-gray-800/30">
              <td className="px-4 py-3 font-medium text-white">{getMarketLabel(s.market)}</td>
              <td className="px-4 py-3 text-center text-gray-300">{s.totalBets}</td>
              <td className="px-4 py-3 text-center">
                <span className={s.winRate >= 0.5 ? 'text-emerald-400' : 'text-red-400'}>
                  {formatPercent(s.winRate)}
                </span>
              </td>
              <td className="px-4 py-3 text-right font-mono text-xs">
                <span className={s.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                  {formatCurrency(s.totalPnl)}
                </span>
              </td>
              <td className="px-4 py-3 text-right font-mono text-xs">
                <span className={s.roi >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                  {formatPercent(s.roi)}
                </span>
              </td>
              <td className="px-4 py-3 text-right font-mono text-xs text-emerald-400">
                {formatEdge(s.avgEdge)}
              </td>
              <td className="px-4 py-3 text-center text-gray-400">{s.tierDistribution['STRONG'] || 0}</td>
              <td className="px-4 py-3 text-center text-gray-400">{s.tierDistribution['MODERATE'] || 0}</td>
              <td className="px-4 py-3 text-center text-gray-400">{s.tierDistribution['MARGINAL'] || 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
