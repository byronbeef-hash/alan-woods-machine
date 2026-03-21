import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DailyStrategy {
  sport: string
  mode: 'autonomous' | 'manual'
  bankroll: number
  dailyBudget: number
  maxBet: number
  dataSource: string
  minWE: number
  maxBets: number
}

interface BacktestResult {
  month: string
  bets: number
  wins: number
  pnl: number
  roi: number
  bestWE: number
  avgEdge: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SPORT_OPTIONS = [
  { key: 'racing', label: 'Horse Racing', desc: 'AU/NZ thoroughbred racing via Betfair Exchange' },
  { key: 'basketball_nba', label: 'NBA', desc: 'US basketball player props' },
  { key: 'aussierules_afl', label: 'AFL', desc: 'Australian Rules Football' },
  { key: 'soccer_epl', label: 'Soccer', desc: 'EPL, UCL, A-League' },
]

const DATA_SOURCES: Record<string, { label: string; desc: string }> = {
  racing: { label: 'Betfair Exchange', desc: 'Live odds, runner metadata, form, jockey/trainer from Betfair AU' },
  basketball_nba: { label: 'NBA API + Betfair', desc: 'Player stats from NBA.com, odds from Betfair' },
  aussierules_afl: { label: 'Squiggle + Betfair', desc: 'AFL community data + Betfair Exchange' },
  soccer_epl: { label: 'Football-Data + Betfair', desc: 'football-data.org API + Betfair Exchange' },
}

const DEFAULT_STRATEGY: DailyStrategy = {
  sport: 'racing',
  mode: 'autonomous',
  bankroll: 2500,
  dailyBudget: 250,
  maxBet: 100,
  dataSource: 'Betfair Exchange',
  minWE: 1.05,
  maxBets: 8,
}

// ---------------------------------------------------------------------------
// Backtest from real scan_results + bets data
// ---------------------------------------------------------------------------

async function runRealBacktest(sport: string): Promise<BacktestResult[]> {
  // Fetch all historical scan results for this sport
  const { data: scans } = await supabase
    .from('scan_results')
    .select('created_at, edge, model_prob, odds_decimal, status, tier')
    .eq('sport', sport === 'racing' ? 'horse_racing' : sport)
    .order('created_at', { ascending: true })

  // Fetch all settled bets
  const { data: bets } = await supabase
    .from('bets')
    .select('created_at, result, pnl, odds_decimal, bet_size, sport')
    .in('result', ['WIN', 'LOSS'])
    .order('created_at', { ascending: true })

  const allItems = [
    ...(scans || []).map(s => ({
      date: s.created_at,
      edge: s.edge,
      modelProb: s.model_prob,
      odds: s.odds_decimal,
      tier: s.tier,
      source: 'scan' as const,
      pnl: 0,
      win: false,
    })),
    ...(bets || []).map(b => ({
      date: b.created_at,
      edge: 0,
      modelProb: 0,
      odds: b.odds_decimal,
      tier: '',
      source: 'bet' as const,
      pnl: b.pnl || 0,
      win: b.result === 'WIN',
    })),
  ]

  if (allItems.length === 0) return []

  // Group by month
  const byMonth = new Map<string, typeof allItems>()
  for (const item of allItems) {
    const d = new Date(item.date)
    const key = d.toLocaleDateString('en-AU', { month: 'short', year: 'numeric' })
    if (!byMonth.has(key)) byMonth.set(key, [])
    byMonth.get(key)!.push(item)
  }

  const results: BacktestResult[] = []
  for (const [month, items] of byMonth) {
    const betItems = items.filter(i => i.source === 'bet')
    const scanItems = items.filter(i => i.source === 'scan')
    const totalItems = betItems.length + scanItems.length
    const wins = betItems.filter(i => i.win).length
    const pnl = betItems.reduce((s, i) => s + i.pnl, 0)
    const totalStaked = betItems.length * 25 // approximate
    const edges = [...scanItems.map(i => i.edge), ...betItems.map(i => i.edge)].filter(e => e > 0)
    const bestEdge = edges.length > 0 ? Math.max(...edges) : 0

    results.push({
      month,
      bets: totalItems,
      wins,
      pnl: Math.round(pnl * 100) / 100,
      roi: totalStaked > 0 ? Math.round((pnl / totalStaked) * 1000) / 10 : 0,
      bestWE: 1 + bestEdge,
      avgEdge: edges.length > 0 ? edges.reduce((a, b) => a + b, 0) / edges.length * 100 : 0,
    })
  }
  return results
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function triggerDailyScan(strategy: DailyStrategy): Promise<void> {
  const { error } = await supabase
    .from('system_config')
    .upsert({
      key: 'daily_strategy',
      value: {
        ...strategy,
        requested_at: new Date().toISOString(),
        date: new Date().toISOString().slice(0, 10),
      },
      updated_at: new Date().toISOString(),
    })
  if (error) throw error

  // Also trigger the scan
  if (strategy.sport === 'racing') {
    await supabase.from('system_config').upsert({
      key: 'racing_scan_request',
      value: { requested_at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    })
  } else {
    await supabase.from('system_config').upsert({
      key: 'manual_scan_request',
      value: { sport_key: strategy.sport, requested_at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    })
  }
}

async function fetchTodayOverlays(sport: string) {
  // Try racing_overlays first for racing
  if (sport === 'racing') {
    const { data } = await supabase
      .from('racing_overlays')
      .select('*')
      .in('verdict', ['OVERLAY', 'MARGINAL'])
      .order('we_net', { ascending: false })
      .limit(20)
    if (data && data.length > 0) return data
  }

  // Try game_overlays for non-racing sports
  if (sport !== 'racing') {
    const { data } = await supabase
      .from('game_overlays')
      .select('*')
      .eq('sport', sport)
      .gt('edge_pct', 2)
      .order('edge_pct', { ascending: false })
      .limit(20)
    if (data && data.length > 0) return data
  }

  // Fallback: check scan_results table (has NBA data)
  const sportMap: Record<string, string> = {
    racing: 'horse_racing',
    basketball_nba: 'basketball_nba',
    aussierules_afl: 'aussierules_afl',
    soccer_epl: 'soccer_epl',
  }
  const { data: scanData } = await supabase
    .from('scan_results')
    .select('*')
    .eq('sport', sportMap[sport] || sport)
    .in('status', ['ACTIVE', 'PLACED', 'EXPIRED'])
    .order('edge', { ascending: false })
    .limit(20)
  return scanData || []
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function DailyPage() {
  const queryClient = useQueryClient()
  const [strategy, setStrategy] = useState<DailyStrategy>(DEFAULT_STRATEGY)
  const [backtestResults, setBacktestResults] = useState<BacktestResult[] | null>(null)
  const [backtesting, setBacktesting] = useState(false)
  const [scanning, setScanning] = useState(false)

  const { data: overlays } = useQuery({
    queryKey: ['daily_overlays', strategy.sport],
    queryFn: () => fetchTodayOverlays(strategy.sport),
    refetchInterval: 30000,
  })

  const scanMutation = useMutation({
    mutationFn: () => triggerDailyScan(strategy),
    onSuccess: () => {
      setScanning(true)
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['daily_overlays'] })
        setScanning(false)
      }, 10000)
    },
  })

  const runBacktest = async () => {
    setBacktesting(true)
    try {
      const results = await runRealBacktest(strategy.sport)
      setBacktestResults(results)
    } catch (err) {
      console.error('Backtest failed:', err)
      setBacktestResults([])
    } finally {
      setBacktesting(false)
    }
  }

  const update = <K extends keyof DailyStrategy>(key: K, value: DailyStrategy[K]) => {
    setStrategy(prev => ({ ...prev, [key]: value }))
    setBacktestResults(null)
  }

  const sportInfo = SPORT_OPTIONS.find(s => s.key === strategy.sport)
  const dataSource = DATA_SOURCES[strategy.sport]
  const totalBacktestPnl = backtestResults?.reduce((s, r) => s + r.pnl, 0) ?? 0
  const totalBacktestBets = backtestResults?.reduce((s, r) => s + r.bets, 0) ?? 0
  const avgRoi = backtestResults && backtestResults.length > 0
    ? backtestResults.reduce((s, r) => s + r.roi, 0) / backtestResults.length : 0
  const results = overlays || []

  const today = new Date().toLocaleDateString('en-AU', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-white">Daily Strategy</h2>
        <p className="text-xs text-gray-500 mt-0.5">{today}</p>
      </div>

      {/* ---- STRATEGY BUILDER ---- */}
      <div className="rounded-xl border-2 border-cyan-500/30 bg-gray-900 p-6 space-y-6">
        <h3 className="text-sm font-bold text-cyan-400">Today's Setup</h3>

        {/* Sport */}
        <div>
          <label className="text-xs text-gray-400 block mb-2">Focus Sport</label>
          <div className="grid grid-cols-4 gap-2">
            {SPORT_OPTIONS.map(s => (
              <button
                key={s.key}
                onClick={() => update('sport', s.key)}
                className={`rounded-lg p-3 text-left transition-all ${
                  strategy.sport === s.key
                    ? 'bg-cyan-500/15 border-2 border-cyan-500/50'
                    : 'bg-gray-800 border-2 border-gray-700 hover:border-gray-600'
                }`}
              >
                <span className={`text-sm font-bold block ${strategy.sport === s.key ? 'text-cyan-400' : 'text-gray-400'}`}>{s.label}</span>
                <span className="text-[10px] text-gray-600">{s.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Mode */}
        <div>
          <label className="text-xs text-gray-400 block mb-2">Mode</label>
          <div className="grid grid-cols-2 gap-2">
            {(['autonomous', 'manual'] as const).map(m => (
              <button
                key={m}
                onClick={() => update('mode', m)}
                className={`rounded-lg p-3 text-left transition-all ${
                  strategy.mode === m
                    ? 'bg-cyan-500/15 border-2 border-cyan-500/50'
                    : 'bg-gray-800 border-2 border-gray-700 hover:border-gray-600'
                }`}
              >
                <span className={`text-sm font-bold ${strategy.mode === m ? 'text-cyan-400' : 'text-gray-400'}`}>
                  {m === 'autonomous' ? 'Autonomous' : 'Manual'}
                </span>
                <span className="text-[10px] text-gray-600 block mt-0.5">
                  {m === 'autonomous' ? 'System finds and places bets automatically' : 'You review and approve each bet'}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Bankroll + Budget — inline */}
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="text-xs text-gray-400 block mb-1.5">Bankroll</label>
            <div className="flex items-center gap-1">
              <span className="text-gray-500 text-sm">$</span>
              <input
                type="number"
                value={strategy.bankroll}
                onChange={e => update('bankroll', Math.max(100, parseInt(e.target.value) || 0))}
                className="w-full rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-sm font-mono font-bold text-white focus:border-cyan-500 focus:outline-none"
              />
            </div>
            <div className="flex gap-1 mt-1.5">
              {[1000, 2500, 5000, 10000].map(v => (
                <button key={v} onClick={() => update('bankroll', v)}
                  className={`rounded px-1.5 py-0.5 text-[10px] font-mono ${strategy.bankroll === v ? 'bg-cyan-600 text-white' : 'bg-gray-800 text-gray-500 hover:bg-gray-700'}`}
                >${v.toLocaleString()}</button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-400 block mb-1.5">Daily Budget</label>
            <div className="flex items-center gap-1">
              <span className="text-gray-500 text-sm">$</span>
              <input
                type="number"
                value={strategy.dailyBudget}
                onChange={e => update('dailyBudget', Math.max(10, parseInt(e.target.value) || 0))}
                className="w-full rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-sm font-mono font-bold text-white focus:border-cyan-500 focus:outline-none"
              />
            </div>
            <p className="text-[10px] text-gray-600 mt-1">{((strategy.dailyBudget / strategy.bankroll) * 100).toFixed(1)}% of bankroll</p>
          </div>

          <div>
            <label className="text-xs text-gray-400 block mb-1.5">Max Per Bet</label>
            <div className="flex items-center gap-1">
              <span className="text-gray-500 text-sm">$</span>
              <input
                type="number"
                value={strategy.maxBet}
                onChange={e => update('maxBet', Math.max(5, parseInt(e.target.value) || 0))}
                className="w-full rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-sm font-mono font-bold text-white focus:border-cyan-500 focus:outline-none"
              />
            </div>
            <div className="flex gap-1 mt-1.5">
              {[25, 50, 100, 200].map(v => (
                <button key={v} onClick={() => update('maxBet', v)}
                  className={`rounded px-1.5 py-0.5 text-[10px] font-mono ${strategy.maxBet === v ? 'bg-cyan-600 text-white' : 'bg-gray-800 text-gray-500 hover:bg-gray-700'}`}
                >${v}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Max bets + Min W.E. */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-gray-400 block mb-1.5">Max Bets Today</label>
            <div className="flex gap-1.5">
              {[4, 6, 8, 10, 15, 20].map(n => (
                <button
                  key={n}
                  onClick={() => update('maxBets', n)}
                  className={`rounded-lg px-3 py-2 text-xs font-bold transition-colors ${
                    strategy.maxBets === n ? 'bg-cyan-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                  }`}
                >{n}</button>
              ))}
            </div>
          </div>

          {strategy.sport === 'racing' && (
            <div>
              <label className="text-xs text-gray-400 block mb-1.5">Min W.E. Threshold</label>
              <div className="flex gap-1.5">
                {[1.02, 1.05, 1.08, 1.10, 1.15].map(we => (
                  <button
                    key={we}
                    onClick={() => update('minWE', we)}
                    className={`rounded-lg px-3 py-2 text-xs font-mono font-bold transition-colors ${
                      strategy.minWE === we ? 'bg-cyan-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                    }`}
                  >{we.toFixed(2)}</button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Data source (read-only, auto-set by sport) */}
        <div className="rounded-lg bg-gray-800/50 border border-gray-700 p-3 flex items-center justify-between">
          <div>
            <span className="text-[10px] text-gray-500 block">Data Source</span>
            <span className="text-xs text-white font-medium">{dataSource?.label}</span>
            <span className="text-[10px] text-gray-600 block">{dataSource?.desc}</span>
          </div>
          <span className="rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 px-2 py-0.5 text-[10px] font-bold">LIVE</span>
        </div>

        {/* Summary + Actions */}
        <div className="rounded-lg bg-cyan-500/10 border border-cyan-500/30 p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-xs text-cyan-400 font-bold">
                {sportInfo?.label} / {strategy.mode === 'autonomous' ? 'Autonomous' : 'Manual'} / ${strategy.dailyBudget} budget / up to {strategy.maxBets} bets
              </p>
              <p className="text-[10px] text-gray-500 mt-0.5">
                Max exposure: ${strategy.maxBets * strategy.maxBet} | Kelly-sized within ${strategy.maxBet}/bet cap
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => scanMutation.mutate()}
              disabled={scanning || scanMutation.isPending}
              className="flex-1 rounded-lg bg-cyan-600 py-3 text-sm font-bold text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
            >
              {scanning ? 'Scanning...' : results.length > 0 ? 'Re-Scan Markets' : 'Scan & Find Bets'}
            </button>

            <button
              onClick={runBacktest}
              disabled={backtesting}
              className="flex-1 rounded-lg bg-gray-700 py-3 text-sm font-bold text-white transition-colors hover:bg-gray-600 disabled:opacity-50"
            >
              {backtesting ? 'Analysing Historical Data...' : 'Backtest History'}
            </button>
          </div>
        </div>
      </div>

      {/* ---- BACKTEST RESULTS ---- */}
      {backtestResults && (
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white">Historical Backtest Results</h3>
            <span className="text-[10px] text-gray-500">{sportInfo?.label} / {strategy.mode} / ${strategy.dailyBudget}/day</span>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-4 gap-3">
            <div className="rounded-lg bg-gray-800 p-3">
              <span className="text-[10px] text-gray-500 block">Total P&L</span>
              <span className={`text-xl font-mono font-bold ${totalBacktestPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {totalBacktestPnl >= 0 ? '+' : ''}${totalBacktestPnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
            </div>
            <div className="rounded-lg bg-gray-800 p-3">
              <span className="text-[10px] text-gray-500 block">Avg Monthly ROI</span>
              <span className={`text-xl font-mono font-bold ${avgRoi >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {avgRoi >= 0 ? '+' : ''}{avgRoi.toFixed(1)}%
              </span>
            </div>
            <div className="rounded-lg bg-gray-800 p-3">
              <span className="text-[10px] text-gray-500 block">Total Bets</span>
              <span className="text-xl font-mono font-bold text-white">{totalBacktestBets.toLocaleString()}</span>
            </div>
            <div className="rounded-lg bg-gray-800 p-3">
              <span className="text-[10px] text-gray-500 block">Win Rate</span>
              <span className="text-xl font-mono font-bold text-white">
                {backtestResults.length > 0
                  ? ((backtestResults.reduce((s, r) => s + r.wins, 0) / totalBacktestBets) * 100).toFixed(1)
                  : 0}%
              </span>
            </div>
          </div>

          {/* Monthly table */}
          <div className="overflow-hidden rounded-lg border border-gray-800">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-800/50 text-gray-500">
                  <th className="px-3 py-2 text-left font-medium">Month</th>
                  <th className="px-3 py-2 text-right font-medium">Bets</th>
                  <th className="px-3 py-2 text-right font-medium">Wins</th>
                  <th className="px-3 py-2 text-right font-medium">Win %</th>
                  <th className="px-3 py-2 text-right font-medium">P&L</th>
                  <th className="px-3 py-2 text-right font-medium">ROI</th>
                  <th className="px-3 py-2 text-right font-medium">Best W.E.</th>
                  <th className="px-3 py-2 text-right font-medium">Avg Edge</th>
                </tr>
              </thead>
              <tbody>
                {backtestResults.map((r, i) => (
                  <tr key={i} className="border-t border-gray-800/50 hover:bg-gray-800/30">
                    <td className="px-3 py-2 text-gray-300 font-medium">{r.month}</td>
                    <td className="px-3 py-2 text-right font-mono text-gray-400">{r.bets}</td>
                    <td className="px-3 py-2 text-right font-mono text-gray-400">{r.wins}</td>
                    <td className="px-3 py-2 text-right font-mono text-gray-400">{r.bets > 0 ? ((r.wins / r.bets) * 100).toFixed(1) : 0}%</td>
                    <td className={`px-3 py-2 text-right font-mono font-bold ${r.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {r.pnl >= 0 ? '+' : ''}${r.pnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </td>
                    <td className={`px-3 py-2 text-right font-mono font-bold ${r.roi >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {r.roi >= 0 ? '+' : ''}{r.roi.toFixed(1)}%
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-cyan-400">{r.bestWE.toFixed(3)}</td>
                    <td className="px-3 py-2 text-right font-mono text-gray-400">{r.avgEdge.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Cumulative P&L bar */}
          <div>
            <span className="text-[10px] text-gray-500 block mb-2">Cumulative P&L</span>
            <div className="flex items-end gap-1 h-20">
              {(() => {
                let cum = 0
                const points = backtestResults.map(r => { cum += r.pnl; return cum })
                const maxAbs = Math.max(...points.map(Math.abs), 1)
                return points.map((p, i) => (
                  <div key={i} className="flex-1 flex flex-col justify-end items-center">
                    <div
                      className={`w-full rounded-sm ${p >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`}
                      style={{ height: `${Math.max(2, (Math.abs(p) / maxAbs) * 64)}px` }}
                    />
                    <span className="text-[8px] text-gray-600 mt-1">{backtestResults[i].month.slice(0, 3)}</span>
                  </div>
                ))
              })()}
            </div>
          </div>

          <div className={`rounded-lg p-3 ${backtestResults.length > 0 ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-amber-500/10 border border-amber-500/30'}`}>
            <p className={`text-xs ${backtestResults.length > 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
              {backtestResults.length > 0 ? (
                <>
                  Based on {totalBacktestBets} real scans and bets for {sportInfo?.label}, the model has
                  {totalBacktestPnl >= 0 ? ' generated' : ' lost'}
                  {' '}${Math.abs(totalBacktestPnl).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  {avgRoi !== 0 ? ` (${avgRoi >= 0 ? '+' : ''}${avgRoi.toFixed(1)}% avg ROI)` : ''}.
                  {totalBacktestPnl > 0 ? ' Model shows positive expected value.' : ' More data needed for reliable results.'}
                </>
              ) : (
                'No historical data found for this sport. Run scans and place bets to build backtesting history.'
              )}
            </p>
          </div>
        </div>
      )}

      {/* ---- TODAY'S SCAN RESULTS ---- */}
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white">Today's Opportunities</h3>
          <span className="text-[10px] text-gray-500">{results.length} found</span>
        </div>

        {results.length === 0 ? (
          <div className="text-center py-8 text-sm text-gray-500">
            {scanning ? 'Scanning markets...' : 'No overlay bets found. Click "Scan & Find Bets" to search, or wait for the runner to complete a scan.'}
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-800">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-800/50 text-gray-500">
                  <th className="px-3 py-2 text-left font-medium">Selection</th>
                  <th className="px-3 py-2 text-left font-medium">Market / Race</th>
                  <th className="px-3 py-2 text-right font-medium">Odds</th>
                  <th className="px-3 py-2 text-right font-medium">Edge</th>
                  <th className="px-3 py-2 text-right font-medium">Model %</th>
                  <th className="px-3 py-2 text-center font-medium">Tier</th>
                  <th className="px-3 py-2 text-center font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Kelly %</th>
                </tr>
              </thead>
              <tbody>
                {results.slice(0, strategy.maxBets).map((r: Record<string, unknown>, i: number) => {
                  // Handle both racing_overlays and scan_results field names
                  const name = (r.name as string) || (r.player as string) || (r.selection as string) || '—'
                  const market = (r.race as string) || (r.market as string) || (r.game_description as string) || '—'
                  const odds = (r.back_price as number) || (r.odds_decimal as number) || 0
                  const edge = ((r.edge as number) || (r.edge_pct as number) || 0)
                  const edgePct = edge < 1 ? edge * 100 : edge
                  const modelProb = ((r.model_prob as number) || (r.implied_prob as number) || 0)
                  const modelPct = modelProb < 1 ? modelProb * 100 : modelProb
                  const tier = (r.tier as string) || '—'
                  const verdict = (r.verdict as string) || (r.status as string) || '—'
                  const kellyPct = (r.kelly_pct as number) || 0
                  const side = (r.side as string) || ''
                  const line = (r.line as number) || 0
                  const stat = (r.stat as string) || ''

                  return (
                    <tr key={i} className="border-t border-gray-800/50 hover:bg-gray-800/30">
                      <td className="px-3 py-2">
                        <span className="text-white font-medium">{name}</span>
                        {stat && <span className="text-gray-500 text-[10px] ml-1">{stat}</span>}
                      </td>
                      <td className="px-3 py-2 text-gray-400">
                        {side && line ? `${side} ${line} — ` : ''}{market}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-white">{odds > 0 ? odds.toFixed(2) : '—'}</td>
                      <td className="px-3 py-2 text-right font-mono text-emerald-400">+{edgePct.toFixed(1)}%</td>
                      <td className="px-3 py-2 text-right font-mono text-cyan-400">{modelPct.toFixed(1)}%</td>
                      <td className="px-3 py-2 text-center">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          tier === 'STRONG' ? 'bg-emerald-500/20 text-emerald-400' :
                          tier === 'MODERATE' ? 'bg-cyan-500/20 text-cyan-400' :
                          'bg-amber-500/20 text-amber-400'
                        }`}>{tier}</span>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          verdict === 'OVERLAY' || verdict === 'ACTIVE' ? 'bg-emerald-500/20 text-emerald-400' :
                          verdict === 'PLACED' ? 'bg-cyan-500/20 text-cyan-400' :
                          verdict === 'EXPIRED' ? 'bg-gray-500/20 text-gray-400' :
                          'bg-amber-500/20 text-amber-400'
                        }`}>{verdict}</span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-gray-400">{kellyPct > 0 ? `${kellyPct}%` : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
