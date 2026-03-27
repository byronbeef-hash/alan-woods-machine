import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BetfairBet {
  id: number
  player: string
  market: string
  odds_decimal: number
  bet_size: number
  model_prob: number
  edge: number
  tier: string
  result: string
  pnl: number | null
  created_at: string
  sport: string
  notes: string | null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDateTime(iso: string) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('en-AU', {
      day: 'numeric', month: 'short', year: '2-digit',
      hour: 'numeric', minute: '2-digit', hour12: false,
      timeZone: 'Australia/Brisbane',
    })
  } catch { return iso.slice(0, 16) }
}

function formatRaceTime(iso: string) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('en-AU', {
      weekday: 'short', day: 'numeric', month: 'short',
      hour: 'numeric', minute: '2-digit', hour12: true,
      timeZone: 'Australia/Brisbane',
    })
  } catch { return iso.slice(0, 16) }
}

function extractBetfairId(notes: string | null): string {
  if (!notes) return '—'
  const match = notes.match(/Betfair ID:\s*(\d+)/)
  return match ? match[1] : '—'
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function fetchBetfairData() {
  // All bets ordered by most recent
  const { data: bets } = await supabase
    .from('bets')
    .select('*')
    .order('created_at', { ascending: false })

  // Look up race times from racing_overlays
  const playerNames = (bets || []).map(b => b.player).filter(Boolean)
  const { data: overlays } = await supabase
    .from('racing_overlays')
    .select('name, start_time, meeting, race, track_condition')
    .in('name', playerNames)

  const overlayMap: Record<string, { start_time: string; meeting: string; race: string; track_condition: string }> = {}
  for (const o of overlays || []) {
    overlayMap[o.name] = o
  }

  // Get config for balance
  const { data: configs } = await supabase
    .from('system_config')
    .select('key, value')
    .in('key', ['starting_bankroll', 'woods_mode'])

  const configMap: Record<string, unknown> = {}
  for (const c of configs || []) configMap[c.key] = c.value

  return {
    bets: (bets || []) as BetfairBet[],
    overlayMap,
    bankroll: (configMap.starting_bankroll as number) || 2500,
    mode: (configMap.woods_mode as string) || 'live',
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function BetfairPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['betfair_page'],
    queryFn: fetchBetfairData,
    refetchInterval: 300000,
  })

  if (isLoading || !data) {
    return <div className="flex h-40 items-center justify-center text-sm text-gray-500">Loading Betfair data...</div>
  }

  const { bets, overlayMap, mode } = data

  const pendingBets = bets.filter(b => b.result === 'PENDING')
  const settledBets = bets.filter(b => b.result === 'WIN' || b.result === 'LOSS')

  const totalStaked = pendingBets.reduce((s, b) => s + (b.bet_size || 0), 0)
  const totalLiability = pendingBets.reduce((s, b) => s + (b.bet_size || 0), 0)
  const totalPotentialWin = pendingBets.reduce((s, b) => {
    return s + (b.bet_size || 0) * ((b.odds_decimal || 1) - 1) * 0.95
  }, 0)
  const settledPnl = settledBets.reduce((s, b) => s + (b.pnl || 0), 0)
  const balance = 2366.04 // Current Betfair balance from screenshot

  return (
    <div className="space-y-6">
      {/* Header — mimics Betfair style */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded bg-[#ffb80c]">
            <span className="text-sm font-bold text-black">B</span>
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">Betfair Exchange</h2>
            <p className="text-xs text-gray-500">myaccount.betfair.com.au</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <span className="text-[10px] text-gray-500 block">Main Balance</span>
            <span className="text-lg font-mono font-bold text-[#ffb80c]">${balance.toFixed(2)}</span>
          </div>
          <div className="text-right">
            <span className="text-[10px] text-gray-500 block">Exposure</span>
            <span className="text-lg font-mono font-bold text-red-400">-${totalStaked.toFixed(2)}</span>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-bold border ${
            mode === 'live'
              ? 'bg-red-500/20 text-red-400 border-red-500/40'
              : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
          }`}>{mode.toUpperCase()}</span>
        </div>
      </div>

      {/* Account summary */}
      <div className="grid grid-cols-5 gap-3">
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
          <span className="text-[10px] text-gray-500 block">Balance</span>
          <span className="text-lg font-mono font-bold text-[#ffb80c]">${balance.toFixed(2)}</span>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
          <span className="text-[10px] text-gray-500 block">Active Bets</span>
          <span className="text-lg font-mono font-bold text-white">{pendingBets.length}</span>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
          <span className="text-[10px] text-gray-500 block">Total Staked</span>
          <span className="text-lg font-mono font-bold text-white">${totalStaked.toFixed(2)}</span>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
          <span className="text-[10px] text-gray-500 block">Potential Win</span>
          <span className="text-lg font-mono font-bold text-emerald-400">+${totalPotentialWin.toFixed(2)}</span>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
          <span className="text-[10px] text-gray-500 block">Settled P&L</span>
          <span className={`text-lg font-mono font-bold ${settledPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {settledPnl >= 0 ? '+' : ''}${settledPnl.toFixed(2)}
          </span>
        </div>
      </div>

      {/* Current Bets — Matched */}
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-white">Current Bets</h3>
            <p className="text-[10px] text-gray-500">Bet status: Matched | Order by: Matched Date</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400">{pendingBets.length} matched bets</span>
            <span className="text-xs font-mono font-bold text-white">Liability: ${totalLiability.toFixed(2)}</span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-700 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                <th className="px-3 py-2 text-left">Market</th>
                <th className="px-3 py-2 text-left">Selection</th>
                <th className="px-3 py-2 text-center">Type</th>
                <th className="px-3 py-2 text-right">Bet ID</th>
                <th className="px-3 py-2 text-right">Bet Placed</th>
                <th className="px-3 py-2 text-right">Odds Req.</th>
                <th className="px-3 py-2 text-right">Stake</th>
                <th className="px-3 py-2 text-right">Liability</th>
                <th className="px-3 py-2 text-right">Avg Odds Matched</th>
                <th className="px-3 py-2 text-right">Potential Win</th>
                <th className="px-3 py-2 text-right">Race Time</th>
                <th className="px-3 py-2 text-right">Edge</th>
                <th className="px-3 py-2 text-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {pendingBets.map((bet) => {
                const overlay = overlayMap[bet.player]
                const potentialWin = (bet.bet_size || 0) * ((bet.odds_decimal || 1) - 1) * 0.95
                const betfairId = extractBetfairId(bet.notes)
                const raceTime = overlay?.start_time ? formatRaceTime(overlay.start_time) : '—'
                const meeting = overlay?.meeting || ''
                const race = overlay?.race || bet.market || ''

                return (
                  <tr key={bet.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                    <td className="px-3 py-3">
                      <div>
                        <span className="text-cyan-400 text-[10px]">Horse Racing</span>
                        <p className="text-white font-medium">{meeting ? `${meeting} / ${race}` : race}</p>
                      </div>
                    </td>
                    <td className="px-3 py-3 font-semibold text-white">{bet.player}</td>
                    <td className="px-3 py-3 text-center">
                      <span className="rounded bg-blue-500/20 text-blue-400 px-2 py-0.5 text-[10px] font-bold">Back</span>
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-gray-400">{betfairId}</td>
                    <td className="px-3 py-3 text-right text-gray-400">{formatDateTime(bet.created_at)}</td>
                    <td className="px-3 py-3 text-right font-mono text-white">{bet.odds_decimal?.toFixed(2)}</td>
                    <td className="px-3 py-3 text-right font-mono font-bold text-white">${(bet.bet_size || 0).toFixed(2)}</td>
                    <td className="px-3 py-3 text-right font-mono text-white">${(bet.bet_size || 0).toFixed(2)}</td>
                    <td className="px-3 py-3 text-right font-mono font-bold text-[#ffb80c]">{bet.odds_decimal?.toFixed(2)}</td>
                    <td className="px-3 py-3 text-right font-mono font-bold text-emerald-400">+${potentialWin.toFixed(2)}</td>
                    <td className="px-3 py-3 text-right text-[10px] text-cyan-400">{raceTime}</td>
                    <td className="px-3 py-3 text-right font-mono text-emerald-400">+{((bet.edge || 0) * 100).toFixed(1)}%</td>
                    <td className="px-3 py-3 text-center">
                      <span className="rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 px-2 py-0.5 text-[10px] font-bold">
                        MATCHED
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            {/* Totals row */}
            <tfoot>
              <tr className="border-t-2 border-[#ffb80c]/30 bg-[#ffb80c]/5">
                <td className="px-3 py-3 font-bold text-white" colSpan={6}>TOTAL</td>
                <td className="px-3 py-3 text-right font-mono font-bold text-white">${totalStaked.toFixed(2)}</td>
                <td className="px-3 py-3 text-right font-mono font-bold text-white">${totalLiability.toFixed(2)}</td>
                <td className="px-3 py-3"></td>
                <td className="px-3 py-3 text-right font-mono font-bold text-emerald-400">+${totalPotentialWin.toFixed(2)}</td>
                <td className="px-3 py-3" colSpan={3}></td>
              </tr>
            </tfoot>
          </table>
        </div>

        <p className="text-[10px] text-gray-600 mt-3">
          * All times are AEST/QLD unless otherwise stated. Odds shown are average matched odds from Betfair Exchange.
        </p>
      </div>

      {/* Settled Bets */}
      {settledBets.length > 0 && (
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-white">Settled Bets</h3>
            <span className="text-xs text-gray-400">{settledBets.length} settled</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-700 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                  <th className="px-3 py-2 text-left">Selection</th>
                  <th className="px-3 py-2 text-left">Market</th>
                  <th className="px-3 py-2 text-center">Type</th>
                  <th className="px-3 py-2 text-right">Odds</th>
                  <th className="px-3 py-2 text-right">Stake</th>
                  <th className="px-3 py-2 text-right">P&L</th>
                  <th className="px-3 py-2 text-center">Result</th>
                  <th className="px-3 py-2 text-right">Date</th>
                </tr>
              </thead>
              <tbody>
                {settledBets.map((bet) => (
                  <tr key={bet.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                    <td className="px-3 py-3 font-semibold text-white">{bet.player}</td>
                    <td className="px-3 py-3 text-gray-400">{bet.market}</td>
                    <td className="px-3 py-3 text-center">
                      <span className="rounded bg-blue-500/20 text-blue-400 px-2 py-0.5 text-[10px] font-bold">Back</span>
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-white">{bet.odds_decimal?.toFixed(2)}</td>
                    <td className="px-3 py-3 text-right font-mono text-white">${(bet.bet_size || 0).toFixed(2)}</td>
                    <td className={`px-3 py-3 text-right font-mono font-bold ${(bet.pnl || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {(bet.pnl || 0) >= 0 ? '+' : ''}${(bet.pnl || 0).toFixed(2)}
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold border ${
                        bet.result === 'WIN'
                          ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                          : 'bg-red-500/20 text-red-400 border-red-500/40'
                      }`}>{bet.result}</span>
                    </td>
                    <td className="px-3 py-3 text-right text-gray-400">{formatDateTime(bet.created_at)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-700">
                  <td className="px-3 py-3 font-bold text-white" colSpan={5}>TOTAL P&L</td>
                  <td className={`px-3 py-3 text-right font-mono font-bold ${settledPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {settledPnl >= 0 ? '+' : ''}${settledPnl.toFixed(2)}
                  </td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Account info */}
      <div className="rounded-lg bg-gray-800/50 border border-gray-700 p-4">
        <div className="grid grid-cols-4 gap-4 text-xs">
          <div>
            <span className="text-gray-500 block">Account</span>
            <span className="text-white font-mono">trdickinson</span>
          </div>
          <div>
            <span className="text-gray-500 block">Commission Rate</span>
            <span className="text-white font-mono">5%</span>
          </div>
          <div>
            <span className="text-gray-500 block">Exposure Limit</span>
            <span className="text-white font-mono">-$15,000</span>
          </div>
          <div>
            <span className="text-gray-500 block">Points Balance</span>
            <span className="text-white font-mono">14</span>
          </div>
        </div>
      </div>
    </div>
  )
}
