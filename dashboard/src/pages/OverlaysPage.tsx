import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { formatGameTime } from '../lib/utils'
import { useSportMode } from '../components/layout/PageShell'

async function placeBetfairRequest(overlay: { market_id?: string; selection?: string; betfair_back?: number | null; sport?: string; home_team?: string; away_team?: string; market?: string }) {
  const { error } = await supabase
    .from('system_config')
    .upsert({
      key: 'place_bet_request',
      value: {
        market_id: overlay.market_id || '',
        selection: overlay.selection || '',
        back_price: overlay.betfair_back || 0,
        stake: 20,
        sport: overlay.sport || '',
        game: `${overlay.away_team} @ ${overlay.home_team}`,
        market: overlay.market || '',
        requested_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    })
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GameOverlay {
  id: number
  sport: string
  sport_label: string
  event_id: string
  home_team: string
  away_team: string
  commence_time: string
  market: string
  selection: string
  line: number | null
  best_odds: number
  best_book: string
  avg_odds: number
  worst_odds: number
  edge_pct: number
  implied_prob: number
  num_bookmakers: number
  betfair_back: number | null
  betfair_lay: number | null
  tier: string
  scan_id: string
  created_at: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const overlaySports = [
  { value: '', label: 'All Sports' },
  { value: 'aussierules_afl', label: 'AFL' },
  { value: 'basketball_nba', label: 'NBA' },
  { value: 'soccer_epl', label: 'EPL' },
  { value: 'soccer_uefa_champions_league', label: 'UCL' },
  { value: 'americanfootball_nfl', label: 'NFL' },
]

const BOOK_NAMES: Record<string, string> = {
  betfair_ex_au: 'Betfair AU',
  sportsbet: 'Sportsbet',
  tab: 'TAB',
  ladbrokes_au: 'Ladbrokes',
  pointsbet_au: 'PointsBet',
  neds: 'Neds',
  unibet_au: 'Unibet',
  bet365_au: 'Bet365',
  bluebet: 'BlueBet',
  topsport: 'TopSport',
  betr_au: 'Betr',
  betright: 'BetRight',
  playup: 'PlayUp',
}

const MARKET_LABELS: Record<string, string> = {
  h2h: 'Head to Head',
  spreads: 'Spreads',
  totals: 'Totals',
}

const TIER_STYLES: Record<string, { bg: string; border: string; text: string; badge: string }> = {
  STRONG: {
    bg: 'bg-emerald-900/20',
    border: 'border-emerald-800/40',
    text: 'text-emerald-400',
    badge: 'bg-emerald-500/20 text-emerald-400 border-emerald-700/50',
  },
  MODERATE: {
    bg: 'bg-amber-900/15',
    border: 'border-amber-800/30',
    text: 'text-amber-400',
    badge: 'bg-amber-500/20 text-amber-400 border-amber-700/50',
  },
  MARGINAL: {
    bg: 'bg-orange-900/15',
    border: 'border-orange-800/30',
    text: 'text-orange-400',
    badge: 'bg-orange-500/20 text-orange-400 border-orange-700/50',
  },
}

function friendlyBook(key: string): string {
  return BOOK_NAMES[key] || key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function marketLabel(key: string): string {
  return MARKET_LABELS[key] || key
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function fetchGameOverlays(sport: string): Promise<GameOverlay[]> {
  let query = supabase
    .from('game_overlays')
    .select('*')
    .order('edge_pct', { ascending: false })

  if (sport) query = query.eq('sport', sport)

  const { data, error } = await query
  if (error) throw error
  return (data || []) as GameOverlay[]
}

async function triggerOverlayScan(sport: string): Promise<void> {
  const { error } = await supabase
    .from('system_config')
    .upsert({
      key: 'overlay_scan_request',
      value: { sport_key: sport || 'all', requested_at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    })

  if (error) throw error
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type SortKey = 'edge_pct' | 'we' | 'best_odds' | 'implied_prob'

function calcWE(o: GameOverlay): number {
  // W.E. = P(win) × odds
  // Use implied_prob (model probability stored as %) and betfair_back
  if (!o.betfair_back || !o.implied_prob) return 0
  const modelProb = o.implied_prob / 100
  // Net of 5% Betfair commission
  const netOdds = (o.betfair_back - 1) * 0.95 + 1
  return modelProb * netOdds
}

const SPORT_MODE_TO_KEY: Record<string, string> = {
  nba: 'basketball_nba',
  afl: 'aussierules_afl',
  soccer: 'soccer_epl',
  racing: '',
}

export function OverlaysPage() {
  const sportMode = useSportMode()
  const [sport, setSport] = useState(SPORT_MODE_TO_KEY[sportMode] || '')
  const [scanning, setScanning] = useState(false)
  const [scanMessage, setScanMessage] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('we')
  const [sortAsc, setSortAsc] = useState(false)
  const [queuedIds, setQueuedIds] = useState<Set<number>>(new Set())

  // Sync sport filter when header tab changes
  useEffect(() => {
    const mapped = SPORT_MODE_TO_KEY[sportMode] || ''
    setSport(mapped)
  }, [sportMode])

  const {
    data: overlays = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['game_overlays', sport],
    queryFn: () => fetchGameOverlays(sport),
    staleTime: 30000,
  })

  const handleScan = async () => {
    try {
      setScanning(true)
      setScanMessage('')
      await triggerOverlayScan(sport)
      const label = sport
        ? overlaySports.find(s => s.value === sport)?.label || sport
        : 'all sports'
      setScanMessage(`Scanning ${label}...`)
      // Poll for results after a delay
      setTimeout(async () => {
        await refetch()
        setScanning(false)
        setScanMessage('Scan complete')
        setTimeout(() => setScanMessage(''), 5000)
      }, 8000)
    } catch (err) {
      console.error('Failed to trigger overlay scan:', err)
      setScanning(false)
      setScanMessage('Scan request failed')
      setTimeout(() => setScanMessage(''), 5000)
    }
  }

  // Summary stats
  const strongCount = overlays.filter(o => o.tier === 'STRONG').length
  const sportsScanned = new Set(overlays.map(o => o.sport_label)).size
  // Best Win Expectation (highest W.E. > 1.0 = best overlay)
  const bestWE = overlays.reduce((best, o) => {
    const we = calcWE(o)
    return we > best ? we : best
  }, 0)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Game Overlays</h1>
          <p className="mt-1 text-sm text-gray-400">
            {overlays.length} overlay{overlays.length !== 1 ? 's' : ''} found
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={sport}
            onChange={e => setSport(e.target.value)}
            disabled={scanning}
            className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-200 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
          >
            {overlaySports.map(s => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <button
            onClick={handleScan}
            disabled={scanning}
            className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {scanning ? (
              <>
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Scanning...
              </>
            ) : (
              'Scan Overlays'
            )}
          </button>
        </div>
      </div>

      {/* Scan Status Message */}
      {scanMessage && (
        <div
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm ${
            scanning
              ? 'border border-amber-700 bg-amber-900/20 text-amber-400'
              : 'border border-emerald-700 bg-emerald-900/20 text-emerald-400'
          }`}
        >
          {scanning && (
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
          {scanMessage}
        </div>
      )}

      {/* Summary Stats */}
      {overlays.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="Total Overlays" value={String(overlays.length)} color="text-cyan-400" />
          <StatCard label="Strong" value={String(strongCount)} color="text-emerald-400" />
          <StatCard label="Best W.E." value={bestWE.toFixed(3)} color={bestWE > 1.05 ? 'text-emerald-400' : bestWE >= 0.92 ? 'text-amber-400' : 'text-red-400'} />
          <StatCard label="Sports Scanned" value={String(sportsScanned)} color="text-purple-400" />
        </div>
      )}

      {/* Loading / Error States */}
      {isLoading && (
        <div className="flex h-48 items-center justify-center rounded-xl border border-gray-800 bg-gray-900 text-sm text-gray-500">
          Loading overlays...
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-800 bg-red-900/20 p-4 text-sm text-red-400">
          Error loading overlays: {(error as Error).message}
        </div>
      )}

      {/* Overlays Table */}
      {!isLoading && !error && overlays.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-800 bg-gray-900">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-xs uppercase text-gray-500">
                <th className="px-4 py-3">Tier</th>
                <th className="px-4 py-3">Game</th>
                <th className="px-4 py-3">Market</th>
                <th className="px-4 py-3">Selection</th>
                <th
                  className="cursor-pointer px-4 py-3 text-right hover:text-cyan-400 transition-colors"
                  onClick={() => { if (sortKey === 'best_odds') setSortAsc(!sortAsc); else { setSortKey('best_odds'); setSortAsc(false) } }}
                >
                  Best Odds{sortKey === 'best_odds' ? (sortAsc ? ' ▲' : ' ▼') : ''}
                </th>
                <th className="px-4 py-3">Bookmaker</th>
                <th className="px-4 py-3 text-right">Avg Odds</th>
                <th className="px-4 py-3 text-right" title="Back/Lay spread percentage - tighter = more liquid">Spread %</th>
                <th
                  className="cursor-pointer px-4 py-3 text-right hover:text-cyan-400 transition-colors"
                  onClick={() => { if (sortKey === 'implied_prob') setSortAsc(!sortAsc); else { setSortKey('implied_prob'); setSortAsc(true) } }}
                >
                  Implied Prob{sortKey === 'implied_prob' ? (sortAsc ? ' ▲' : ' ▼') : ''}
                </th>
                <th
                  className="cursor-pointer px-4 py-3 text-right hover:text-cyan-400 transition-colors"
                  title="Win Expectation = P(win) × odds. >1.0 = overlay, <1.0 = underlay, 0.82-1.0 = marginal. Click to sort."
                  onClick={() => { if (sortKey === 'we') setSortAsc(!sortAsc); else { setSortKey('we'); setSortAsc(false) } }}
                >
                  W.E.{sortKey === 'we' ? (sortAsc ? ' ▲' : ' ▼') : ''}
                </th>
                <th className="px-4 py-3 text-right">Betfair B/L</th>
                <th className="px-4 py-3 text-right">Books</th>
                <th className="px-4 py-3">Start</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {[...overlays].sort((a, b) => {
                let va: number, vb: number
                if (sortKey === 'we') { va = calcWE(a); vb = calcWE(b) }
                else if (sortKey === 'best_odds') { va = a.best_odds; vb = b.best_odds }
                else if (sortKey === 'implied_prob') { va = a.implied_prob; vb = b.implied_prob }
                else { va = a.edge_pct; vb = b.edge_pct }
                return sortAsc ? va - vb : vb - va
              }).map(o => {
                const tierStyle = TIER_STYLES[o.tier] || TIER_STYLES.MARGINAL
                return (
                  <tr
                    key={o.id}
                    className={`border-b border-gray-800/50 ${tierStyle.bg} hover:bg-gray-800/40 transition-colors`}
                  >
                    {/* Tier Badge */}
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${tierStyle.badge}`}
                      >
                        {o.tier}
                      </span>
                    </td>

                    {/* Game Matchup */}
                    <td className="px-4 py-3">
                      <div className="font-medium text-white">
                        {o.home_team} vs {o.away_team}
                      </div>
                      <div className="text-xs text-gray-500">{o.sport_label}</div>
                    </td>

                    {/* Market */}
                    <td className="px-4 py-3 text-gray-300">
                      {marketLabel(o.market)}
                      {o.line !== null && <span className="ml-1 text-gray-500">({o.line > 0 ? '+' : ''}{o.line})</span>}
                    </td>

                    {/* Selection */}
                    <td className="px-4 py-3 font-medium text-gray-200">{o.selection}</td>

                    {/* Best Odds */}
                    <td className="px-4 py-3 text-right font-mono font-bold text-white">{o.best_odds.toFixed(2)}</td>

                    {/* Bookmaker */}
                    <td className="px-4 py-3 text-gray-300">{friendlyBook(o.best_book)}</td>

                    {/* Avg Odds */}
                    <td className="px-4 py-3 text-right font-mono text-gray-400">{o.avg_odds.toFixed(2)}</td>

                    {/* Edge % */}
                    <td className={`px-4 py-3 text-right font-mono font-bold ${tierStyle.text}`}>
                      {o.edge_pct.toFixed(1)}%
                    </td>

                    {/* Implied Prob */}
                    <td className="px-4 py-3 text-right font-mono text-gray-400">
                      {(o.implied_prob).toFixed(1)}%
                    </td>

                    {/* Win Expectation = P(win) × back odds */}
                    <td className="px-4 py-3 text-right font-mono font-bold">
                      {(() => {
                        if (!o.betfair_back || !o.betfair_lay || o.betfair_lay <= 1) return <span className="text-gray-600">&mdash;</span>
                        const trueProb = 1 / o.betfair_lay
                        const we = trueProb * o.betfair_back
                        const color = we > 1.05 ? 'text-emerald-400' : we >= 0.92 ? 'text-amber-400' : 'text-red-400'
                        return <span className={color}>{we.toFixed(3)}</span>
                      })()}
                    </td>

                    {/* Betfair Back/Lay */}
                    <td className="px-4 py-3 text-right font-mono text-gray-400">
                      {o.betfair_back !== null ? (
                        <>
                          <span className="text-blue-400">{o.betfair_back.toFixed(2)}</span>
                          {o.betfair_lay !== null && (
                            <>
                              <span className="mx-0.5 text-gray-600">/</span>
                              <span className="text-red-400">{o.betfair_lay.toFixed(2)}</span>
                            </>
                          )}
                        </>
                      ) : (
                        <span className="text-gray-600">&mdash;</span>
                      )}
                    </td>

                    {/* Num Bookmakers */}
                    <td className="px-4 py-3 text-right text-gray-400">{o.num_bookmakers}</td>

                    {/* Start Time */}
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">
                      {formatGameTime(o.commence_time)}
                    </td>

                    {/* Betfair Action */}
                    <td className="px-4 py-3">
                      {o.betfair_back !== null && (
                        <button
                          onClick={() => {
                            placeBetfairRequest(o).then(() => {
                              setQueuedIds(prev => new Set(prev).add(o.id))
                              setTimeout(() => setQueuedIds(prev => { const next = new Set(prev); next.delete(o.id); return next }), 3000)
                            }).catch(err => alert(`Error: ${err.message}`))
                          }}
                          disabled={queuedIds.has(o.id)}
                          className={`rounded-lg border px-3 py-1 text-xs font-medium transition-colors ${
                            queuedIds.has(o.id)
                              ? 'border-emerald-700 bg-emerald-900/30 text-emerald-400 cursor-default'
                              : 'border-blue-700 bg-blue-900/30 text-blue-400 hover:bg-blue-800/40'
                          }`}
                        >
                          {queuedIds.has(o.id) ? 'Queued' : 'Place $20'}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !error && overlays.length === 0 && (
        <div className="flex h-48 flex-col items-center justify-center rounded-xl border border-gray-800 bg-gray-900 text-sm text-gray-500">
          <p>No overlays found</p>
          <p className="mt-1 text-xs text-gray-600">Select a sport and click Scan Overlays to begin</p>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`mt-1 text-xl font-bold ${color}`}>{value}</p>
    </div>
  )
}
