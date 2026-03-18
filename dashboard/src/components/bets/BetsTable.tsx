import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Bet } from '../../lib/types'
import { formatCurrency, formatOdds, formatDate, formatEdge, formatPercent, getMarketLabel } from '../../lib/utils'
import { TierBadge, ResultBadge } from '../common/Badge'
import { BetInfoBubble } from '../common/BetInfoBubble'
import { LiveBadge } from '../common/LiveBadge'
import { deleteBet, requestMirrorBets } from '../../lib/queries'

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
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null)
  const [liveBetId, setLiveBetId] = useState<number | null>(null)
  const [liveAmount, setLiveAmount] = useState(100)
  const [livePlaced, setLivePlaced] = useState<Set<number>>(new Set())
  const queryClient = useQueryClient()

  const deleteMutation = useMutation({
    mutationFn: deleteBet,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bets'] })
      setConfirmDelete(null)
    },
  })

  const liveMutation = useMutation({
    mutationFn: ({ betId, stake }: { betId: number; stake: number }) =>
      requestMirrorBets([betId], stake),
    onSuccess: (_data, vars) => {
      setLivePlaced(prev => new Set(prev).add(vars.betId))
      setLiveBetId(null)
      queryClient.invalidateQueries({ queryKey: ['bets'] })
    },
  })

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
                <div className="relative flex items-center gap-2 whitespace-nowrap">
                  <a
                    href="https://www.espn.com/nba/scoreboard"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-400 hover:text-blue-300 hover:underline"
                    title="ESPN Box Score"
                  >
                    ESPN
                  </a>
                  {/* Bet Live button — only for pending demo bets */}
                  {bet.result === 'PENDING' && !bet.notes?.includes('LIVE') && (
                    livePlaced.has(bet.id) ? (
                      <span className="text-[10px] text-cyan-400 font-medium">Sent</span>
                    ) : (
                      <>
                        <button
                          onClick={() => setLiveBetId(liveBetId === bet.id ? null : bet.id)}
                          className="rounded border border-cyan-500/40 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-medium text-cyan-400 hover:bg-cyan-500/20 transition-colors"
                        >
                          Bet Live
                        </button>
                        {/* Bubble popup */}
                        {liveBetId === bet.id && (
                          <div className="absolute right-0 top-8 z-50 w-56 rounded-xl border border-cyan-500/30 bg-gray-900 p-4 shadow-xl shadow-black/40">
                            <div className="mb-3">
                              <p className="text-xs font-semibold text-white mb-0.5">Mirror to Betfair</p>
                              <p className="text-[10px] text-gray-500">{bet.player} {bet.side} {bet.line} {bet.market?.replace('player_', '')}</p>
                            </div>
                            <div className="mb-3">
                              <label className="text-[10px] text-gray-400 mb-1 block">Stake (AUD)</label>
                              <div className="flex gap-1.5 mb-2">
                                {[25, 50, 100, 200].map(amt => (
                                  <button
                                    key={amt}
                                    onClick={() => setLiveAmount(amt)}
                                    className={`flex-1 rounded py-1 text-[10px] font-mono transition-colors ${
                                      liveAmount === amt
                                        ? 'bg-cyan-600 text-white'
                                        : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                                    }`}
                                  >
                                    ${amt}
                                  </button>
                                ))}
                              </div>
                              <input
                                type="number"
                                value={liveAmount}
                                onChange={e => setLiveAmount(Math.max(1, parseInt(e.target.value) || 0))}
                                className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-sm font-mono text-white text-right focus:border-cyan-500 focus:outline-none"
                                min={1}
                                autoFocus
                              />
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => liveMutation.mutate({ betId: bet.id, stake: liveAmount })}
                                disabled={liveMutation.isPending}
                                className="flex-1 rounded-lg bg-cyan-600 py-1.5 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-50 transition-colors"
                              >
                                {liveMutation.isPending ? 'Placing...' : `Place $${liveAmount} Live`}
                              </button>
                              <button
                                onClick={() => setLiveBetId(null)}
                                className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:border-gray-600 transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </>
                    )
                  )}
                  {/* Cancel/delete button */}
                  {confirmDelete === bet.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => deleteMutation.mutate(bet.id)}
                        className="rounded bg-red-600 px-2 py-0.5 text-[10px] font-bold text-white hover:bg-red-500"
                      >
                        Yes
                      </button>
                      <button
                        onClick={() => setConfirmDelete(null)}
                        className="text-[10px] text-gray-400 hover:text-gray-200 px-1"
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDelete(bet.id)}
                      className="rounded border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-400 hover:bg-red-500/20 transition-colors"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
