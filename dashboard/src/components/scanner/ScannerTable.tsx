import { useState } from 'react'
import type { ScanResult } from '../../lib/types'
import { SPORT_LABELS, SPORT_COLORS, MARKET_LABELS } from '../../lib/types'
import { formatOdds, formatPercent, formatEdge, formatGameTime } from '../../lib/utils'
import { TierBadge } from '../common/Badge'

interface ScannerTableProps {
  results: ScanResult[]
  onPlaceBet?: (result: ScanResult) => void
  placingId?: number | null
}

type SortKey = 'edge' | 'model_prob' | 'player' | 'sport' | 'game_time' | 'suggested_bet_size'
type SortDir = 'asc' | 'desc'

function SportBadge({ sport }: { sport: string }) {
  const label = SPORT_LABELS[sport] || sport
  const color = SPORT_COLORS[sport] || '#6b7280'
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
      style={{ backgroundColor: `${color}20`, color }}
    >
      {label}
    </span>
  )
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'PLACED') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
        <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
        Placed
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-semibold text-blue-400">
      Active
    </span>
  )
}

export function ScannerTable({ results, onPlaceBet, placingId }: ScannerTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('edge')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const sorted = [...results].sort((a, b) => {
    const va = a[sortKey]
    const vb = b[sortKey]
    if (va === null || va === undefined) return 1
    if (vb === null || vb === undefined) return -1
    const cmp = va < vb ? -1 : va > vb ? 1 : 0
    return sortDir === 'asc' ? cmp : -cmp
  })

  const sortIcon = (key: SortKey) =>
    sortKey === key ? (sortDir === 'asc' ? ' ^' : ' v') : ''

  if (results.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-xl border border-gray-800 bg-gray-900 text-sm text-gray-500">
        No scan results match the current filters
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-800 bg-gray-900">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-800 text-left text-xs text-gray-500">
            <th className="px-4 py-2.5">Status</th>
            <th className="cursor-pointer px-4 py-2.5 hover:text-gray-300" onClick={() => handleSort('sport')}>
              Sport{sortIcon('sport')}
            </th>
            <th className="cursor-pointer px-4 py-2.5 hover:text-gray-300" onClick={() => handleSort('player')}>
              Player{sortIcon('player')}
            </th>
            <th className="px-4 py-2.5">Market</th>
            <th className="px-4 py-2.5">Play</th>
            <th className="px-4 py-2.5">Odds</th>
            <th className="px-4 py-2.5">Model %</th>
            <th className="cursor-pointer px-4 py-2.5 hover:text-gray-300" onClick={() => handleSort('edge')}>
              Edge{sortIcon('edge')}
            </th>
            <th className="px-4 py-2.5" title="Win Expectation = P(win) x odds. >1.0 = overlay (good bet), <1.0 = underlay (avoid)">
              W.E.
            </th>
            <th className="px-4 py-2.5">Tier</th>
            <th className="px-4 py-2.5">Confidence</th>
            <th className="cursor-pointer px-4 py-2.5 hover:text-gray-300" onClick={() => handleSort('suggested_bet_size')}>
              Size{sortIcon('suggested_bet_size')}
            </th>
            <th className="cursor-pointer px-4 py-2.5 hover:text-gray-300" onClick={() => handleSort('game_time')}>
              Game{sortIcon('game_time')}
            </th>
            <th className="px-4 py-2.5">Action</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(result => (
            <tr key={result.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
              <td className="px-4 py-2.5">
                <StatusBadge status={result.status} />
              </td>
              <td className="px-4 py-2.5">
                <SportBadge sport={result.sport} />
              </td>
              <td className="px-4 py-2.5 font-medium text-white">
                {result.player}
              </td>
              <td className="px-4 py-2.5 text-gray-300">
                {MARKET_LABELS[result.market] || result.market}
              </td>
              <td className="px-4 py-2.5 text-gray-300">
                {result.side} {result.line}
              </td>
              <td className="px-4 py-2.5 text-gray-300">
                {formatOdds(result.odds_american)}
              </td>
              <td className="px-4 py-2.5 font-mono text-xs text-cyan-400">
                {result.model_prob !== null ? formatPercent(result.model_prob) : '—'}
              </td>
              <td className="px-4 py-2.5 font-mono text-xs text-emerald-400">
                {result.edge !== null ? formatEdge(result.edge) : '—'}
              </td>
              <td className="px-4 py-2.5 font-mono text-xs">
                {result.model_prob !== null && result.odds_decimal !== null ? (
                  <WinExpectation value={result.model_prob * result.odds_decimal} />
                ) : '—'}
              </td>
              <td className="px-4 py-2.5">
                {result.tier && <TierBadge tier={result.tier as 'STRONG' | 'MODERATE' | 'MARGINAL'} />}
              </td>
              <td className="px-4 py-2.5 font-mono text-xs text-gray-400">
                {result.confidence !== null ? formatPercent(result.confidence) : '—'}
              </td>
              <td className="px-4 py-2.5 font-mono text-xs text-gray-300">
                {result.suggested_bet_size !== null ? `$${result.suggested_bet_size.toFixed(0)}` : '—'}
              </td>
              <td className="px-4 py-2.5 text-xs text-gray-400">
                {result.game_time ? formatGameTime(result.game_time) : '—'}
              </td>
              <td className="px-4 py-2.5">
                {result.status === 'ACTIVE' && onPlaceBet ? (
                  <button
                    onClick={() => onPlaceBet(result)}
                    disabled={placingId === result.id}
                    className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {placingId === result.id ? 'Placing...' : 'Place Bet'}
                  </button>
                ) : result.status === 'PLACED' ? (
                  <span className="text-xs text-gray-500">Auto-placed</span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function WinExpectation({ value }: { value: number }) {
  // >1.0 = overlay (green), 0.82-1.0 = small overlay but risky due to commission (amber), <0.82 = underlay (red)
  const color = value > 1.0
    ? 'text-emerald-400'
    : value >= 0.82
      ? 'text-amber-400'
      : 'text-red-400'
  return <span className={color}>{value.toFixed(2)}</span>
}
