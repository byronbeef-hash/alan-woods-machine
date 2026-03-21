import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useViewMode } from '../components/layout/PageShell'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RacingOverlayRow {
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
  meeting: string
}

// ---------------------------------------------------------------------------
// Alan Woods 8-Factor Model (client-side mirror of horse_racing_model.py)
// ---------------------------------------------------------------------------

const ELITE_JOCKEYS = new Set([
  'James McDonald', 'Damian Lane', 'Hugh Bowman', 'Kerrin McEvoy',
  'Nash Rawiller', 'Tom Marquand', 'Brenton Avdulla', 'Rachel King',
  'Josh Parr', 'Tim Clark', 'Martin Harley', 'Craig Williams',
  'Damien Oliver', 'Jamie Kah', 'Luke Currie', 'Jye McNeil',
  'Mark Zahra', 'Ben Melham', 'Daniel Moor',
])

const ELITE_TRAINERS = new Set([
  'Chris Waller', 'James Cummings', 'Ciaron Maher', 'Peter Moody',
  'Tony Gollan', 'Annabel Neasham', 'Gai Waterhouse', 'Adrian Bott',
  "John O'Shea", 'Bjorn Baker', 'Mark Newnham', 'David Payne',
  'Matthew Dunn', 'Peter Snowden', 'Paul Snowden', 'John Thompson',
  'Michael Freedman', 'Robert Heathcote', 'Kris Lees',
])

const BARRIER_FACTORS: Record<number, number> = {
  1: 1.15, 2: 1.10, 3: 1.05, 4: 1.02, 5: 1.00,
  6: 0.98, 7: 0.96, 8: 0.95, 9: 0.93, 10: 0.92,
  11: 0.91, 12: 0.90, 13: 0.89, 14: 0.88, 15: 0.87,
  16: 0.86, 17: 0.85, 18: 0.84, 19: 0.83, 20: 0.82,
}

const FORM_WEIGHTS = [0.35, 0.25, 0.20, 0.12, 0.08]

const AGE_FACTORS: Record<number, number> = {
  2: 0.95, 3: 1.05, 4: 1.03, 5: 1.00, 6: 0.97, 7: 0.94, 8: 0.90,
}

function scoreForm(formStr: string): number {
  if (!formStr) return 0.5
  const positions: number[] = []
  for (const ch of formStr) {
    if (/\d/.test(ch)) positions.push(parseInt(ch))
    else if ('xfd'.includes(ch.toLowerCase())) positions.push(9)
  }
  if (!positions.length) return 0.5
  const recent = positions.slice(-5).reverse()
  let totalWeight = 0, weightedScore = 0
  for (let i = 0; i < recent.length; i++) {
    const w = i < FORM_WEIGHTS.length ? FORM_WEIGHTS[i] : 0.05
    const posScore = Math.max(0, 1.0 - (recent[i] - 1) * 0.15)
    weightedScore += posScore * w
    totalWeight += w
  }
  return totalWeight > 0 ? weightedScore / totalWeight : 0.5
}

function getFreshnessFactor(days: number): number {
  if (days <= 0) return 0.90
  const table: [number, number][] = [[0, 0.90], [7, 0.97], [14, 1.03], [21, 1.05], [28, 1.03], [42, 1.00], [56, 0.97], [84, 0.95], [120, 0.92]]
  for (let i = 0; i < table.length - 1; i++) {
    if (days >= table[i][0] && days <= table[i + 1][0]) {
      const ratio = (days - table[i][0]) / (table[i + 1][0] - table[i][0])
      return table[i][1] + (table[i + 1][1] - table[i][1]) * ratio
    }
  }
  return 0.90
}

function getFlbFactor(backPrice: number): number {
  if (backPrice < 2.0) return 0.93
  if (backPrice < 3.0) return 0.96
  if (backPrice < 5.0) return 0.98
  if (backPrice < 8.0) return 1.00
  if (backPrice < 15.0) return 1.02
  if (backPrice < 25.0) return 1.03
  return 1.04
}

function kellyStake(weNet: number, bankroll: number, backPrice: number, backSize: number, maxBet = 200): number {
  if (weNet <= 1.0) return 0
  const netPrice = (backPrice - 1) * 0.95 + 1
  const modelProb = weNet / netPrice
  const b = netPrice - 1
  const p = modelProb
  const q = 1 - p
  if (b <= 0) return 0
  const fullKelly = (b * p - q) / b
  if (fullKelly <= 0) return 0
  const kellyBet = bankroll * fullKelly * 0.25
  const bet = Math.min(kellyBet, backSize * 0.10, maxBet, bankroll * 0.05)
  return Math.max(Math.round(bet), 0)
}

interface FactorBreakdown {
  name: string
  factor: number
  impact: number
  dataAvailable: boolean
  explanation: string
  detail: string
}

function computeFactorBreakdown(o: RacingOverlayRow): { factors: FactorBreakdown[]; dataPoints: number; dataConfidence: string } {
  const factors: FactorBreakdown[] = []
  let dataPoints = 0

  const formScore = scoreForm(o.form)
  const formFactor = 0.85 + formScore * 0.30
  const hasForm = !!o.form
  if (hasForm) dataPoints += [...o.form].filter(c => /[\dxfd]/i.test(c)).length
  factors.push({ name: 'Recent Form (35%)', factor: formFactor, impact: (formFactor - 1) * 100, dataAvailable: hasForm,
    explanation: hasForm ? `Last ${[...o.form].filter(c => /[\dxfd]/i.test(c)).length} races: ${o.form}` : 'Debut runner — no form data',
    detail: hasForm ? `Score: ${formScore.toFixed(3)}. Most recent weighted 35%.` : 'Default 0.5 (average).' })

  const barrierFactor = BARRIER_FACTORS[o.barrier] ?? 0.95
  if (o.barrier) dataPoints++
  factors.push({ name: 'Barrier Draw', factor: barrierFactor, impact: (barrierFactor - 1) * 100, dataAvailable: !!o.barrier,
    explanation: `Barrier ${o.barrier}${o.barrier <= 3 ? ' — inside, advantage' : o.barrier >= 10 ? ' — wide, disadvantage' : ''}`,
    detail: 'Barrier 1 wins ~15% more than expected.' })

  const isEliteJ = ELITE_JOCKEYS.has(o.jockey)
  const jockeyFactor = isEliteJ ? 1.04 : 1.00
  if (o.jockey) dataPoints++
  factors.push({ name: 'Jockey', factor: jockeyFactor, impact: (jockeyFactor - 1) * 100, dataAvailable: !!o.jockey,
    explanation: `${o.jockey || 'Unknown'}${isEliteJ ? ' — ELITE (+4%)' : ''}`,
    detail: isEliteJ ? 'Top 20 AU jockey by win rate.' : 'Standard — no adjustment.' })

  const isEliteT = ELITE_TRAINERS.has(o.trainer)
  const trainerFactor = isEliteT ? 1.03 : 1.00
  if (o.trainer) dataPoints++
  factors.push({ name: 'Trainer', factor: trainerFactor, impact: (trainerFactor - 1) * 100, dataAvailable: !!o.trainer,
    explanation: `${o.trainer || 'Unknown'}${isEliteT ? ' — ELITE (+3%)' : ''}`,
    detail: isEliteT ? 'Top 20 AU trainer.' : 'Standard — no adjustment.' })

  const medianWeight = 57.0
  const weightDiff = medianWeight - o.weight
  const weightFactor = 1.0 + weightDiff * 0.015
  if (o.weight) dataPoints++
  factors.push({ name: 'Weight', factor: weightFactor, impact: (weightFactor - 1) * 100, dataAvailable: !!o.weight,
    explanation: `${o.weight}kg${weightDiff > 0 ? ` (${weightDiff.toFixed(1)}kg below median)` : weightDiff < 0 ? ` (${Math.abs(weightDiff).toFixed(1)}kg above median)` : ''}`,
    detail: 'Each 1kg below median ≈ +1.5% win prob.' })

  const freshnessFactor = getFreshnessFactor(o.days_since_run)
  if (o.days_since_run > 0) dataPoints++
  factors.push({ name: 'Freshness', factor: freshnessFactor, impact: (freshnessFactor - 1) * 100, dataAvailable: o.days_since_run > 0,
    explanation: o.days_since_run > 0 ? `${o.days_since_run} days since last run${o.days_since_run >= 14 && o.days_since_run <= 28 ? ' — optimal' : ''}` : 'Unknown',
    detail: 'Optimal: 14-28 days between runs.' })

  const ageFactor = AGE_FACTORS[Math.min(o.age, 8)] ?? 0.90
  if (o.age) dataPoints++
  factors.push({ name: 'Age', factor: ageFactor, impact: (ageFactor - 1) * 100, dataAvailable: !!o.age,
    explanation: `${o.age}yo${o.age === 3 ? ' — peak improvement' : o.age === 4 ? ' — prime' : o.age >= 7 ? ' — declining' : ''}`,
    detail: '3yo peak, decline after 6.' })

  const flbFactor = getFlbFactor(o.back_price)
  dataPoints++
  factors.push({ name: 'Fav-Longshot Bias', factor: flbFactor, impact: (flbFactor - 1) * 100, dataAvailable: true,
    explanation: o.back_price < 3 ? 'Short price — market over-estimates' : o.back_price > 10 ? 'Longshot — market under-estimates' : 'Mid-range — fair',
    detail: 'Public over-bets favourites, under-bets longshots.' })

  const confidence = dataPoints >= 10 ? 'HIGH' : dataPoints >= 6 ? 'MEDIUM' : 'LOW'
  return { factors, dataPoints, dataConfidence: confidence }
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function fetchPlannerOverlays(): Promise<RacingOverlayRow[]> {
  const { data, error } = await supabase
    .from('racing_overlays')
    .select('*')
    .in('verdict', ['OVERLAY', 'MARGINAL'])
    .order('we_net', { ascending: false })
    .limit(30)
  if (error) throw error
  return (data as RacingOverlayRow[]) || []
}

async function triggerScan(): Promise<void> {
  const { error } = await supabase
    .from('system_config')
    .upsert({ key: 'racing_scan_request', value: { requested_at: new Date().toISOString() }, updated_at: new Date().toISOString() })
  if (error) throw error
}

async function placeLiveBet(overlay: RacingOverlayRow, stake: number): Promise<void> {
  const { error } = await supabase
    .from('system_config')
    .upsert({
      key: 'place_bet_request',
      value: {
        market_id: overlay.market_id,
        selection_id: overlay.selection_id,
        selection: overlay.name,
        back_price: overlay.back_price,
        stake,
        sport: 'racing',
        game: `${overlay.meeting} — ${overlay.race}`,
        market: overlay.race,
        requested_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    })
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(iso: string) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('en-AU', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
      timeZone: 'Australia/Sydney',
    })
  } catch { return iso.slice(0, 16) }
}

// ---------------------------------------------------------------------------
// Explanation Panel
// ---------------------------------------------------------------------------

function ExplanationPanel({ overlay, bankroll, stake }: { overlay: RacingOverlayRow; bankroll: number; stake: number }) {
  const netPrice = (overlay.back_price - 1) * 0.95 + 1
  const potentialProfit = stake * (netPrice - 1)
  const ev = stake * (overlay.we_net - 1)
  const { factors, dataPoints, dataConfidence } = computeFactorBreakdown(overlay)
  const combinedFactor = factors.reduce((acc, f) => acc * f.factor, 1.0)
  const formChars = overlay.form ? [...overlay.form] : []

  return (
    <div className="mt-3 rounded-lg border border-gray-700 bg-gray-800/80 p-4 text-xs space-y-4">
      {/* Confidence + Meeting */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold border ${
            dataConfidence === 'HIGH' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40' :
            dataConfidence === 'MEDIUM' ? 'bg-amber-500/20 text-amber-400 border-amber-500/40' :
            'bg-red-500/20 text-red-400 border-red-500/40'
          }`}>{dataConfidence} CONFIDENCE</span>
          <span className="text-gray-500">{dataPoints} data points across 8 factors</span>
        </div>
        <span className="text-gray-600">{overlay.meeting}</span>
      </div>

      {/* Why overlay */}
      <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
        <h4 className="font-bold text-emerald-400 mb-1">Why is this an overlay?</h4>
        <p className="text-gray-300 leading-relaxed">
          Model: <span className="text-emerald-400 font-mono font-bold">{(overlay.model_prob * 100).toFixed(1)}%</span> win prob.
          Market: <span className="text-amber-400 font-mono font-bold">{(overlay.market_prob * 100).toFixed(1)}%</span> (odds {overlay.back_price.toFixed(2)}).
          Edge: <span className="text-emerald-400 font-bold">+{(overlay.edge * 100).toFixed(1)}%</span> — the crowd has underpriced this runner.
        </p>
      </div>

      {/* Form history */}
      <div>
        <h4 className="font-bold text-white mb-2">Race Form</h4>
        {formChars.length > 0 ? (
          <>
            <div className="flex items-center gap-1">
              <span className="text-gray-500 mr-2 text-[10px]">OLDEST →</span>
              {formChars.map((ch, i) => {
                const isDigit = /\d/.test(ch)
                const pos = isDigit ? parseInt(ch) : 9
                const bg = pos === 1 ? 'bg-emerald-500 text-white' :
                  pos === 2 ? 'bg-emerald-500/60 text-white' :
                  pos === 3 ? 'bg-cyan-500/50 text-white' :
                  pos <= 5 ? 'bg-gray-600 text-gray-200' :
                  ch.toLowerCase() === 'x' ? 'bg-red-500/50 text-red-200' :
                  'bg-gray-700 text-gray-400'
                return (
                  <div key={i} className="flex flex-col items-center">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center font-mono font-bold text-sm ${bg}`}>
                      {ch === '0' ? '10+' : ch.toUpperCase()}
                    </div>
                    <span className="text-[9px] text-gray-500 mt-0.5">R{i + 1}</span>
                  </div>
                )
              })}
              <span className="text-gray-500 ml-2 text-[10px]">→ RECENT</span>
            </div>
            <p className="text-gray-500 mt-2">Form score: <span className="font-mono text-white">{scoreForm(overlay.form).toFixed(3)}</span></p>
          </>
        ) : (
          <p className="text-amber-400">Debut runner — no form history.</p>
        )}
      </div>

      {/* 8-Factor breakdown */}
      <div>
        <h4 className="font-bold text-white mb-2">8-Factor Model</h4>
        <div className="space-y-1">
          {factors.map((f, i) => (
            <div key={i} className="rounded border border-gray-700 bg-gray-900/50 px-2.5 py-2 flex items-center justify-between">
              <div className="flex items-center gap-2 flex-1">
                <span className="text-white font-semibold text-[11px]">{i + 1}. {f.name}</span>
                {!f.dataAvailable && <span className="rounded px-1 py-0.5 text-[9px] bg-amber-500/20 text-amber-400">NO DATA</span>}
                <span className="text-gray-500 text-[10px] truncate">{f.explanation}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-gray-400 text-[10px]">×{f.factor.toFixed(3)}</span>
                <span className={`font-mono font-bold text-[11px] min-w-[45px] text-right ${f.impact > 0 ? 'text-emerald-400' : f.impact < 0 ? 'text-red-400' : 'text-gray-500'}`}>
                  {f.impact > 0 ? '+' : ''}{f.impact.toFixed(1)}%
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-2 rounded border border-cyan-500/30 bg-cyan-500/5 p-2 flex items-center justify-between">
          <span className="font-bold text-white text-[11px]">Combined</span>
          <span className={`font-mono font-bold ${combinedFactor > 1 ? 'text-emerald-400' : 'text-red-400'}`}>×{combinedFactor.toFixed(4)}</span>
        </div>
      </div>

      {/* W.E. calculation */}
      <div className="font-mono text-[11px] bg-gray-900 rounded-lg p-3 space-y-1 border border-gray-700">
        <p className="text-gray-500">1. Market prob: 1/{overlay.back_price.toFixed(2)} = <span className="text-gray-300">{(overlay.market_prob * 100).toFixed(1)}%</span></p>
        <p className="text-gray-500">2. Model prob: {(overlay.market_prob * 100).toFixed(1)}% × {combinedFactor.toFixed(4)} = <span className="text-emerald-400">{(overlay.model_prob * 100).toFixed(1)}%</span></p>
        <p className="text-gray-500">3. Net odds: ({overlay.back_price.toFixed(2)}-1)×0.95+1 = <span className="text-gray-300">{netPrice.toFixed(3)}</span></p>
        <p className="text-gray-500">4. <span className={overlay.we_net > 1.05 ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>W.E. = {(overlay.model_prob * 100).toFixed(1)}% × {netPrice.toFixed(3)} = {overlay.we_net.toFixed(3)}</span></p>
      </div>

      {/* Jockey / Trainer */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded border border-gray-700 bg-gray-900/50 p-2">
          <span className="text-gray-500 text-[10px]">Jockey</span>
          <p className="text-white font-semibold">{overlay.jockey || 'Unknown'}</p>
          {ELITE_JOCKEYS.has(overlay.jockey) && <span className="rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 px-2 py-0.5 text-[9px] font-bold">ELITE</span>}
        </div>
        <div className="rounded border border-gray-700 bg-gray-900/50 p-2">
          <span className="text-gray-500 text-[10px]">Trainer</span>
          <p className="text-white font-semibold">{overlay.trainer || 'Unknown'}</p>
          {ELITE_TRAINERS.has(overlay.trainer) && <span className="rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 px-2 py-0.5 text-[9px] font-bold">ELITE</span>}
        </div>
      </div>

      {/* Bet summary */}
      <div className="rounded-lg border-2 border-emerald-500/30 bg-emerald-500/10 p-3">
        <h4 className="font-bold text-emerald-400 mb-2">Bet Summary</h4>
        <div className="grid grid-cols-4 gap-3">
          <div><span className="text-[10px] text-gray-500 block">Your Stake</span><span className="font-mono font-bold text-white text-lg">${stake}</span></div>
          <div><span className="text-[10px] text-gray-500 block">If Wins</span><span className="font-mono font-bold text-emerald-400 text-lg">+${potentialProfit.toFixed(2)}</span></div>
          <div><span className="text-[10px] text-gray-500 block">Expected Value</span><span className="font-mono font-bold text-emerald-400 text-lg">+${ev.toFixed(2)}</span></div>
          <div><span className="text-[10px] text-gray-500 block">% of Bankroll</span><span className="font-mono font-bold text-white text-lg">{((stake / bankroll) * 100).toFixed(1)}%</span></div>
        </div>
        <p className="text-[10px] text-gray-500 mt-2">
          Kelly suggests ${kellyStake(overlay.we_net, bankroll, overlay.back_price, overlay.back_size)} (quarter-Kelly).
          Available: ${overlay.back_size.toFixed(0)} at {overlay.back_price.toFixed(2)}.
        </p>
      </div>

      {/* Data limitations */}
      <div className="rounded border border-amber-500/20 bg-amber-500/5 p-2">
        <h4 className="font-bold text-amber-400 mb-1 text-[10px]">Data Limitations</h4>
        <p className="text-gray-500 text-[10px]">
          No margins/distances, no jockey-trainer combo stats, no track-specific data, no speed ratings, no weather/track conditions, no pace analysis.
          Model uses {dataPoints} data points from Betfair metadata only.
        </p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Planner Page
// ---------------------------------------------------------------------------

const BANKROLL = 2546
const DEFAULT_BUDGET_PCT = 10

function allocateBudget(budget: number, overlays: RacingOverlayRow[], bankroll: number): Record<number, number> {
  // Allocate budget proportionally to Kelly stake recommendations
  const kellyRaw: { id: number; kelly: number }[] = []
  let totalKelly = 0
  for (const o of overlays) {
    if (o.verdict !== 'OVERLAY') continue
    const k = kellyStake(o.we_net, bankroll, o.back_price, o.back_size, 500)
    if (k > 0) {
      kellyRaw.push({ id: o.id, kelly: k })
      totalKelly += k
    }
  }
  if (totalKelly === 0 || kellyRaw.length === 0) return {}
  const alloc: Record<number, number> = {}
  for (const { id, kelly } of kellyRaw) {
    alloc[id] = Math.max(1, Math.round((kelly / totalKelly) * budget))
  }
  // Adjust rounding so total matches budget
  const allocTotal = Object.values(alloc).reduce((a, b) => a + b, 0)
  if (allocTotal !== budget && kellyRaw.length > 0) {
    const diff = budget - allocTotal
    // Add/subtract from the largest allocation
    const topId = kellyRaw.reduce((a, b) => a.kelly > b.kelly ? a : b).id
    alloc[topId] = Math.max(1, alloc[topId] + diff)
  }
  return alloc
}

export function PlannerPage() {
  const viewMode = useViewMode()
  const queryClient = useQueryClient()
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [stakes, setStakes] = useState<Record<number, number>>({})
  const [placedIds, setPlacedIds] = useState<Set<number>>(new Set())
  const [placingIds, setPlacingIds] = useState<Set<number>>(new Set())
  const [budgetPct, setBudgetPct] = useState(DEFAULT_BUDGET_PCT)
  const [budgetApplied, setBudgetApplied] = useState(false)

  const { data: overlayBets, isLoading } = useQuery({
    queryKey: ['planner_overlays'],
    queryFn: fetchPlannerOverlays,
    refetchInterval: 30000,
  })

  const scanMutation = useMutation({
    mutationFn: triggerScan,
    onSuccess: () => {
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ['planner_overlays'] }), 8000)
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ['planner_overlays'] }), 15000)
    },
  })

  const bets = overlayBets || []
  const overlays = bets.filter(b => b.verdict === 'OVERLAY')
  const marginals = bets.filter(b => b.verdict === 'MARGINAL')

  const getStake = (o: RacingOverlayRow) => stakes[o.id] ?? kellyStake(o.we_net, BANKROLL, o.back_price, o.back_size)
  const setStake = (id: number, val: number) => setStakes(prev => ({ ...prev, [id]: val }))

  const totalStake = overlays.reduce((s, o) => s + getStake(o), 0)
  const totalPotentialProfit = overlays.reduce((s, o) => {
    const st = getStake(o)
    return s + st * ((o.back_price - 1) * 0.95)
  }, 0)

  const handlePlaceBet = async (o: RacingOverlayRow) => {
    const stake = getStake(o)
    if (stake <= 0) return
    setPlacingIds(prev => new Set(prev).add(o.id))
    try {
      await placeLiveBet(o, stake)
      setPlacedIds(prev => new Set(prev).add(o.id))
    } catch (err) {
      alert(`Error placing bet: ${(err as Error).message}`)
    } finally {
      setPlacingIds(prev => { const next = new Set(prev); next.delete(o.id); return next })
    }
  }

  const handlePlaceAll = async () => {
    for (const o of overlays) {
      if (!placedIds.has(o.id) && getStake(o) > 0) {
        await handlePlaceBet(o)
      }
    }
  }

  const isLive = viewMode === 'live'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Bet Planner</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Plan your next 48 hours of horse racing bets. Scan, review, set stakes, and place live.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${isLive ? 'bg-red-500/20 text-red-400 border border-red-500/40' : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'}`}>
            {isLive ? 'LIVE MODE' : 'DEMO MODE'}
          </span>
          <button
            onClick={() => scanMutation.mutate()}
            disabled={scanMutation.isPending}
            className="flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
          >
            {scanMutation.isPending ? (
              <>
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Scanning...
              </>
            ) : 'Scan Betfair'}
          </button>
        </div>
      </div>

      {/* Daily Budget */}
      {bets.length > 0 && (
        <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/5 p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-white">Daily Budget</h3>
              <p className="text-[10px] text-gray-500 mt-0.5">
                Set % of bankroll (${BANKROLL.toLocaleString()}) to allocate across today's top overlay bets
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                {[5, 10, 15, 20].map(pct => (
                  <button
                    key={pct}
                    onClick={() => setBudgetPct(pct)}
                    className={`rounded px-2.5 py-1 text-xs font-bold transition-colors ${
                      budgetPct === pct
                        ? 'bg-cyan-600 text-white'
                        : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                    }`}
                  >{pct}%</button>
                ))}
                <div className="flex items-center gap-1 ml-1">
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={budgetPct}
                    onChange={e => setBudgetPct(Math.max(1, Math.min(50, parseInt(e.target.value) || 10)))}
                    className="w-14 rounded border border-gray-600 bg-gray-800 px-2 py-1 text-xs font-mono font-bold text-white text-center focus:border-cyan-500 focus:outline-none"
                  />
                  <span className="text-gray-500 text-xs">%</span>
                </div>
              </div>
              <div className="text-right min-w-[80px]">
                <span className="text-lg font-mono font-bold text-cyan-400">${Math.round(BANKROLL * budgetPct / 100)}</span>
              </div>
              <button
                onClick={() => {
                  const budget = Math.round(BANKROLL * budgetPct / 100)
                  const alloc = allocateBudget(budget, bets, BANKROLL)
                  setStakes(prev => ({ ...prev, ...alloc }))
                  setBudgetApplied(true)
                }}
                className="rounded-lg bg-cyan-600 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-cyan-500"
              >
                {budgetApplied ? 'Re-Allocate' : 'Allocate'}
              </button>
            </div>
          </div>
          {budgetApplied && (
            <p className="text-[10px] text-cyan-400 mt-2">
              Budget of ${Math.round(BANKROLL * budgetPct / 100)} allocated across {overlays.filter(o => (stakes[o.id] ?? kellyStake(o.we_net, BANKROLL, o.back_price, o.back_size)) > 0).length} overlay bets using Kelly proportions. Edit individual stakes below.
            </p>
          )}
        </div>
      )}

      {scanMutation.isPending && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-700 bg-amber-900/20 px-4 py-2 text-xs text-amber-400">
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Scanning all AU horse racing meetings on Betfair... results in ~15 seconds.
        </div>
      )}

      {/* Summary */}
      {bets.length > 0 && (
        <div className="grid grid-cols-5 gap-3">
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
            <p className="text-[10px] text-gray-500">Overlays</p>
            <p className="text-lg font-bold font-mono text-emerald-400">{overlays.length}</p>
          </div>
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
            <p className="text-[10px] text-gray-500">Marginals</p>
            <p className="text-lg font-bold font-mono text-amber-400">{marginals.length}</p>
          </div>
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
            <p className="text-[10px] text-gray-500">Best W.E.</p>
            <p className="text-lg font-bold font-mono text-emerald-400">{Math.max(...bets.map(b => b.we_net)).toFixed(3)}</p>
          </div>
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
            <p className="text-[10px] text-gray-500">Total Stake</p>
            <p className="text-lg font-bold font-mono text-white">${totalStake}</p>
          </div>
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
            <p className="text-[10px] text-gray-500">Potential Profit</p>
            <p className="text-lg font-bold font-mono text-emerald-400">+${totalPotentialProfit.toFixed(0)}</p>
          </div>
        </div>
      )}

      {/* Place All button */}
      {overlays.length > 0 && (
        <div className="flex items-center justify-between rounded-xl border-2 border-emerald-500/30 bg-emerald-500/5 p-4">
          <div>
            <p className="text-sm font-bold text-white">Place All Overlay Bets</p>
            <p className="text-xs text-gray-500">{overlays.length} bets totalling ${totalStake} on Betfair Exchange ({isLive ? 'LIVE — real money' : 'DEMO — paper only'})</p>
          </div>
          <button
            onClick={handlePlaceAll}
            disabled={!isLive}
            className={`rounded-lg px-6 py-2.5 text-sm font-bold transition-colors ${
              isLive
                ? 'bg-red-600 text-white hover:bg-red-500'
                : 'bg-gray-700 text-gray-500 cursor-not-allowed'
            }`}
          >
            {isLive ? `Place All $${totalStake} Live` : 'Switch to Live to Place'}
          </button>
        </div>
      )}

      {/* Results */}
      {isLoading ? (
        <div className="flex h-32 items-center justify-center text-sm text-gray-500">Loading overlays...</div>
      ) : bets.length === 0 ? (
        <div className="flex flex-col h-40 items-center justify-center rounded-xl border border-gray-800 bg-gray-900 text-sm text-gray-500 gap-3">
          <p>No racing overlays found. Click "Scan Betfair" to scan all AU/NZ meetings.</p>
          <p className="text-[10px] text-gray-600">The Python runner (on Railway) must be running to process scan requests. Overlays are refreshed each scan.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {bets.map(o => {
            const stake = getStake(o)
            const isOverlay = o.verdict === 'OVERLAY'
            const isExpanded = expandedId === o.id
            const isPlaced = placedIds.has(o.id)
            const isPlacing = placingIds.has(o.id)

            return (
              <div key={o.id} className={`rounded-xl border ${isPlaced ? 'border-cyan-500/40 bg-cyan-500/5' : isOverlay ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-gray-700 bg-gray-800/30'}`}>
                <div className="px-4 py-3 flex items-center gap-3">
                  {/* Badges */}
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold border ${
                    isOverlay ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40' : 'bg-amber-500/20 text-amber-400 border-amber-500/40'
                  }`}>{o.verdict}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold border ${
                    o.tier === 'STRONG' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40' :
                    o.tier === 'MODERATE' ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/40' :
                    'bg-amber-500/20 text-amber-400 border-amber-500/40'
                  }`}>{o.tier}</span>

                  {/* Horse + race */}
                  <button onClick={() => setExpandedId(isExpanded ? null : o.id)} className="text-left flex-1">
                    <span className="font-bold text-white text-sm">{o.name}</span>
                    <span className="text-xs text-gray-500 ml-1">({o.age}yo)</span>
                    <span className="text-xs text-cyan-400 ml-2">{o.race}</span>
                    <span className="text-xs text-gray-600 ml-2">{o.meeting}</span>
                  </button>

                  {/* Data columns */}
                  <div className="flex items-center gap-4">
                    <div className="text-center min-w-[55px]">
                      <span className="text-[10px] text-gray-500 block">Back</span>
                      <span className="font-mono font-bold text-white text-sm">{o.back_price.toFixed(2)}</span>
                    </div>
                    <div className="text-center min-w-[45px]">
                      <span className="text-[10px] text-gray-500 block">Edge</span>
                      <span className="font-mono font-bold text-emerald-400 text-sm">+{(o.edge * 100).toFixed(1)}%</span>
                    </div>
                    <div className="text-center min-w-[50px]">
                      <span className="text-[10px] text-gray-500 block">W.E.</span>
                      <span className={`font-mono font-bold text-sm ${o.we_net > 1.05 ? 'text-emerald-400' : 'text-amber-400'}`}>{o.we_net.toFixed(3)}</span>
                    </div>
                    <div className="text-center min-w-[70px]">
                      <span className="text-[10px] text-gray-500 block">Start</span>
                      <span className="text-[10px] text-gray-400">{formatTime(o.start_time)}</span>
                    </div>

                    {/* Editable stake */}
                    <div className="flex items-center gap-1 min-w-[90px]">
                      <span className="text-gray-500 text-sm">$</span>
                      <input
                        type="number"
                        min={0}
                        max={500}
                        value={stake}
                        onChange={e => setStake(o.id, Math.max(0, parseInt(e.target.value) || 0))}
                        className="w-16 rounded border border-gray-600 bg-gray-800 px-2 py-1 text-sm font-mono font-bold text-white text-center focus:border-emerald-500 focus:outline-none"
                      />
                    </div>

                    {/* Place bet button */}
                    {isPlaced ? (
                      <span className="rounded-lg border border-cyan-500/40 bg-cyan-500/20 px-3 py-1.5 text-xs font-bold text-cyan-400 min-w-[90px] text-center">
                        Queued
                      </span>
                    ) : (
                      <button
                        onClick={() => handlePlaceBet(o)}
                        disabled={!isLive || stake <= 0 || isPlacing}
                        className={`rounded-lg px-3 py-1.5 text-xs font-bold min-w-[90px] text-center transition-colors ${
                          isLive && stake > 0
                            ? 'bg-red-600 text-white hover:bg-red-500'
                            : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                        }`}
                      >
                        {isPlacing ? 'Placing...' : isLive ? `Bet $${stake}` : 'Demo'}
                      </button>
                    )}

                    {/* Expand */}
                    <button onClick={() => setExpandedId(isExpanded ? null : o.id)} className={`text-gray-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                      ▼
                    </button>
                  </div>
                </div>

                {/* Explanation panel */}
                {isExpanded && (
                  <div className="px-4 pb-4">
                    <ExplanationPanel overlay={o} bankroll={BANKROLL} stake={stake} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Footer */}
      <div className="text-[10px] text-gray-600 leading-relaxed">
        Alan Woods formula: W.E. = P(win) × odds (net of 5% commission). Model uses 8 factors: form, barrier, jockey, trainer, weight, freshness, age, fav-longshot bias.
        Click any row to see the full breakdown. Bankroll: ${BANKROLL.toLocaleString()}.
      </div>
    </div>
  )
}
