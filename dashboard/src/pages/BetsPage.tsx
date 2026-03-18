import { useState } from 'react'
import { useFilteredBets, useRealtimeBets } from '../hooks/useBets'
import { BetFilters } from '../components/bets/BetFilters'
import { BetsTable } from '../components/bets/BetsTable'
import { LoadingSpinner } from '../components/common/LoadingSpinner'
import { formatCurrency } from '../lib/utils'
import type { BetFilters as BetFiltersType } from '../lib/queries'
import type { Bet } from '../lib/types'

function BetsSummary({ bets }: { bets: Bet[] }) {
  const totalBets = bets.length
  const settled = bets.filter(b => b.result !== 'PENDING')
  const wins = settled.filter(b => b.result === 'WIN').length
  const winRate = settled.length > 0 ? (wins / settled.length) * 100 : 0
  const totalPnl = settled.reduce((sum, b) => sum + (b.pnl || 0), 0)
  // All current bets are demo
  const demoBets = totalBets

  const stats = [
    {
      label: 'Total P&L',
      value: formatCurrency(totalPnl),
      color: totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400',
    },
    {
      label: 'Win Rate',
      value: settled.length > 0 ? `${winRate.toFixed(1)}%` : '\u2014',
      color: winRate >= 50 ? 'text-emerald-400' : winRate > 0 ? 'text-amber-400' : 'text-gray-400',
    },
    {
      label: 'Total Bets',
      value: `${totalBets}`,
      color: 'text-white',
    },
    {
      label: 'Demo Bets',
      value: `${demoBets}`,
      color: 'text-violet-400',
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {stats.map(s => (
        <div key={s.label} className="rounded-xl border border-gray-800 bg-gray-900 p-4">
          <p className="text-xs text-gray-500">{s.label}</p>
          <p className={`mt-1 text-lg font-bold font-mono ${s.color}`}>{s.value}</p>
        </div>
      ))}
    </div>
  )
}

export function BetsPage() {
  const [filters, setFilters] = useState<BetFiltersType>({})
  const { data: bets, isLoading, error } = useFilteredBets(filters)
  useRealtimeBets()

  if (error) return <div className="text-red-400">Error loading bets: {error.message}</div>

  const allBets = bets || []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">Bet History</h2>
        <span className="text-sm text-gray-400">
          {allBets.length} bets
        </span>
      </div>
      <BetsSummary bets={allBets} />
      <BetFilters filters={filters} onChange={setFilters} />
      {isLoading ? <LoadingSpinner /> : <BetsTable bets={allBets} />}
    </div>
  )
}
