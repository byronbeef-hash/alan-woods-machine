import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { LoadingSpinner } from '../components/common/LoadingSpinner'

interface RacingOverlay {
  id: number
  name: string
  barrier: number
  jockey: string
  trainer: string
  weight: number
  age: number
  form: string
  days_since_run: number
  race: string
  market_id: string
  selection_id: number
  start_time: string
  field_size: number
  back_price: number
  back_size: number
  lay_price: number | null
  market_prob: number
  model_prob: number
  edge: number
  we_raw: number
  we_net: number
  verdict: string
  tier: string
  scan_id: string
  meeting: string
  created_at: string
}

async function fetchRacingOverlays(): Promise<RacingOverlay[]> {
  const { data, error } = await supabase
    .from('racing_overlays')
    .select('*')
    .order('we_net', { ascending: false })
    .limit(200)
  if (error) throw error
  return (data as RacingOverlay[]) || []
}

async function triggerRacingScan(): Promise<void> {
  const { error } = await supabase
    .from('system_config')
    .upsert({
      key: 'racing_scan_request',
      value: { requested_at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    })
  if (error) throw error
}

function WEBadge({ value }: { value: number }) {
  const color = value > 1.05
    ? 'text-emerald-400'
    : value > 0.92
    ? 'text-amber-400'
    : 'text-red-400'
  return <span className={`font-mono font-bold ${color}`}>{value.toFixed(3)}</span>
}

function TierBadge({ tier }: { tier: string }) {
  const colors: Record<string, string> = {
    STRONG: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40',
    MODERATE: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/40',
    MARGINAL: 'bg-amber-500/20 text-amber-400 border-amber-500/40',
    AVOID: 'bg-gray-500/20 text-gray-500 border-gray-500/40',
  }
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${colors[tier] || colors.AVOID}`}>
      {tier}
    </span>
  )
}

function VerdictBadge({ verdict }: { verdict: string }) {
  if (verdict === 'OVERLAY') {
    return <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-400 border border-emerald-500/40">OVERLAY</span>
  }
  if (verdict === 'MARGINAL') {
    return <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-400 border border-amber-500/40">MARGINAL</span>
  }
  return <span className="rounded bg-red-500/20 px-2 py-0.5 text-[10px] font-bold text-red-400 border border-red-500/40">UNDERLAY</span>
}

function formatTime(iso: string) {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return d.toLocaleString('en-AU', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Australia/Sydney',
    })
  } catch {
    return iso.slice(0, 16)
  }
}

type SortKey = 'we_net' | 'edge' | 'back_price' | 'model_prob' | 'start_time'
type Filter = 'all' | 'overlay' | 'marginal'

export function HorseRacingPage() {
  const [filter, setFilter] = useState<Filter>('overlay')
  const [sortKey, setSortKey] = useState<SortKey>('we_net')
  const [sortAsc, setSortAsc] = useState(false)
  const queryClient = useQueryClient()

  const { data: overlays, isLoading, error } = useQuery({
    queryKey: ['racing_overlays'],
    queryFn: fetchRacingOverlays,
    refetchInterval: 60000,
  })

  const scanMutation = useMutation({
    mutationFn: triggerRacingScan,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['racing_overlays'] }),
  })

  if (error) return <div className="text-red-400">Error: {(error as Error).message}</div>

  const allResults = overlays || []
  const filtered = filter === 'all'
    ? allResults
    : filter === 'overlay'
    ? allResults.filter(r => r.verdict === 'OVERLAY')
    : allResults.filter(r => r.verdict === 'MARGINAL')

  const sorted = [...filtered].sort((a, b) => {
    const av = a[sortKey] ?? 0
    const bv = b[sortKey] ?? 0
    return sortAsc ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1)
  })

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc)
    else { setSortKey(key); setSortAsc(false) }
  }

  const sortIcon = (key: SortKey) => sortKey === key ? (sortAsc ? ' ▲' : ' ▼') : ''

  const overlayCount = allResults.filter(r => r.verdict === 'OVERLAY').length
  const marginalCount = allResults.filter(r => r.verdict === 'MARGINAL').length
  const bestWE = allResults.length > 0 ? Math.max(...allResults.map(r => r.we_net)) : 0

  // Get unique meetings
  const meetings = [...new Set(allResults.map(r => r.meeting || r.race?.split(' ')[0] || '?'))]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">🏇 Horse Racing</h2>
          <p className="text-xs text-gray-500 mt-1">
            {allResults.length} runners analysed | Win Expectation overlay scanner
          </p>
        </div>
        <button
          onClick={() => scanMutation.mutate()}
          disabled={scanMutation.isPending}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
        >
          {scanMutation.isPending ? 'Scanning...' : 'Scan Races'}
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
          <p className="text-xs text-gray-500">Overlays Found</p>
          <p className="mt-1 text-lg font-bold font-mono text-emerald-400">{overlayCount}</p>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
          <p className="text-xs text-gray-500">Best W.E.</p>
          <p className={`mt-1 text-lg font-bold font-mono ${bestWE > 1.05 ? 'text-emerald-400' : 'text-amber-400'}`}>
            {bestWE.toFixed(3)}
          </p>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
          <p className="text-xs text-gray-500">Marginal</p>
          <p className="mt-1 text-lg font-bold font-mono text-amber-400">{marginalCount}</p>
        </div>
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
          <p className="text-xs text-gray-500">Meetings</p>
          <p className="mt-1 text-lg font-bold font-mono text-white">{meetings.length}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        {(['overlay', 'marginal', 'all'] as Filter[]).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              filter === f
                ? 'bg-emerald-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            {f === 'overlay' ? `Overlays (${overlayCount})` : f === 'marginal' ? `Marginal (${marginalCount})` : `All (${allResults.length})`}
          </button>
        ))}
      </div>

      {/* Results Table */}
      {isLoading ? (
        <LoadingSpinner />
      ) : sorted.length === 0 ? (
        <div className="flex h-48 items-center justify-center rounded-xl border border-gray-800 bg-gray-900 text-sm text-gray-500">
          No overlays found. Click "Scan Races" to analyse upcoming meetings.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-800 bg-gray-900">
          <table className="w-full text-left text-xs text-gray-300">
            <thead className="border-b border-gray-800 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-3 py-2.5">Verdict</th>
                <th className="px-3 py-2.5">Tier</th>
                <th className="px-3 py-2.5">Horse</th>
                <th className="px-3 py-2.5">Race</th>
                <th className="px-3 py-2.5">Form</th>
                <th className="px-3 py-2.5">B</th>
                <th className="px-3 py-2.5">Jockey</th>
                <th className="px-3 py-2.5">Wt</th>
                <th className="cursor-pointer px-3 py-2.5 hover:text-gray-300" onClick={() => handleSort('back_price')}>
                  Back{sortIcon('back_price')}
                </th>
                <th className="cursor-pointer px-3 py-2.5 hover:text-gray-300" onClick={() => handleSort('model_prob')}>
                  Model %{sortIcon('model_prob')}
                </th>
                <th className="cursor-pointer px-3 py-2.5 hover:text-gray-300" onClick={() => handleSort('edge')}>
                  Edge{sortIcon('edge')}
                </th>
                <th className="cursor-pointer px-3 py-2.5 hover:text-gray-300" onClick={() => handleSort('we_net')}>
                  W.E.{sortIcon('we_net')}
                </th>
                <th className="cursor-pointer px-3 py-2.5 hover:text-gray-300" onClick={() => handleSort('start_time')}>
                  Start{sortIcon('start_time')}
                </th>
                <th className="px-3 py-2.5">Action</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => (
                <tr key={r.id || i} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                  <td className="px-3 py-2.5"><VerdictBadge verdict={r.verdict} /></td>
                  <td className="px-3 py-2.5"><TierBadge tier={r.tier} /></td>
                  <td className="px-3 py-2.5">
                    <div>
                      <span className="font-semibold text-white">{r.name}</span>
                      <span className="ml-1 text-[10px] text-gray-500">({r.age}yo {r.trainer?.split(' ').slice(0, 2).join(' ')})</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-cyan-400">{r.race}</td>
                  <td className="px-3 py-2.5 font-mono">{r.form || '—'}</td>
                  <td className="px-3 py-2.5 font-mono">{r.barrier}</td>
                  <td className="px-3 py-2.5 truncate max-w-[120px]">{r.jockey}</td>
                  <td className="px-3 py-2.5 font-mono">{r.weight}kg</td>
                  <td className="px-3 py-2.5">
                    <div>
                      <span className="font-mono font-bold text-white">{r.back_price.toFixed(2)}</span>
                      <span className="ml-1 text-[10px] text-gray-500">${r.back_size?.toFixed(0)}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-emerald-400">{(r.model_prob * 100).toFixed(1)}%</td>
                  <td className="px-3 py-2.5">
                    <span className={`font-mono ${r.edge > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {r.edge > 0 ? '+' : ''}{(r.edge * 100).toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-3 py-2.5"><WEBadge value={r.we_net} /></td>
                  <td className="px-3 py-2.5 text-[10px] text-gray-400">{formatTime(r.start_time)}</td>
                  <td className="px-3 py-2.5">
                    {r.verdict === 'OVERLAY' && (
                      <button className="rounded bg-emerald-600 px-2 py-1 text-[10px] font-bold text-white hover:bg-emerald-500">
                        Bet $20
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Info */}
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
        <h3 className="text-xs font-semibold text-gray-400 mb-2">Win Expectation (Alan Woods Formula)</h3>
        <p className="text-[10px] text-gray-500 leading-relaxed">
          W.E. = P(win) × current odds. After 5% Betfair commission: W.E.(net) = P(win) × ((odds-1) × 0.95 + 1).
          <span className="text-emerald-400 font-medium"> W.E. {'>'} 1.05 = OVERLAY</span> (bet).
          <span className="text-amber-400 font-medium"> 0.92-1.05 = MARGINAL</span> (commission eats edge).
          <span className="text-red-400 font-medium"> W.E. {'<'} 0.92 = UNDERLAY</span> (avoid).
          Model uses: form, barrier draw, jockey/trainer, weight, freshness, age, favourite-longshot bias.
        </p>
      </div>
    </div>
  )
}
