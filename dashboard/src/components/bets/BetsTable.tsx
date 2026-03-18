import { useState } from 'react'
import type { Bet } from '../../lib/types'
import { formatCurrency, formatOdds, formatDate, formatEdge, formatPercent, getMarketLabel } from '../../lib/utils'
import { TierBadge, ResultBadge, DemoBadge } from '../common/Badge'
import { BetInfoBubble } from '../common/BetInfoBubble'
import { LiveBadge } from '../common/LiveBadge'

interface BetsTableProps {
  bets: Bet[]
}

type SortKey = 'created_at' | 'player' | 'market' | 'edge' | 'bet_size' | 'pnl'
type SortDir = 'asc' | 'desc'

function formatGameDisplay(bet: Bet): string {
  if (!bet.home_team || !bet.away_team) return '\u2014'
  const isLiveOrFinal = bet.game_status === 'live' || bet.game_status === 'final' || bet.game_status === 'completed'
  if (isLiveOrFinal && bet.home_score !== null && bet.away_score !== null) {
    return `${bet.away_team} ${bet.away_score} @ ${bet.home_team} ${bet.home_score}`
  }
  return `${bet.away_team} @ ${bet.home_team}`
}

export function BetsTable({ bets }: BetsTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('created_at')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const sorted = [...bets].sort((a, b) => {
    const va = a[sortKey]
    const vb = b[sortKey]
    if (va === null || va === undefined) return 1
    if (vb === null || vb === undefined) return -1
    const cmp = va < vb ? -1 : va > vb ? 1 : 0
    return sortDir === 'asc' ? cmp : -cmp
  })

  const sortIcon = (key: SortKey) =>
    sortKey === key ? (sortDir === 'asc' ? ' \u25B2' : ' \u25BC') : ''

  if (bets.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-xl border border-gray-800 bg-gray-900 text-sm text-gray-500">
        No bets match the current filters
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-800 bg-gray-900">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-800 text-left text-xs text-gray-500">
            <th className="px-3 py-2.5 text-center">Placed</th>
            <th className="cursor-pointer px-3 py-2.5 hover:text-gray-300" onClick={() => handleSort('created_at')}>
              Date{sortIcon('created_at')}
            </th>
            <th className="px-3 py-2.5">Status</th>
            <th className="px-3 py-2.5">Game</th>
            <th className="cursor-pointer px-3 py-2.5 hover:text-gray-300" onClick={() => handleSort('player')}>
              Player{sortIcon('player')}
            </th>
            <th className="cursor-pointer px-3 py-2.5 hover:text-gray-300" onClick={() => handleSort('market')}>
              Market{sortIcon('market')}
            </th>
            <th className="px-3 py-2.5">Play</th>
            <th className="px-3 py-2.5">Odds</th>
            <th className="px-3 py-2.5">Win Prob</th>
            <th className="cursor-pointer px-3 py-2.5 hover:text-gray-300" onClick={() => handleSort('edge')}>
              Edge{sortIcon('edge')}
            </th>
            <th className="px-3 py-2.5">Tier</th>
            <th className="cursor-pointer px-3 py-2.5 hover:text-gray-300" onClick={() => handleSort('bet_size')}>
              Size{sortIcon('bet_size')}
            </th>
            <th className="px-3 py-2.5">Result</th>
            <th className="cursor-pointer px-3 py-2.5 text-right hover:text-gray-300" onClick={() => handleSort('pnl')}>
              P&L{sortIcon('pnl')}
            </th>
            <th className="px-3 py-2.5"></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(bet => (
            <tr key={bet.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
              {/* Placed checkbox */}
              <td className="px-3 py-2.5 text-center">
                <div className="flex items-center justify-center gap-1">
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded border border-emerald-500/50 bg-emerald-500/20 text-emerald-400 text-xs">
                    ✓
                  </span>
                  <span className="text-[10px] font-medium text-violet-400">DEMO</span>
                </div>
              </td>
              <td className="px-3 py-2.5 text-xs text-gray-400">{formatDate(bet.created_at)}</td>
              <td className="px-3 py-2.5">
                <div className="flex items-center gap-1.5">
                  <LiveBadge gameStatus={bet.game_status} gameClock={bet.game_clock} />
                </div>
              </td>
              <td className="px-3 py-2.5 text-xs text-amber-400">
                {formatGameDisplay(bet)}
              </td>
              <td className="px-3 py-2.5 font-medium text-white">
                <BetInfoBubble bet={bet}>
                  <span className="cursor-pointer underline decoration-gray-600 underline-offset-2 hover:decoration-gray-400">
                    {bet.jersey_number && <span className="text-gray-500 font-mono text-xs mr-1">#{bet.jersey_number}</span>}
                    {bet.player}
                  </span>
                </BetInfoBubble>
              </td>
              <td className="px-3 py-2.5 text-gray-300">{getMarketLabel(bet.market)}</td>
              <td className="px-3 py-2.5 text-gray-300">
                {bet.side} {bet.line}
                {bet.live_stat !== null && bet.result === 'PENDING' && (
                  <span className="ml-2 font-mono text-xs text-cyan-400">({bet.live_stat})</span>
                )}
              </td>
              <td className="px-3 py-2.5 text-gray-300">{formatOdds(bet.odds_american)}</td>
              <td className="px-3 py-2.5 font-mono text-xs text-cyan-400">
                {bet.live_model_prob !== null && bet.result === 'PENDING'
                  ? formatPercent(bet.live_model_prob)
                  : bet.model_prob !== null ? formatPercent(bet.model_prob) : '\u2014'}
              </td>
              <td className="px-3 py-2.5 font-mono text-xs text-emerald-400">
                {bet.edge !== null ? formatEdge(bet.edge) : '\u2014'}
              </td>
              <td className="px-3 py-2.5">{bet.tier && <TierBadge tier={bet.tier} />}</td>
              <td className="px-3 py-2.5 font-mono text-xs text-gray-300">
                {bet.bet_size !== null ? `$${bet.bet_size.toFixed(0)}` : '\u2014'}
              </td>
              <td className="px-3 py-2.5">
                <ResultBadge result={bet.result} actualStat={bet.actual_stat} line={bet.line} />
              </td>
              <td className="px-3 py-2.5 text-right font-mono text-xs">
                {bet.pnl !== null ? (
                  <span className={bet.pnl >= 0 ? 'text-emerald-400 font-semibold' : 'text-red-400 font-semibold'}>
                    {formatCurrency(bet.pnl)}
                  </span>
                ) : (
                  <span className="text-gray-600">\u2014</span>
                )}
              </td>
              <td className="px-3 py-2.5">
                <a
                  href="https://www.espn.com/nba/scoreboard"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-400 hover:text-blue-300 hover:underline"
                  title="ESPN Box Score"
                >
                  ESPN
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
