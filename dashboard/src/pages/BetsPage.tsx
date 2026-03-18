import { useState } from 'react'
import { useFilteredBets, useRealtimeBets } from '../hooks/useBets'
import { BetFilters } from '../components/bets/BetFilters'
import { BetsTable } from '../components/bets/BetsTable'
import { LoadingSpinner } from '../components/common/LoadingSpinner'
import { formatCurrency } from '../lib/utils'
import { requestMirrorBets } from '../lib/queries'
import type { BetFilters as BetFiltersType } from '../lib/queries'
import type { Bet } from '../lib/types'

function BetsSummary({ bets }: { bets: Bet[] }) {
  const totalBets = bets.length
  const settled = bets.filter(b => b.result !== 'PENDING')
  const wins = settled.filter(b => b.result === 'WIN').length
  const winRate = settled.length > 0 ? (wins / settled.length) * 100 : 0
  const totalPnl = settled.reduce((sum, b) => sum + (b.pnl || 0), 0)
  const demoBets = totalBets
  const liveBets = bets.filter(b => b.notes?.includes('LIVE')).length

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
      label: 'Demo / Live',
      value: `${demoBets - liveBets} / ${liveBets}`,
      color: liveBets > 0 ? 'text-cyan-400' : 'text-violet-400',
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

function MirrorPanel({ bets, onClose }: { bets: Bet[]; onClose: () => void }) {
  const pendingBets = bets.filter(b => b.result === 'PENDING')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(
    new Set(pendingBets.map(b => b.id))
  )
  const [liveStake, setLiveStake] = useState(100)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const toggleBet = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAll = () => setSelectedIds(new Set(pendingBets.map(b => b.id)))
  const selectNone = () => setSelectedIds(new Set())

  const selectedBets = pendingBets.filter(b => selectedIds.has(b.id))
  const totalStake = selectedBets.length * liveStake
  const potentialReturn = selectedBets.reduce(
    (sum, b) => sum + liveStake * ((b.odds_decimal || 1.91) - 1),
    0
  )

  const handleSubmit = async () => {
    if (selectedIds.size === 0) return
    setSubmitting(true)
    try {
      await requestMirrorBets(Array.from(selectedIds), liveStake)
      setSubmitted(true)
    } catch (err) {
      console.error('Mirror request failed:', err)
    }
    setSubmitting(false)
  }

  if (submitted) {
    return (
      <div className="rounded-xl border-2 border-cyan-500/30 bg-cyan-500/5 p-6">
        <div className="text-center">
          <p className="text-lg font-bold text-cyan-400">Mirror Request Submitted</p>
          <p className="mt-2 text-sm text-gray-400">
            {selectedBets.length} bets queued at ${liveStake} each (${totalStake} total).
            The runner will place these on Betfair when it next processes.
          </p>
          <button onClick={onClose} className="mt-4 rounded-lg bg-gray-800 px-4 py-2 text-sm text-gray-300 hover:bg-gray-700">
            Close
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-xl border-2 border-cyan-500/30 bg-gray-900 p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-bold text-white">Mirror Demo Bets to Live</h3>
          <p className="text-xs text-gray-500 mt-1">
            Select demo bets to replicate on Betfair Exchange at your chosen stake
          </p>
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-lg">&times;</button>
      </div>

      {/* Stake selector */}
      <div className="flex items-center gap-4 mb-4 p-3 rounded-lg bg-gray-800">
        <span className="text-xs text-gray-400">Live stake per bet:</span>
        <div className="flex gap-2">
          {[50, 100, 200, 500].map(amount => (
            <button
              key={amount}
              onClick={() => setLiveStake(amount)}
              className={`rounded px-3 py-1 text-xs font-mono transition-colors ${
                liveStake === amount
                  ? 'bg-cyan-600 text-white'
                  : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
              }`}
            >
              ${amount}
            </button>
          ))}
          <input
            type="number"
            value={liveStake}
            onChange={e => setLiveStake(Math.max(1, parseInt(e.target.value) || 0))}
            className="w-20 rounded border border-gray-600 bg-gray-700 px-2 py-1 text-xs font-mono text-white text-right"
            min={1}
          />
        </div>
      </div>

      {/* Bet selection */}
      {pendingBets.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-4">No pending demo bets to mirror</p>
      ) : (
        <>
          <div className="flex items-center gap-2 mb-2">
            <button onClick={selectAll} className="text-xs text-cyan-400 hover:text-cyan-300">Select All</button>
            <span className="text-gray-600">|</span>
            <button onClick={selectNone} className="text-xs text-gray-400 hover:text-gray-300">None</button>
            <span className="ml-auto text-xs text-gray-500">{selectedIds.size} of {pendingBets.length} selected</span>
          </div>

          <div className="space-y-1 max-h-64 overflow-y-auto">
            {pendingBets.map(bet => (
              <label
                key={bet.id}
                className={`flex items-center gap-3 p-2 rounded cursor-pointer transition-colors ${
                  selectedIds.has(bet.id) ? 'bg-cyan-500/10' : 'hover:bg-gray-800'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(bet.id)}
                  onChange={() => toggleBet(bet.id)}
                  className="h-4 w-4 rounded border-gray-600 bg-gray-800 text-cyan-500"
                />
                <div className="flex-1 flex items-center gap-3">
                  <span className="text-xs font-medium text-white w-32 truncate">{bet.player}</span>
                  <span className="text-xs text-gray-400 w-16">{bet.side} {bet.line}</span>
                  <span className="text-xs text-gray-500 w-12">
                    {bet.odds_american ? (bet.odds_american > 0 ? `+${bet.odds_american}` : bet.odds_american) : '\u2014'}
                  </span>
                  <span className="text-xs text-emerald-400 w-12">{bet.edge ? `${(bet.edge * 100).toFixed(0)}%` : ''}</span>
                  <span className="text-xs text-gray-500 flex-1 truncate">
                    {bet.away_team} @ {bet.home_team}
                  </span>
                </div>
                <span className="text-xs font-mono text-cyan-400">${liveStake}</span>
              </label>
            ))}
          </div>

          {/* Summary & submit */}
          <div className="mt-4 p-3 rounded-lg bg-gray-800 flex items-center justify-between">
            <div className="space-y-1">
              <div className="flex gap-6">
                <div>
                  <span className="text-[10px] text-gray-500">Total Stake</span>
                  <p className="text-sm font-mono font-bold text-white">${totalStake.toFixed(0)}</p>
                </div>
                <div>
                  <span className="text-[10px] text-gray-500">Potential Return</span>
                  <p className="text-sm font-mono font-bold text-emerald-400">+${potentialReturn.toFixed(0)}</p>
                </div>
                <div>
                  <span className="text-[10px] text-gray-500">Bets</span>
                  <p className="text-sm font-mono font-bold text-white">{selectedIds.size}</p>
                </div>
              </div>
            </div>
            <button
              onClick={handleSubmit}
              disabled={selectedIds.size === 0 || submitting}
              className="rounded-lg bg-cyan-600 px-6 py-2.5 text-sm font-bold text-white transition-colors hover:bg-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitting ? 'Submitting...' : `Mirror ${selectedIds.size} Bets to Betfair`}
            </button>
          </div>

          <p className="mt-2 text-[10px] text-gray-600">
            Bets will be placed as BACK orders on Betfair Exchange at the current best available odds.
            Your Betfair balance: $2,500 AUD.
          </p>
        </>
      )}
    </div>
  )
}

export function BetsPage() {
  const [filters, setFilters] = useState<BetFiltersType>({})
  const [showMirror, setShowMirror] = useState(false)
  const { data: bets, isLoading, error } = useFilteredBets(filters)
  useRealtimeBets()

  if (error) return <div className="text-red-400">Error loading bets: {error.message}</div>

  const allBets = bets || []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">Bet History</h2>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-400">
            {allBets.length} bets
          </span>
          <button
            onClick={() => setShowMirror(!showMirror)}
            className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500"
          >
            Mirror to Live
          </button>
        </div>
      </div>

      {showMirror && <MirrorPanel bets={allBets} onClose={() => setShowMirror(false)} />}

      <BetsSummary bets={allBets} />
      <BetFilters filters={filters} onChange={setFilters} />
      {isLoading ? <LoadingSpinner /> : <BetsTable bets={allBets} />}
    </div>
  )
}
