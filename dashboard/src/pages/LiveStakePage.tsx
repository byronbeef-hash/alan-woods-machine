import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PendingBet {
  id: number
  player: string
  market: string
  stat: string
  side: string
  odds_decimal: number
  model_prob: number
  market_implied: number
  edge: number
  tier: string
  bet_size: number
  bankroll_at_bet: number
  created_at: string
  sport: string
}

interface OverlayInfo {
  name: string
  back_price: number
  model_prob: number
  market_prob: number
  edge: number
  we_net: number
  verdict: string
  tier: string
  barrier: number
  jockey: string
  trainer: string
  weight: number
  age: number
  form: string
  days_since_run: number
  race: string
  meeting: string
  start_time: string
  field_size: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(iso: string) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('en-AU', {
      weekday: 'short', day: 'numeric', month: 'short',
      hour: 'numeric', minute: '2-digit', hour12: true,
      timeZone: 'Australia/Brisbane',
    })
  } catch { return iso.slice(0, 16) }
}

function formatDate(iso: string) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('en-AU', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      timeZone: 'Australia/Brisbane',
    })
  } catch { return iso.slice(0, 10) }
}

function explainEdge(overlay: OverlayInfo): string[] {
  const reasons: string[] = []

  if (overlay.edge > 0.05) {
    reasons.push(`Strong 8-factor model edge of +${(overlay.edge * 100).toFixed(1)}% — the market is significantly underpricing this runner`)
  } else if (overlay.edge > 0.02) {
    reasons.push(`Model edge of +${(overlay.edge * 100).toFixed(1)}% — the crowd has underestimated this runner's chance`)
  } else {
    reasons.push(`Marginal edge of +${(overlay.edge * 100).toFixed(1)}% identified by the 8-factor model`)
  }

  if (overlay.we_net > 1.3) {
    reasons.push(`Excellent Win Expectation of ${overlay.we_net.toFixed(3)} — for every $1 bet, the model expects $${overlay.we_net.toFixed(2)} back`)
  } else if (overlay.we_net > 1.1) {
    reasons.push(`Positive Win Expectation of ${overlay.we_net.toFixed(3)} — expected return exceeds stake after commission`)
  }

  if (overlay.form) {
    const recent = overlay.form.slice(-3)
    const goodForm = recent.split('').filter(c => '123'.includes(c)).length
    if (goodForm >= 2) {
      reasons.push(`Strong recent form (${overlay.form}) — ${goodForm} of last 3 starts in the top 3`)
    } else if (goodForm === 1) {
      reasons.push(`Decent form (${overlay.form}) — has shown ability in recent starts`)
    }
  }

  if (overlay.barrier && overlay.barrier <= 4) {
    reasons.push(`Favourable barrier ${overlay.barrier} — inside draws historically have a significant advantage`)
  }

  if (overlay.jockey) {
    reasons.push(`Ridden by ${overlay.jockey}`)
  }

  if (overlay.trainer) {
    reasons.push(`Trained by ${overlay.trainer}`)
  }

  if (overlay.days_since_run && overlay.days_since_run >= 14 && overlay.days_since_run <= 35) {
    reasons.push(`${overlay.days_since_run} days since last run — in the optimal freshness window (14-35 days)`)
  }

  if (overlay.back_price >= 10) {
    reasons.push(`At $${overlay.back_price.toFixed(2)}, this is a value longshot — the favourite-longshot bias means the market typically underprices runners at these odds`)
  }

  return reasons
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function fetchLiveStake() {
  // Get pending bets
  const { data: bets } = await supabase
    .from('bets')
    .select('*')
    .eq('result', 'PENDING')
    .order('created_at', { ascending: false })

  // Get overlay details for these bets
  const playerNames = (bets || []).map(b => b.player).filter(Boolean)
  const { data: overlays } = await supabase
    .from('racing_overlays')
    .select('*')
    .in('name', playerNames)

  // Get system config
  const { data: configs } = await supabase
    .from('system_config')
    .select('key, value')
    .in('key', ['starting_bankroll', 'daily_budget', 'woods_mode', 'activity_log'])

  const configMap: Record<string, unknown> = {}
  for (const c of configs || []) configMap[c.key] = c.value

  // Get settled bets for today's P&L
  const today = new Date().toISOString().slice(0, 10)
  const { data: settled } = await supabase
    .from('bets')
    .select('result, pnl')
    .in('result', ['WIN', 'LOSS'])
    .gte('settled_at', today)

  const todayPnl = (settled || []).reduce((s, b) => s + (b.pnl || 0), 0)
  const todayWins = (settled || []).filter(b => b.result === 'WIN').length
  const todayLosses = (settled || []).filter(b => b.result === 'LOSS').length

  // Build overlay map
  const overlayMap: Record<string, OverlayInfo> = {}
  for (const o of overlays || []) {
    overlayMap[o.name] = o as OverlayInfo
  }

  return {
    bets: (bets || []) as PendingBet[],
    overlayMap,
    bankroll: (configMap.starting_bankroll as number) || 2500,
    mode: (configMap.woods_mode as string) || 'live',
    todayPnl,
    todayWins,
    todayLosses,
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function LiveStakePage() {
  const { data, isLoading } = useQuery({
    queryKey: ['live_stake'],
    queryFn: fetchLiveStake,
    refetchInterval: 300000,
  })

  if (isLoading || !data) {
    return <div className="flex h-40 items-center justify-center text-sm text-gray-500">Loading live stake...</div>
  }

  const { bets, overlayMap, bankroll, mode, todayPnl, todayWins, todayLosses } = data
  const totalStake = bets.reduce((s, b) => s + (b.bet_size || 0), 0)
  const totalPotentialProfit = bets.reduce((s, b) => s + (b.bet_size || 0) * ((b.odds_decimal || 1) - 1) * 0.95, 0)
  const totalEV = bets.reduce((s, b) => {
    const st = b.bet_size || 0
    const odds = b.odds_decimal || 1
    const mp = b.model_prob || 0
    return s + st * ((odds - 1) * 0.95 * mp - (1 - mp))
  }, 0)

  const today = new Date()
  const dateStr = formatDate(today.toISOString())

  // Get race time from first bet's overlay
  const firstOverlay = bets.length > 0 ? overlayMap[bets[0].player] : null
  const raceTime = firstOverlay?.start_time ? formatTime(firstOverlay.start_time) : '—'
  const meeting = firstOverlay?.meeting || '—'
  const raceName = firstOverlay?.race || '—'

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-white">Live Stake</h2>
        <p className="text-xs text-gray-500 mt-0.5">{dateStr}</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-6 gap-3">
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
          <span className="text-[10px] text-gray-500 block">Mode</span>
          <span className={`text-lg font-bold ${mode === 'live' ? 'text-red-400' : 'text-emerald-400'}`}>{mode.toUpperCase()}</span>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
          <span className="text-[10px] text-gray-500 block">Active Bets</span>
          <span className="text-lg font-mono font-bold text-white">{bets.length}</span>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
          <span className="text-[10px] text-gray-500 block">Total Staked</span>
          <span className="text-lg font-mono font-bold text-white">${totalStake}</span>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
          <span className="text-[10px] text-gray-500 block">Potential Win</span>
          <span className="text-lg font-mono font-bold text-emerald-400">+${totalPotentialProfit.toFixed(0)}</span>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
          <span className="text-[10px] text-gray-500 block">Expected Value</span>
          <span className="text-lg font-mono font-bold text-emerald-400">+${totalEV.toFixed(0)}</span>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
          <span className="text-[10px] text-gray-500 block">Today's P&L</span>
          <span className={`text-lg font-mono font-bold ${todayPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {todayPnl >= 0 ? '+' : ''}${todayPnl.toFixed(0)}
          </span>
          {(todayWins + todayLosses) > 0 && (
            <span className="text-[10px] text-gray-500 block">{todayWins}W / {todayLosses}L</span>
          )}
        </div>
      </div>

      {/* Race info */}
      {firstOverlay && (
        <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/5 p-4">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs text-gray-400">Race</span>
              <p className="text-sm font-bold text-white">{meeting} — {raceName}</p>
            </div>
            <div className="text-right">
              <span className="text-xs text-gray-400">Race Time (QLD)</span>
              <p className="text-sm font-bold text-cyan-400">{raceTime}</p>
            </div>
          </div>
          <div className="flex items-center gap-4 mt-2 text-[10px] text-gray-500">
            <span>Bankroll: ${bankroll.toLocaleString()}</span>
            <span>Stake: {((totalStake / bankroll) * 100).toFixed(1)}% of bankroll</span>
            <span>Field size: {firstOverlay.field_size || '—'} runners</span>
          </div>
        </div>
      )}

      {/* Individual bet explanations */}
      <div className="space-y-4">
        <h3 className="text-sm font-bold text-white">Bet Breakdown</h3>

        {bets.map((bet, i) => {
          const overlay = overlayMap[bet.player]
          const profit = (bet.bet_size || 0) * ((bet.odds_decimal || 1) - 1) * 0.95
          const reasons = overlay ? explainEdge(overlay) : []
          const raceTimeLocal = overlay?.start_time ? formatTime(overlay.start_time) : '—'

          return (
            <div key={bet.id} className="rounded-xl border border-gray-800 bg-gray-900 p-5">
              {/* Header row */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <span className="text-lg font-bold text-white">#{i + 1}</span>
                  <div>
                    <span className="text-sm font-bold text-white">{bet.player}</span>
                    <span className="text-xs text-gray-500 ml-2">{overlay?.race || bet.market}</span>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    bet.tier === 'STRONG' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' :
                    bet.tier === 'MODERATE' ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40' :
                    'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                  }`}>{bet.tier}</span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-gray-500 block">Race Time</span>
                  <span className="text-xs text-cyan-400 font-bold">{raceTimeLocal}</span>
                </div>
              </div>

              {/* Key numbers */}
              <div className="grid grid-cols-7 gap-2 mb-4">
                <div className="rounded-lg bg-gray-800 p-2.5">
                  <span className="text-[10px] text-gray-500 block">Odds</span>
                  <span className="text-sm font-mono font-bold text-white">${bet.odds_decimal?.toFixed(2)}</span>
                </div>
                <div className="rounded-lg bg-gray-800 p-2.5">
                  <span className="text-[10px] text-gray-500 block">Stake</span>
                  <span className="text-sm font-mono font-bold text-white">${bet.bet_size}</span>
                </div>
                <div className="rounded-lg bg-gray-800 p-2.5">
                  <span className="text-[10px] text-gray-500 block">If Wins</span>
                  <span className="text-sm font-mono font-bold text-emerald-400">+${profit.toFixed(0)}</span>
                </div>
                <div className="rounded-lg bg-gray-800 p-2.5">
                  <span className="text-[10px] text-gray-500 block">Edge</span>
                  <span className="text-sm font-mono font-bold text-emerald-400">+{((bet.edge || 0) * 100).toFixed(1)}%</span>
                </div>
                <div className="rounded-lg bg-gray-800 p-2.5">
                  <span className="text-[10px] text-gray-500 block">Model Prob</span>
                  <span className="text-sm font-mono font-bold text-cyan-400">{((bet.model_prob || 0) * 100).toFixed(0)}%</span>
                </div>
                <div className="rounded-lg bg-gray-800 p-2.5">
                  <span className="text-[10px] text-gray-500 block">Market Prob</span>
                  <span className="text-sm font-mono font-bold text-gray-400">{((bet.market_implied || 0) * 100).toFixed(0)}%</span>
                </div>
                <div className="rounded-lg bg-gray-800 p-2.5">
                  <span className="text-[10px] text-gray-500 block">W.E.</span>
                  <span className={`text-sm font-mono font-bold ${(overlay?.we_net || 0) > 1.1 ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {overlay?.we_net?.toFixed(3) || '—'}
                  </span>
                </div>
              </div>

              {/* Why this bet */}
              <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/20 p-3">
                <span className="text-[10px] text-emerald-400 font-bold block mb-1.5">Why this bet?</span>
                <ul className="space-y-1">
                  {reasons.map((r, j) => (
                    <li key={j} className="text-xs text-gray-300 flex items-start gap-2">
                      <span className="text-emerald-500 mt-0.5">+</span>
                      {r}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Runner details */}
              {overlay && (
                <div className="flex items-center gap-4 mt-3 text-[10px] text-gray-500">
                  {overlay.barrier && <span>Barrier {overlay.barrier}</span>}
                  {overlay.weight && <span>{overlay.weight}kg</span>}
                  {overlay.age && <span>{overlay.age}yo</span>}
                  {overlay.form && <span>Form: {overlay.form}</span>}
                  {overlay.days_since_run && <span>{overlay.days_since_run} days since last run</span>}
                  {overlay.meeting && <span>{overlay.meeting}</span>}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Totals footer */}
      <div className="rounded-xl border-2 border-cyan-500/30 bg-gray-900 p-5">
        <div className="grid grid-cols-4 gap-4">
          <div>
            <span className="text-[10px] text-gray-500 block">Total Staked</span>
            <span className="text-2xl font-mono font-bold text-white">${totalStake}</span>
            <span className="text-[10px] text-gray-500 block">{bets.length} bets</span>
          </div>
          <div>
            <span className="text-[10px] text-gray-500 block">If All Win</span>
            <span className="text-2xl font-mono font-bold text-emerald-400">+${totalPotentialProfit.toFixed(0)}</span>
            <span className="text-[10px] text-gray-500 block">{((totalPotentialProfit / totalStake) * 100).toFixed(0)}% return</span>
          </div>
          <div>
            <span className="text-[10px] text-gray-500 block">Expected Value</span>
            <span className="text-2xl font-mono font-bold text-emerald-400">+${totalEV.toFixed(0)}</span>
            <span className="text-[10px] text-gray-500 block">probability-weighted</span>
          </div>
          <div>
            <span className="text-[10px] text-gray-500 block">Avg Odds</span>
            <span className="text-2xl font-mono font-bold text-white">
              ${bets.length > 0 ? (bets.reduce((s, b) => s + (b.odds_decimal || 0), 0) / bets.length).toFixed(2) : '0'}
            </span>
            <span className="text-[10px] text-gray-500 block">across {bets.length} selections</span>
          </div>
        </div>
      </div>

      {/* Strategy note */}
      <div className="rounded-lg bg-gray-800/50 border border-gray-700 p-4">
        <p className="text-xs text-gray-400">
          <span className="text-white font-bold">Alan Woods Strategy:</span> Bets are selected using an 8-factor model (form, barrier, jockey, trainer, weight, freshness, age, favourite-longshot bias).
          Each factor adjusts the market probability to produce a model probability. When the model probability exceeds the market price (creating an "overlay"),
          a bet is placed with stake sized by quarter-Kelly criterion. Win Expectation (W.E.) = model probability × odds (net of 5% Betfair commission).
          Only overlays with W.E. &gt; 1.0 are selected — meaning positive expected return per dollar bet.
        </p>
      </div>
    </div>
  )
}
