import type { Bet } from '../../lib/types'
import { formatCurrency, formatOdds, formatDateTime, formatPercent, formatEdge, getMarketLabel } from '../../lib/utils'
import { TierBadge, ResultBadge } from '../common/Badge'
import { BetInfoBubble } from '../common/BetInfoBubble'

interface RecentBetsProps {
  bets: Bet[]
}

export function RecentBets({ bets }: RecentBetsProps) {
  const recent = [...bets].reverse().slice(0, 10)

  if (recent.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-xl border border-gray-800 bg-gray-900 text-sm text-gray-500">
        No bets recorded yet
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900">
      <div className="border-b border-gray-800 px-5 py-3">
        <h3 className="text-sm font-semibold text-gray-300">Recent Bets</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-left text-xs text-gray-500">
              <th className="px-4 py-2.5">Time</th>
              <th className="px-4 py-2.5">Player</th>
              <th className="px-4 py-2.5">Market</th>
              <th className="px-4 py-2.5">Play</th>
              <th className="px-4 py-2.5">Odds</th>
              <th className="px-4 py-2.5">Win Prob</th>
              <th className="px-4 py-2.5">Edge</th>
              <th className="px-4 py-2.5">Tier</th>
              <th className="px-4 py-2.5">Result</th>
              <th className="px-4 py-2.5 text-right">P&L</th>
            </tr>
          </thead>
          <tbody>
            {recent.map(bet => (
              <tr key={bet.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                <td className="px-4 py-2.5 text-xs text-gray-400">
                  {formatDateTime(bet.created_at)}
                </td>
                <td className="px-4 py-2.5 font-medium text-white">
                  <BetInfoBubble bet={bet}>
                    <span className="cursor-pointer underline decoration-gray-600 underline-offset-2 hover:decoration-gray-400">{bet.player}</span>
                  </BetInfoBubble>
                </td>
                <td className="px-4 py-2.5 text-gray-300">{getMarketLabel(bet.market)}</td>
                <td className="px-4 py-2.5 text-gray-300">
                  {bet.side} {bet.line}
                </td>
                <td className="px-4 py-2.5 text-gray-300">{formatOdds(bet.odds_american)}</td>
                <td className="px-4 py-2.5 font-mono text-xs text-cyan-400">
                  {bet.model_prob !== null ? formatPercent(bet.model_prob) : '—'}
                </td>
                <td className="px-4 py-2.5 font-mono text-xs text-emerald-400">
                  {bet.edge !== null ? formatEdge(bet.edge) : '—'}
                </td>
                <td className="px-4 py-2.5">{bet.tier && <TierBadge tier={bet.tier} />}</td>
                <td className="px-4 py-2.5"><ResultBadge result={bet.result} /></td>
                <td className="px-4 py-2.5 text-right font-mono text-xs">
                  {bet.pnl !== null ? (
                    <span className={bet.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                      {formatCurrency(bet.pnl)}
                    </span>
                  ) : (
                    <span className="text-gray-600">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
