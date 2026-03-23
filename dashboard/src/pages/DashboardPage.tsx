import { useQuery } from '@tanstack/react-query'
import { useAllBets, useRealtimeBets } from '../hooks/useBets'
import { fetchSystemConfig } from '../lib/queries'
import { supabase } from '../lib/supabase'
import { KPICards } from '../components/dashboard/KPICards'
import { BankrollChart } from '../components/dashboard/BankrollChart'
import { RecentBets } from '../components/dashboard/RecentBets'
import { TierBreakdown } from '../components/dashboard/TierBreakdown'
import { ActivityLog } from '../components/dashboard/ActivityLog'
import { LoadingSpinner } from '../components/common/LoadingSpinner'
import { useViewMode, useSportMode } from '../components/layout/PageShell'

interface LiveBet {
  player: string
  market: string
  selection: string
  odds: number
  stake: number
  matched: number
  unmatched: number
  potential_profit: number
  game: string
  bet_id: string
  status: string
  race_time: string
}

interface TopOverlay {
  id: number
  selection: string
  market: string
  sport_label: string
  home_team: string
  away_team: string
  betfair_back: number | null
  betfair_lay: number | null
  edge_pct: number
  implied_prob: number
  tier: string
  commence_time: string
}

const SPORT_MODE_TO_KEY: Record<string, string> = {
  nba: 'basketball_nba',
  afl: 'aussierules_afl',
  soccer: 'soccer_epl',
  racing: 'racing',
}

async function fetchTopOverlays(sportKey: string): Promise<TopOverlay[]> {
  if (sportKey === 'racing') {
    const { data, error } = await supabase
      .from('racing_overlays')
      .select('*')
      .eq('verdict', 'OVERLAY')
      .order('we_net', { ascending: false })
      .limit(8)
    if (error) throw error
    return ((data || []) as Record<string, unknown>[]).map(r => ({
      id: r.id as number,
      selection: (r.name as string) || '',
      market: (r.race as string) || '',
      sport_label: 'Racing',
      home_team: (r.meeting as string) || '',
      away_team: '',
      betfair_back: (r.back_price as number) || null,
      betfair_lay: (r.lay_price as number) || null,
      edge_pct: ((r.edge as number) || 0) * 100,
      implied_prob: ((r.model_prob as number) || 0) * 100,
      tier: (r.tier as string) || '',
      commence_time: (r.start_time as string) || '',
    })) as TopOverlay[]
  }

  let query = supabase
    .from('game_overlays')
    .select('*')
    .gt('edge_pct', 2)
    .order('edge_pct', { ascending: false })
    .limit(8)
  if (sportKey) query = query.eq('sport', sportKey)
  const { data, error } = await query
  if (error) throw error
  return (data as TopOverlay[]) || []
}

function WEBadge({ back, implied }: { back: number; implied: number }) {
  if (!back || !implied) return <span className="text-gray-600">—</span>
  const trueProb = implied / 100
  const weNet = trueProb * ((back - 1) * 0.95 + 1)
  const color = weNet > 1.05 ? 'text-emerald-400' : weNet > 0.92 ? 'text-amber-400' : 'text-red-400'
  return <span className={`font-mono font-bold ${color}`}>{weNet.toFixed(3)}</span>
}

function formatTime(iso: string) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('en-AU', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
      timeZone: 'Australia/Brisbane',
    })
  } catch { return iso.slice(0, 16) }
}

async function fetchLiveBets(): Promise<LiveBet[]> {
  const { data, error } = await supabase
    .from('bets')
    .select('*')
    .eq('result', 'PENDING')
    .order('created_at', { ascending: false })
  if (error || !data || data.length === 0) return []

  // Look up race times from racing_overlays
  const playerNames = data.map(b => b.player).filter(Boolean)
  const { data: overlays } = await supabase
    .from('racing_overlays')
    .select('name, start_time')
    .in('name', playerNames)

  const timeMap: Record<string, string> = {}
  for (const o of overlays || []) {
    if (o.start_time) timeMap[o.name] = o.start_time
  }

  return data.map(b => ({
    player: b.player || '—',
    market: b.market || '—',
    selection: `${b.stat} ${b.side} ${b.line || ''}`.trim(),
    odds: b.odds_decimal || 0,
    stake: b.bet_size || 0,
    matched: b.bet_size || 0,
    unmatched: 0,
    potential_profit: (b.bet_size || 0) * ((b.odds_decimal || 1) - 1) * 0.95,
    game: b.market || '—',
    bet_id: String(b.id),
    status: 'MATCHED',
    race_time: timeMap[b.player] || b.created_at || '',
  }))
}

export function DashboardPage() {
  const { data: bets, isLoading, error } = useAllBets()
  useViewMode() // sync mode
  const sportMode = useSportMode()
  const sportKey = SPORT_MODE_TO_KEY[sportMode] || ''
  useRealtimeBets()

  const { data: config } = useQuery({
    queryKey: ['system-config'],
    queryFn: fetchSystemConfig,
  })

  const { data: topOverlays } = useQuery({
    queryKey: ['top_overlays', sportKey],
    queryFn: () => fetchTopOverlays(sportKey),
    refetchInterval: 60000,
  })

  const { data: liveBetsData } = useQuery({
    queryKey: ['live_betfair_bets'],
    queryFn: fetchLiveBets,
    refetchInterval: 60000, // Check every 60 seconds
  })

  if (isLoading) return <LoadingSpinner />
  if (error) return <div className="text-red-400">Error loading data: {error.message}</div>

  const rawBets = bets || []
  const allBets = rawBets
  const isDemo = !config || (config['woods_mode'] as string) !== 'live'

  const overlays = topOverlays || []
  const LIVE_BETS = liveBetsData || []

  return (
    <div className="space-y-6">
      {isDemo && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-center">
          <span className="text-sm font-bold tracking-wide text-emerald-400">DEMO MODE</span>
          <span className="ml-2 text-xs text-emerald-400/70">Paper trading only — no real money at risk</span>
        </div>
      )}

      <h2 className="text-xl font-bold text-white">Dashboard</h2>

      <KPICards bets={allBets} />

      {/* Live Betfair Bets */}
      {LIVE_BETS.length > 0 && (
        <div className="rounded-xl border-2 border-cyan-500/30 bg-gray-900 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-white">Live Betfair Bets</h3>
            <span className="text-xs text-cyan-400">{LIVE_BETS.length} active bets — ${LIVE_BETS.reduce((s, b) => s + b.stake, 0)} staked</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-gray-300">
              <thead className="border-b border-gray-800 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="px-3 py-2">Player</th>
                  <th className="px-3 py-2">Bet</th>
                  <th className="px-3 py-2">Game</th>
                  <th className="px-3 py-2">Odds</th>
                  <th className="px-3 py-2">Stake</th>
                  <th className="px-3 py-2">Matched</th>
                  <th className="px-3 py-2">Unmatched</th>
                  <th className="px-3 py-2">Match %</th>
                  <th className="px-3 py-2">Potential Win</th>
                  <th className="px-3 py-2">Race Time (QLD)</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {LIVE_BETS.map((bet, i) => {
                  const matchPct = (bet.matched / bet.stake) * 100
                  return (
                    <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                      <td className="px-3 py-3 font-semibold text-white">{bet.player}</td>
                      <td className="px-3 py-3 text-cyan-400">{bet.selection}</td>
                      <td className="px-3 py-3 text-gray-400">{bet.game}</td>
                      <td className="px-3 py-3 font-mono font-bold text-white">{bet.odds.toFixed(2)}</td>
                      <td className="px-3 py-3 font-mono">${bet.stake}</td>
                      <td className="px-3 py-3 font-mono text-emerald-400">${bet.matched.toFixed(2)}</td>
                      <td className="px-3 py-3 font-mono text-amber-400">
                        {bet.unmatched > 0 ? `$${bet.unmatched.toFixed(2)}` : '—'}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 rounded-full bg-gray-700">
                            <div
                              className={`h-1.5 rounded-full ${matchPct === 100 ? 'bg-emerald-500' : 'bg-amber-500'}`}
                              style={{ width: `${matchPct}%` }}
                            />
                          </div>
                          <span className="text-[10px] font-mono">{matchPct.toFixed(0)}%</span>
                        </div>
                      </td>
                      <td className="px-3 py-3 font-mono text-emerald-400">
                        +${(bet.matched * (bet.odds - 1) * 0.95).toFixed(2)}
                      </td>
                      <td className="px-3 py-3 text-[10px] text-gray-400">
                        {bet.race_time ? formatTime(bet.race_time) : '—'}
                      </td>
                      <td className="px-3 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          bet.status === 'MATCHED'
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                            : 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                        }`}>
                          {bet.status === 'MATCHED' ? 'Fully Matched' : 'Partial'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center justify-between p-3 rounded-lg bg-gray-800">
            <div className="flex gap-6">
              <div>
                <span className="text-[10px] text-gray-500">Total Staked</span>
                <p className="text-sm font-mono font-bold text-white">
                  ${LIVE_BETS.reduce((s, b) => s + b.matched, 0).toFixed(2)}
                </p>
              </div>
              <div>
                <span className="text-[10px] text-gray-500">Potential Return</span>
                <p className="text-sm font-mono font-bold text-emerald-400">
                  +${LIVE_BETS.reduce((s, b) => s + b.matched * (b.odds - 1) * 0.95, 0).toFixed(2)}
                </p>
              </div>
              <div>
                <span className="text-[10px] text-gray-500">Unmatched</span>
                <p className="text-sm font-mono font-bold text-amber-400">
                  ${LIVE_BETS.reduce((s, b) => s + b.unmatched, 0).toFixed(2)}
                </p>
              </div>
            </div>
            <span className="text-[10px] text-gray-500">Thu 19 Mar, 7:30 PM AEST — Hawks v Swans</span>
          </div>
        </div>
      )}

      {/* Top Overlays */}
      {overlays.length > 0 && (
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
          <h3 className="text-sm font-bold text-white mb-4">Top Overlays</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-gray-300">
              <thead className="border-b border-gray-800 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="px-3 py-2">Sport</th>
                  <th className="px-3 py-2">Game</th>
                  <th className="px-3 py-2">Market</th>
                  <th className="px-3 py-2">Selection</th>
                  <th className="px-3 py-2">Back</th>
                  <th className="px-3 py-2">Lay</th>
                  <th className="px-3 py-2">Edge</th>
                  <th className="px-3 py-2">W.E.</th>
                  <th className="px-3 py-2">Tier</th>
                  <th className="px-3 py-2">Start</th>
                </tr>
              </thead>
              <tbody>
                {overlays.slice(0, 8).map((o, i) => (
                  <tr key={o.id || i} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                    <td className="px-3 py-2.5">
                      <span className="rounded-full bg-gray-800 px-2 py-0.5 text-[10px] font-medium text-gray-300">
                        {o.sport_label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-gray-400">{o.away_team} v {o.home_team}</td>
                    <td className="px-3 py-2.5">{o.market}</td>
                    <td className="px-3 py-2.5 font-semibold text-white">{o.selection}</td>
                    <td className="px-3 py-2.5 font-mono font-bold text-white">
                      {o.betfair_back?.toFixed(2) || '—'}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-red-400">
                      {o.betfair_lay?.toFixed(2) || '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`font-mono ${o.edge_pct > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {o.edge_pct > 0 ? '+' : ''}{o.edge_pct.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <WEBadge back={o.betfair_back || 0} implied={o.implied_prob} />
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                        o.tier === 'STRONG' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40' :
                        o.tier === 'MODERATE' ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/40' :
                        'bg-amber-500/20 text-amber-400 border-amber-500/40'
                      }`}>{o.tier}</span>
                    </td>
                    <td className="px-3 py-2.5 text-[10px] text-gray-500">{formatTime(o.commence_time)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <BankrollChart bets={allBets} />
        <TierBreakdown bets={allBets} />
      </div>
      <RecentBets bets={allBets} />
      <ActivityLog />
    </div>
  )
}
