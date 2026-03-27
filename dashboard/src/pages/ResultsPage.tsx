import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Bet } from '../lib/types'

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function fetchSettledBets(): Promise<Bet[]> {
  const { data, error } = await supabase
    .from('bets')
    .select('*')
    .in('result', ['WIN', 'LOSS'])
    .order('settled_at', { ascending: false })
  if (error) throw error
  return (data || []) as Bet[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type RangePreset = '7d' | '14d' | '30d' | '90d' | 'all' | 'custom'

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('en-AU', {
      day: 'numeric', month: 'short', year: 'numeric',
      timeZone: 'Australia/Sydney',
    })
  } catch { return iso.slice(0, 10) }
}

function formatCurrency(n: number): string {
  const sign = n >= 0 ? '+' : ''
  return `${sign}$${Math.abs(n).toFixed(2)}`
}

// ---------------------------------------------------------------------------
// Results Page
// ---------------------------------------------------------------------------

export function ResultsPage() {
  const [rangePreset, setRangePreset] = useState<RangePreset>('30d')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [sportFilter, setSportFilter] = useState<string>('all')

  const { data: allBets, isLoading } = useQuery({
    queryKey: ['results_settled_bets'],
    queryFn: fetchSettledBets,
    refetchInterval: 300000,
  })

  const filteredBets = useMemo(() => {
    if (!allBets) return []
    let bets = allBets

    // Date filter
    let fromDate: string | null = null
    let toDate: string | null = null

    if (rangePreset === '7d') fromDate = daysAgo(7)
    else if (rangePreset === '14d') fromDate = daysAgo(14)
    else if (rangePreset === '30d') fromDate = daysAgo(30)
    else if (rangePreset === '90d') fromDate = daysAgo(90)
    else if (rangePreset === 'custom') {
      fromDate = customFrom || null
      toDate = customTo || null
    }

    if (fromDate) {
      bets = bets.filter(b => {
        const d = (b.settled_at || b.created_at).slice(0, 10)
        return d >= fromDate!
      })
    }
    if (toDate) {
      bets = bets.filter(b => {
        const d = (b.settled_at || b.created_at).slice(0, 10)
        return d <= toDate!
      })
    }

    // Sport filter
    if (sportFilter !== 'all') {
      bets = bets.filter(b => b.sport === sportFilter)
    }

    return bets
  }, [allBets, rangePreset, customFrom, customTo, sportFilter])

  // Stats
  const stats = useMemo(() => {
    const wins = filteredBets.filter(b => b.result === 'WIN')
    const losses = filteredBets.filter(b => b.result === 'LOSS')
    const totalPnl = filteredBets.reduce((s, b) => s + (b.pnl ?? 0), 0)
    const totalStaked = filteredBets.reduce((s, b) => s + (b.bet_size ?? 0), 0)
    const winRate = filteredBets.length > 0 ? (wins.length / filteredBets.length) * 100 : 0
    const roi = totalStaked > 0 ? (totalPnl / totalStaked) * 100 : 0
    const avgEdge = filteredBets.length > 0
      ? filteredBets.reduce((s, b) => s + (b.edge ?? 0), 0) / filteredBets.length * 100
      : 0

    // Expected winnings based on model probability
    const expectedPnl = filteredBets.reduce((s, b) => {
      if (!b.model_prob || !b.bet_size || !b.odds_decimal) return s
      const netOdds = (b.odds_decimal - 1) * (1 - (b.commission_rate ?? 0.05)) + 1
      const ev = b.bet_size * (b.model_prob * netOdds - 1)
      return s + ev
    }, 0)

    // Daily breakdown
    const byDay: Record<string, { pnl: number; bets: number; wins: number }> = {}
    for (const b of filteredBets) {
      const day = (b.settled_at || b.created_at).slice(0, 10)
      if (!byDay[day]) byDay[day] = { pnl: 0, bets: 0, wins: 0 }
      byDay[day].pnl += b.pnl ?? 0
      byDay[day].bets++
      if (b.result === 'WIN') byDay[day].wins++
    }
    const dailyBreakdown = Object.entries(byDay)
      .sort(([a], [b]) => b.localeCompare(a))

    return { wins: wins.length, losses: losses.length, totalPnl, totalStaked, winRate, roi, avgEdge, expectedPnl, dailyBreakdown }
  }, [filteredBets])

  // Sports for filter dropdown
  const availableSports = useMemo(() => {
    if (!allBets) return []
    const sports = new Set(allBets.map(b => b.sport).filter(Boolean))
    return Array.from(sports) as string[]
  }, [allBets])

  const presets: { key: RangePreset; label: string }[] = [
    { key: '7d', label: '7 Days' },
    { key: '14d', label: '14 Days' },
    { key: '30d', label: '30 Days' },
    { key: '90d', label: '90 Days' },
    { key: 'all', label: 'All Time' },
    { key: 'custom', label: 'Custom' },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-white">Results</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Estimated vs actual winnings. Filter by date range or sport.
        </p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Date range presets */}
        <div className="flex items-center gap-1">
          {presets.map(p => (
            <button
              key={p.key}
              onClick={() => setRangePreset(p.key)}
              className={`rounded px-3 py-1.5 text-xs font-bold transition-colors ${
                rangePreset === p.key
                  ? 'bg-emerald-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >{p.label}</button>
          ))}
        </div>

        {/* Custom date inputs */}
        {rangePreset === 'custom' && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={customFrom}
              onChange={e => setCustomFrom(e.target.value)}
              className="rounded border border-gray-600 bg-gray-800 px-2 py-1 text-xs text-white focus:border-emerald-500 focus:outline-none"
            />
            <span className="text-gray-500 text-xs">to</span>
            <input
              type="date"
              value={customTo}
              onChange={e => setCustomTo(e.target.value)}
              className="rounded border border-gray-600 bg-gray-800 px-2 py-1 text-xs text-white focus:border-emerald-500 focus:outline-none"
            />
          </div>
        )}

        {/* Sport filter */}
        <select
          value={sportFilter}
          onChange={e => setSportFilter(e.target.value)}
          className="rounded border border-gray-600 bg-gray-800 px-3 py-1.5 text-xs text-white focus:border-emerald-500 focus:outline-none"
        >
          <option value="all">All Sports</option>
          {availableSports.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <span className="text-xs text-gray-500 ml-auto">
          {filteredBets.length} settled bets
        </span>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
          <p className="text-[10px] text-gray-500">Actual P&L</p>
          <p className={`text-2xl font-bold font-mono ${stats.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {formatCurrency(stats.totalPnl)}
          </p>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
          <p className="text-[10px] text-gray-500">Expected P&L (Model)</p>
          <p className={`text-2xl font-bold font-mono ${stats.expectedPnl >= 0 ? 'text-cyan-400' : 'text-amber-400'}`}>
            {formatCurrency(stats.expectedPnl)}
          </p>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
          <p className="text-[10px] text-gray-500">Win Rate</p>
          <p className="text-2xl font-bold font-mono text-white">
            {stats.winRate.toFixed(1)}%
          </p>
          <p className="text-[10px] text-gray-600">{stats.wins}W / {stats.losses}L</p>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
          <p className="text-[10px] text-gray-500">ROI</p>
          <p className={`text-2xl font-bold font-mono ${stats.roi >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {stats.roi.toFixed(1)}%
          </p>
          <p className="text-[10px] text-gray-600">on ${stats.totalStaked.toFixed(0)} staked</p>
        </div>
      </div>

      {/* Actual vs Expected comparison */}
      {filteredBets.length > 0 && (
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
          <h3 className="text-sm font-bold text-white mb-3">Actual vs Expected</h3>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-500">Actual</span>
                <span className={`text-sm font-mono font-bold ${stats.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {formatCurrency(stats.totalPnl)}
                </span>
              </div>
              <div className="h-3 rounded-full bg-gray-800 overflow-hidden">
                <div
                  className={`h-full rounded-full ${stats.totalPnl >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`}
                  style={{ width: `${Math.min(100, Math.abs(stats.totalPnl) / Math.max(Math.abs(stats.totalPnl), Math.abs(stats.expectedPnl), 1) * 100)}%` }}
                />
              </div>
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-500">Expected</span>
                <span className={`text-sm font-mono font-bold ${stats.expectedPnl >= 0 ? 'text-cyan-400' : 'text-amber-400'}`}>
                  {formatCurrency(stats.expectedPnl)}
                </span>
              </div>
              <div className="h-3 rounded-full bg-gray-800 overflow-hidden">
                <div
                  className={`h-full rounded-full ${stats.expectedPnl >= 0 ? 'bg-cyan-500' : 'bg-amber-500'}`}
                  style={{ width: `${Math.min(100, Math.abs(stats.expectedPnl) / Math.max(Math.abs(stats.totalPnl), Math.abs(stats.expectedPnl), 1) * 100)}%` }}
                />
              </div>
            </div>
          </div>
          <p className="text-[10px] text-gray-600 mt-2">
            {stats.totalPnl > stats.expectedPnl
              ? `Running ${formatCurrency(stats.totalPnl - stats.expectedPnl)} above expected — positive variance.`
              : stats.totalPnl < stats.expectedPnl
              ? `Running ${formatCurrency(stats.expectedPnl - stats.totalPnl)} below expected — negative variance (normal short-term).`
              : 'Tracking expected value exactly.'}
          </p>
        </div>
      )}

      {/* Daily Breakdown */}
      {stats.dailyBreakdown.length > 0 && (
        <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-800">
            <h3 className="text-sm font-bold text-white">Daily Breakdown</h3>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-800 text-gray-500">
                <th className="px-4 py-2 text-left font-medium">Date</th>
                <th className="px-4 py-2 text-right font-medium">Bets</th>
                <th className="px-4 py-2 text-right font-medium">Wins</th>
                <th className="px-4 py-2 text-right font-medium">Win Rate</th>
                <th className="px-4 py-2 text-right font-medium">P&L</th>
                <th className="px-4 py-2 text-right font-medium">Cumulative</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                let cumulative = 0
                // Show in chronological order for cumulative
                const sorted = [...stats.dailyBreakdown].reverse()
                return sorted.map(([day, d]) => {
                  cumulative += d.pnl
                  return (
                    <tr key={day} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                      <td className="px-4 py-2 text-gray-300">{formatDate(day)}</td>
                      <td className="px-4 py-2 text-right font-mono text-gray-400">{d.bets}</td>
                      <td className="px-4 py-2 text-right font-mono text-gray-400">{d.wins}</td>
                      <td className="px-4 py-2 text-right font-mono text-gray-400">
                        {d.bets > 0 ? ((d.wins / d.bets) * 100).toFixed(0) : 0}%
                      </td>
                      <td className={`px-4 py-2 text-right font-mono font-bold ${d.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {formatCurrency(d.pnl)}
                      </td>
                      <td className={`px-4 py-2 text-right font-mono font-bold ${cumulative >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {formatCurrency(cumulative)}
                      </td>
                    </tr>
                  )
                }).reverse() // Display newest first
              })()}
            </tbody>
          </table>
        </div>
      )}

      {/* Individual Bets */}
      {isLoading ? (
        <div className="flex h-32 items-center justify-center text-sm text-gray-500">Loading results...</div>
      ) : filteredBets.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-xl border border-gray-800 bg-gray-900 text-sm text-gray-500">
          No settled bets for this period
        </div>
      ) : (
        <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-800">
            <h3 className="text-sm font-bold text-white">All Settled Bets</h3>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-800 text-gray-500">
                <th className="px-4 py-2 text-left font-medium">Date</th>
                <th className="px-4 py-2 text-left font-medium">Selection</th>
                <th className="px-4 py-2 text-left font-medium">Market</th>
                <th className="px-4 py-2 text-right font-medium">Odds</th>
                <th className="px-4 py-2 text-right font-medium">Edge</th>
                <th className="px-4 py-2 text-right font-medium">Stake</th>
                <th className="px-4 py-2 text-center font-medium">Result</th>
                <th className="px-4 py-2 text-right font-medium">P&L</th>
              </tr>
            </thead>
            <tbody>
              {filteredBets.map(b => (
                <tr key={b.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                  <td className="px-4 py-2 text-gray-400">{formatDate(b.settled_at || b.created_at)}</td>
                  <td className="px-4 py-2 text-white font-medium">{b.player}</td>
                  <td className="px-4 py-2 text-gray-400">{b.market}</td>
                  <td className="px-4 py-2 text-right font-mono text-gray-300">{b.odds_decimal?.toFixed(2) ?? '—'}</td>
                  <td className="px-4 py-2 text-right font-mono text-emerald-400">
                    {b.edge != null ? `+${(b.edge * 100).toFixed(1)}%` : '—'}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-gray-300">${b.bet_size?.toFixed(0) ?? '—'}</td>
                  <td className="px-4 py-2 text-center">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      b.result === 'WIN'
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : 'bg-red-500/20 text-red-400'
                    }`}>{b.result}</span>
                  </td>
                  <td className={`px-4 py-2 text-right font-mono font-bold ${(b.pnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {b.pnl != null ? formatCurrency(b.pnl) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer */}
      <div className="text-[10px] text-gray-600 leading-relaxed">
        Expected P&L uses model probability and net odds (after Betfair 5% commission). Variance between actual and expected is normal in the short term.
        Long-term convergence validates model accuracy.
      </div>
    </div>
  )
}
