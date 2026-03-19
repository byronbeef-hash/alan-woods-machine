import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
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

const SPORT_MODE_TO_KEY: Record<string, string> = {
  nba: 'basketball_nba',
  afl: 'aussierules_afl',
  soccer: 'soccer_epl',
  racing: 'racing',
}

// Kelly Criterion bet sizing (quarter-Kelly for safety)
function kellyStake(weNet: number, bankroll: number, backPrice: number, backSize: number, maxBet = 100): number {
  if (weNet <= 1.0) return 0
  const netPrice = (backPrice - 1) * 0.95 + 1
  const modelProb = weNet / netPrice
  const b = netPrice - 1
  const p = modelProb
  const q = 1 - p
  if (b <= 0) return 0
  const fullKelly = (b * p - q) / b
  if (fullKelly <= 0) return 0
  const kellyBet = bankroll * fullKelly * 0.25 // quarter-Kelly
  const bet = Math.min(kellyBet, backSize * 0.10, maxBet, bankroll * 0.05)
  return Math.max(Math.round(bet), 0)
}

async function fetchOverlayBets(): Promise<RacingOverlayRow[]> {
  const { data, error } = await supabase
    .from('racing_overlays')
    .select('*')
    .in('verdict', ['OVERLAY', 'MARGINAL'])
    .order('we_net', { ascending: false })
    .limit(20)
  if (error) throw error
  return (data as RacingOverlayRow[]) || []
}

async function triggerFindOverlays(): Promise<void> {
  const { error } = await supabase
    .from('system_config')
    .upsert({
      key: 'racing_scan_request',
      value: { requested_at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    })
  if (error) throw error
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
      timeZone: 'Australia/Sydney',
    })
  } catch { return iso.slice(0, 16) }
}

// -----------------------------------------------------------------------
// Alan Woods 8-Factor Model — client-side recreation for explanation panel
// Mirrors horse_racing_model.py exactly so user can see every calculation
// -----------------------------------------------------------------------

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

interface FactorBreakdown {
  name: string
  factor: number
  impact: number // percentage impact
  dataAvailable: boolean
  explanation: string
  detail: string
}

function computeFactorBreakdown(o: RacingOverlayRow): { factors: FactorBreakdown[]; dataPoints: number; dataConfidence: string } {
  const factors: FactorBreakdown[] = []
  let dataPoints = 0

  // 1. Form
  const formScore = scoreForm(o.form)
  const formFactor = 0.85 + formScore * 0.30
  const hasForm = !!o.form
  if (hasForm) {
    const raceCount = [...o.form].filter(c => /[\dxfd]/i.test(c)).length
    dataPoints += raceCount
  }
  factors.push({
    name: 'Recent Form (35% weight)',
    factor: formFactor,
    impact: (formFactor - 1) * 100,
    dataAvailable: hasForm,
    explanation: hasForm ? `Last ${[...o.form].filter(c => /[\dxfd]/i.test(c)).length} race finishes: ${o.form}` : 'No form data — debut runner, using average (0.5)',
    detail: hasForm ? `Form score: ${formScore.toFixed(3)} (0 = terrible, 1 = perfect). Most recent race weighted 35%, then 25%, 20%, 12%, 8%.` : 'Debut runners default to 0.5 (average). Higher risk — no track record.',
  })

  // 2. Barrier
  const barrierFactor = BARRIER_FACTORS[o.barrier] ?? 0.95
  if (o.barrier) dataPoints++
  factors.push({
    name: 'Barrier Draw',
    factor: barrierFactor,
    impact: (barrierFactor - 1) * 100,
    dataAvailable: !!o.barrier,
    explanation: `Barrier ${o.barrier}${o.barrier <= 3 ? ' — inside draw, statistically significant advantage' : o.barrier <= 6 ? ' — mid-inside, slight advantage' : o.barrier <= 10 ? ' — mid-field draw' : ' — wide draw, significant disadvantage'}`,
    detail: 'Research on 50,000+ AU races shows barrier 1 wins ~15% more than expected. Each position wider loses ~2-3% edge.',
  })

  // 3. Jockey
  const isEliteJockey = ELITE_JOCKEYS.has(o.jockey)
  const jockeyFactor = isEliteJockey ? 1.04 : 1.00
  if (o.jockey) dataPoints++
  factors.push({
    name: 'Jockey',
    factor: jockeyFactor,
    impact: (jockeyFactor - 1) * 100,
    dataAvailable: !!o.jockey,
    explanation: `${o.jockey}${isEliteJockey ? ' — ELITE jockey (+4% boost). Top 20 AU jockey by win rate.' : ' — Standard jockey (no adjustment)'}`,
    detail: isEliteJockey ? 'Elite jockeys consistently outperform market pricing by 3-5%. Their race craft, gate speed, and tactical decisions add measurable value.' : 'Non-elite jockeys are fairly priced by the market. No positive or negative adjustment.',
  })

  // 4. Trainer
  const isEliteTrainer = ELITE_TRAINERS.has(o.trainer)
  const trainerFactor = isEliteTrainer ? 1.03 : 1.00
  if (o.trainer) dataPoints++
  factors.push({
    name: 'Trainer',
    factor: trainerFactor,
    impact: (trainerFactor - 1) * 100,
    dataAvailable: !!o.trainer,
    explanation: `${o.trainer}${isEliteTrainer ? ' — ELITE trainer (+3% boost). Top 20 AU trainer by strike rate.' : ' — Standard trainer (no adjustment)'}`,
    detail: isEliteTrainer ? 'Elite trainers produce winners at higher rates than the market expects. Their preparation, placement, and stable quality give a consistent edge.' : 'Standard trainers are accurately priced by the market.',
  })

  // 5. Weight (relative to median ~57kg)
  const medianWeight = 57.0 // approximate
  const weightDiff = medianWeight - o.weight
  const weightFactor = 1.0 + weightDiff * 0.015
  if (o.weight) dataPoints++
  factors.push({
    name: 'Weight Carried',
    factor: weightFactor,
    impact: (weightFactor - 1) * 100,
    dataAvailable: !!o.weight,
    explanation: `${o.weight}kg${weightDiff > 0 ? ` — ${weightDiff.toFixed(1)}kg BELOW field median (${medianWeight}kg), advantage` : weightDiff < 0 ? ` — ${Math.abs(weightDiff).toFixed(1)}kg ABOVE field median (${medianWeight}kg), disadvantage` : ' — at field median'}`,
    detail: 'Each 1kg below median ≈ 1.5% win probability increase. In handicap races, weight is the great equaliser — but the market systematically underweights its impact.',
  })

  // 6. Freshness
  const freshnessFactor = getFreshnessFactor(o.days_since_run)
  if (o.days_since_run > 0) dataPoints++
  factors.push({
    name: 'Freshness (Days Since Last Run)',
    factor: freshnessFactor,
    impact: (freshnessFactor - 1) * 100,
    dataAvailable: o.days_since_run > 0,
    explanation: o.days_since_run > 0
      ? `${o.days_since_run} days since last run${o.days_since_run >= 14 && o.days_since_run <= 28 ? ' — OPTIMAL freshness window' : o.days_since_run < 10 ? ' — back-to-back, slight fatigue risk' : o.days_since_run > 56 ? ' — long spell, fitness unknown' : ''}`
      : 'Unknown — debut or no data',
    detail: 'Optimal performance window is 14-28 days between runs. Back-to-back (7 days) carries fatigue risk. Long spells (60+ days) carry fitness uncertainty.',
  })

  // 7. Age
  const ageFactor = AGE_FACTORS[Math.min(o.age, 8)] ?? 0.90
  if (o.age) dataPoints++
  factors.push({
    name: 'Age',
    factor: ageFactor,
    impact: (ageFactor - 1) * 100,
    dataAvailable: !!o.age,
    explanation: `${o.age} years old${o.age === 3 ? ' — PEAK improvement age (+5%)' : o.age === 4 ? ' — mature prime (+3%)' : o.age >= 7 ? ' — declining (-6%+)' : ''}`,
    detail: '3-year-olds show the highest win rates relative to market expectation (rapid improvement). 4yo is mature prime. Decline accelerates after 6.',
  })

  // 8. Favourite-Longshot Bias
  const flbFactor = getFlbFactor(o.back_price)
  dataPoints++ // back price always available
  factors.push({
    name: 'Favourite-Longshot Bias',
    factor: flbFactor,
    impact: (flbFactor - 1) * 100,
    dataAvailable: true,
    explanation: o.back_price < 3 ? `Short price ($${o.back_price.toFixed(2)}) — market OVER-estimates short-priced horses (-${((1 - flbFactor) * 100).toFixed(0)}%)` :
      o.back_price > 10 ? `Longshot ($${o.back_price.toFixed(2)}) — market UNDER-estimates longshots (+${((flbFactor - 1) * 100).toFixed(0)}%)` :
      `Mid-range ($${o.back_price.toFixed(2)}) — fairly priced by the market`,
    detail: 'The public over-bets favourites (emotional bias) and under-bets longshots. This is one of the oldest documented biases in racing markets.',
  })

  // Data confidence
  const maxPossible = 12 // form(5) + barrier + jockey + trainer + weight + age + freshness + FLB
  const confidence = dataPoints >= 10 ? 'HIGH' : dataPoints >= 6 ? 'MEDIUM' : 'LOW'

  return { factors, dataPoints, dataConfidence: confidence }
}

function ExplanationBubble({ overlay, bankroll }: { overlay: RacingOverlayRow; bankroll: number }) {
  const stake = kellyStake(overlay.we_net, bankroll, overlay.back_price, overlay.back_size)
  const netPrice = (overlay.back_price - 1) * 0.95 + 1
  const potentialProfit = stake * (netPrice - 1)
  const ev = stake * (overlay.we_net - 1)
  const { factors, dataPoints, dataConfidence } = computeFactorBreakdown(overlay)
  const combinedFactor = factors.reduce((acc, f) => acc * f.factor, 1.0)

  // Parse form into visual race history
  const formChars = overlay.form ? [...overlay.form] : []

  return (
    <div className="mt-3 rounded-lg border border-gray-700 bg-gray-800/80 p-4 text-xs space-y-4">

      {/* Data confidence header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold border ${
            dataConfidence === 'HIGH' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40' :
            dataConfidence === 'MEDIUM' ? 'bg-amber-500/20 text-amber-400 border-amber-500/40' :
            'bg-red-500/20 text-red-400 border-red-500/40'
          }`}>{dataConfidence} CONFIDENCE</span>
          <span className="text-gray-500">{dataPoints} data points used across 8 model factors</span>
        </div>
        <span className="text-gray-600">Meeting: {overlay.meeting}</span>
      </div>

      {/* Section 1: Why this is an overlay */}
      <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
        <h4 className="font-bold text-emerald-400 mb-2">Why is this an overlay?</h4>
        <p className="text-gray-300 leading-relaxed">
          Our 8-factor model estimates a <span className="text-emerald-400 font-mono font-bold">{(overlay.model_prob * 100).toFixed(1)}%</span> win
          probability for <span className="text-white font-bold">{overlay.name}</span>, but the Betfair market implies only <span className="text-amber-400 font-mono font-bold">{(overlay.market_prob * 100).toFixed(1)}%</span> (back
          odds of {overlay.back_price.toFixed(2)}). That's a <span className="text-emerald-400 font-bold">+{(overlay.edge * 100).toFixed(1)}%</span> edge
          — the crowd has underpriced this runner.
        </p>
      </div>

      {/* Section 2: Race form visual history */}
      <div>
        <h4 className="font-bold text-white mb-2">Race Form History</h4>
        {formChars.length > 0 ? (
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
              const label = isDigit ? (pos === 0 ? '10+' : `${pos}${pos === 1 ? 'st' : pos === 2 ? 'nd' : pos === 3 ? 'rd' : 'th'}`) :
                ch.toLowerCase() === 'x' ? 'DNF' : ch.toUpperCase()
              return (
                <div key={i} className={`flex flex-col items-center`}>
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center font-mono font-bold text-sm ${bg}`}>
                    {ch === '0' ? '10+' : ch.toUpperCase()}
                  </div>
                  <span className="text-[9px] text-gray-500 mt-0.5">Race {i + 1}</span>
                </div>
              )
            })}
            <span className="text-gray-500 ml-2 text-[10px]">→ RECENT</span>
          </div>
        ) : (
          <p className="text-amber-400">No form data available — debut runner. Higher risk, no track record.</p>
        )}
        {formChars.length > 0 && (
          <p className="text-gray-500 mt-2">
            Form score: <span className="font-mono text-white">{scoreForm(overlay.form).toFixed(3)}</span> (0 = terrible, 1 = perfect).
            Most recent result weighted 35%, then 25%, 20%, 12%, 8%.
          </p>
        )}
      </div>

      {/* Section 3: 8-Factor Model Breakdown */}
      <div>
        <h4 className="font-bold text-white mb-2">8-Factor Model Breakdown</h4>
        <p className="text-gray-500 mb-3">
          Starting from market-implied probability of {(overlay.market_prob * 100).toFixed(1)}%, each factor adjusts up or down:
        </p>
        <div className="space-y-1.5">
          {factors.map((f, i) => (
            <div key={i} className="rounded-lg border border-gray-700 bg-gray-900/50 p-2.5">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-white font-semibold">{i + 1}. {f.name}</span>
                  {!f.dataAvailable && (
                    <span className="rounded px-1.5 py-0.5 text-[9px] bg-amber-500/20 text-amber-400 border border-amber-500/30">NO DATA</span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-gray-400">×{f.factor.toFixed(3)}</span>
                  <span className={`font-mono font-bold min-w-[50px] text-right ${f.impact > 0 ? 'text-emerald-400' : f.impact < 0 ? 'text-red-400' : 'text-gray-500'}`}>
                    {f.impact > 0 ? '+' : ''}{f.impact.toFixed(1)}%
                  </span>
                  {/* Visual bar */}
                  <div className="w-20 h-2 rounded-full bg-gray-700 overflow-hidden">
                    {f.impact >= 0 ? (
                      <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.min(f.impact * 5, 100)}%`, marginLeft: '50%' }} />
                    ) : (
                      <div className="h-full bg-red-500 rounded-full float-right" style={{ width: `${Math.min(Math.abs(f.impact) * 5, 50)}%`, marginRight: '50%' }} />
                    )}
                  </div>
                </div>
              </div>
              <p className="text-gray-400 text-[11px]">{f.explanation}</p>
              <p className="text-gray-600 text-[10px] mt-0.5">{f.detail}</p>
            </div>
          ))}
        </div>

        {/* Combined factor */}
        <div className="mt-3 rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-3">
          <div className="flex items-center justify-between">
            <span className="font-bold text-white">Combined Factor (all 8 multiplied)</span>
            <span className={`font-mono font-bold text-lg ${combinedFactor > 1 ? 'text-emerald-400' : 'text-red-400'}`}>
              ×{combinedFactor.toFixed(4)}
            </span>
          </div>
          <p className="text-gray-400 mt-1">
            Market prob {(overlay.market_prob * 100).toFixed(1)}% × {combinedFactor.toFixed(4)} = Model prob <span className="text-emerald-400 font-bold">{(overlay.model_prob * 100).toFixed(1)}%</span>
          </p>
        </div>
      </div>

      {/* Section 4: W.E. Step-by-step calculation */}
      <div>
        <h4 className="font-bold text-white mb-2">Win Expectation Calculation</h4>
        <div className="font-mono text-[11px] bg-gray-900 rounded-lg p-3 space-y-1 border border-gray-700">
          <p className="text-gray-500">Step 1: Market implied probability</p>
          <p className="text-gray-300 ml-4">1 / {overlay.back_price.toFixed(2)} = {(overlay.market_prob * 100).toFixed(1)}%</p>
          <p className="text-gray-500 mt-2">Step 2: Apply 8-factor model adjustment</p>
          <p className="text-gray-300 ml-4">{(overlay.market_prob * 100).toFixed(1)}% × {combinedFactor.toFixed(4)} = {(overlay.model_prob * 100).toFixed(1)}% (model probability)</p>
          <p className="text-gray-500 mt-2">Step 3: Calculate net odds after 5% Betfair commission</p>
          <p className="text-gray-300 ml-4">({overlay.back_price.toFixed(2)} - 1) × 0.95 + 1 = {netPrice.toFixed(3)}</p>
          <p className="text-gray-500 mt-2">Step 4: Win Expectation</p>
          <p className="text-gray-300 ml-4">W.E. = {(overlay.model_prob * 100).toFixed(1)}% × {netPrice.toFixed(3)} = <span className={overlay.we_net > 1.05 ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>{overlay.we_net.toFixed(3)}</span></p>
          <p className={`mt-2 font-bold ${overlay.we_net > 1.05 ? 'text-emerald-400' : 'text-amber-400'}`}>
            {overlay.we_net > 1.05
              ? `W.E. > 1.05 → OVERLAY. For every $1 bet, expected return is $${overlay.we_net.toFixed(3)} (${((overlay.we_net - 1) * 100).toFixed(1)}% profit).`
              : `W.E. ${overlay.we_net.toFixed(3)} — marginal. Commission eats most of the edge.`}
          </p>
        </div>
      </div>

      {/* Section 5: Jockey & Trainer */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-gray-700 bg-gray-900/50 p-3">
          <h4 className="font-bold text-white mb-1">Jockey</h4>
          <p className="text-white font-semibold">{overlay.jockey || 'Unknown'}</p>
          {ELITE_JOCKEYS.has(overlay.jockey) ? (
            <span className="mt-1 inline-block rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 px-2 py-0.5 text-[10px] font-bold">ELITE — Top 20 AU</span>
          ) : (
            <span className="mt-1 inline-block text-gray-500 text-[10px]">Standard — no premium adjustment</span>
          )}
        </div>
        <div className="rounded-lg border border-gray-700 bg-gray-900/50 p-3">
          <h4 className="font-bold text-white mb-1">Trainer</h4>
          <p className="text-white font-semibold">{overlay.trainer || 'Unknown'}</p>
          {ELITE_TRAINERS.has(overlay.trainer) ? (
            <span className="mt-1 inline-block rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 px-2 py-0.5 text-[10px] font-bold">ELITE — Top 20 AU</span>
          ) : (
            <span className="mt-1 inline-block text-gray-500 text-[10px]">Standard — no premium adjustment</span>
          )}
        </div>
      </div>

      {/* Section 6: Recommended Bet */}
      <div className="rounded-lg border-2 border-emerald-500/30 bg-emerald-500/10 p-4">
        <h4 className="font-bold text-emerald-400 mb-3 text-sm">Recommended Bet (Quarter-Kelly Criterion)</h4>
        <div className="grid grid-cols-4 gap-3 mb-3">
          <div>
            <span className="text-[10px] text-gray-500 block">Stake</span>
            <span className="font-mono font-bold text-white text-lg">${stake}</span>
          </div>
          <div>
            <span className="text-[10px] text-gray-500 block">If Wins</span>
            <span className="font-mono font-bold text-emerald-400 text-lg">+${potentialProfit.toFixed(2)}</span>
          </div>
          <div>
            <span className="text-[10px] text-gray-500 block">Expected Value</span>
            <span className="font-mono font-bold text-emerald-400 text-lg">+${ev.toFixed(2)}</span>
          </div>
          <div>
            <span className="text-[10px] text-gray-500 block">% of Bankroll</span>
            <span className="font-mono font-bold text-white text-lg">{((stake / bankroll) * 100).toFixed(1)}%</span>
          </div>
        </div>
        <div className="text-[10px] text-gray-500 space-y-0.5">
          <p>Bankroll: ${bankroll.toLocaleString()} | Kelly fraction: 25% (conservative — Alan used 66%)</p>
          <p>Constraints: max 5% of bankroll per bet (${(bankroll * 0.05).toFixed(0)}), max 10% of available liquidity (${(overlay.back_size * 0.1).toFixed(0)})</p>
          <p>Available to back: <span className="text-white">${overlay.back_size.toFixed(0)}</span> at <span className="text-white">{overlay.back_price.toFixed(2)}</span>
            {overlay.lay_price ? <> | Lay: <span className="text-red-400">{overlay.lay_price.toFixed(2)}</span></> : ''}
          </p>
        </div>
      </div>

      {/* Section 7: What we DON'T know */}
      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
        <h4 className="font-bold text-amber-400 mb-1">Data Limitations</h4>
        <ul className="text-gray-500 space-y-0.5 text-[10px] list-disc list-inside">
          <li>Form string only shows positions (1st-9th), not margins, distances, or track conditions</li>
          <li>No historical win/place stats for this specific jockey-trainer combination</li>
          <li>No track-specific performance data (some horses perform better on certain surfaces)</li>
          <li>No speed ratings or sectional times available from Betfair metadata</li>
          <li>Weather/track condition impact not factored (would need BOM integration)</li>
          <li>No stall/gate speed data or race pace analysis</li>
        </ul>
        <p className="text-gray-600 mt-1 text-[10px]">
          Adding these data sources would significantly improve model accuracy. Current model uses {dataPoints} data points from Betfair metadata only.
        </p>
      </div>
    </div>
  )
}

function OverlayFinderSection({ bankroll }: { bankroll: number }) {
  const queryClient = useQueryClient()
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const { data: overlayBets, isLoading: overlaysLoading } = useQuery({
    queryKey: ['overlay_bets'],
    queryFn: fetchOverlayBets,
    refetchInterval: 30000,
  })

  const scanMutation = useMutation({
    mutationFn: triggerFindOverlays,
    onSuccess: () => {
      // Poll for fresh results after a delay
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ['overlay_bets'] }), 8000)
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ['overlay_bets'] }), 15000)
    },
  })

  const bets = overlayBets || []
  const overlays = bets.filter(b => b.verdict === 'OVERLAY')
  const marginals = bets.filter(b => b.verdict === 'MARGINAL')

  return (
    <div className="rounded-xl border-2 border-emerald-500/30 bg-gray-900 p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-bold text-white">Find Overlay Bets</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Scan Betfair Exchange for mispriced horse racing markets using the Alan Woods model
          </p>
        </div>
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
              Scanning Betfair...
            </>
          ) : (
            'Find Overlay Bets'
          )}
        </button>
      </div>

      {scanMutation.isPending && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-700 bg-amber-900/20 px-4 py-2 text-xs text-amber-400">
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Scanning all AU horse racing meetings on Betfair Exchange... Results will appear shortly.
        </div>
      )}

      {/* Summary stats */}
      {bets.length > 0 && (
        <div className="grid grid-cols-4 gap-3 mb-4">
          <div className="rounded-lg bg-gray-800 p-3">
            <span className="text-[10px] text-gray-500">Overlays</span>
            <p className="text-lg font-bold font-mono text-emerald-400">{overlays.length}</p>
          </div>
          <div className="rounded-lg bg-gray-800 p-3">
            <span className="text-[10px] text-gray-500">Marginal</span>
            <p className="text-lg font-bold font-mono text-amber-400">{marginals.length}</p>
          </div>
          <div className="rounded-lg bg-gray-800 p-3">
            <span className="text-[10px] text-gray-500">Best W.E.</span>
            <p className="text-lg font-bold font-mono text-emerald-400">
              {bets.length > 0 ? Math.max(...bets.map(b => b.we_net)).toFixed(3) : '—'}
            </p>
          </div>
          <div className="rounded-lg bg-gray-800 p-3">
            <span className="text-[10px] text-gray-500">Total Kelly Stake</span>
            <p className="text-lg font-bold font-mono text-white">
              ${overlays.reduce((s, o) => s + kellyStake(o.we_net, bankroll, o.back_price, o.back_size), 0)}
            </p>
          </div>
        </div>
      )}

      {/* Results */}
      {overlaysLoading ? (
        <div className="flex h-24 items-center justify-center text-sm text-gray-500">Loading...</div>
      ) : bets.length === 0 ? (
        <div className="flex h-24 items-center justify-center text-sm text-gray-500">
          Click "Find Overlay Bets" to scan Betfair for today's best racing overlays
        </div>
      ) : (
        <div className="space-y-2">
          {bets.map(o => {
            const stake = kellyStake(o.we_net, bankroll, o.back_price, o.back_size)
            const isOverlay = o.verdict === 'OVERLAY'
            const isExpanded = expandedId === o.id

            return (
              <div key={o.id} className={`rounded-lg border ${isOverlay ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-gray-700 bg-gray-800/30'}`}>
                <button
                  onClick={() => setExpandedId(isExpanded ? null : o.id)}
                  className="w-full text-left px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    {/* Verdict badge */}
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold border ${
                      isOverlay
                        ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                        : 'bg-amber-500/20 text-amber-400 border-amber-500/40'
                    }`}>{o.verdict}</span>

                    {/* Tier */}
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold border ${
                      o.tier === 'STRONG' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40' :
                      o.tier === 'MODERATE' ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/40' :
                      'bg-amber-500/20 text-amber-400 border-amber-500/40'
                    }`}>{o.tier}</span>

                    {/* Horse name */}
                    <span className="font-bold text-white text-sm">{o.name}</span>
                    <span className="text-xs text-gray-500">({o.age}yo, {o.trainer})</span>

                    {/* Race */}
                    <span className="text-xs text-cyan-400">{o.race}</span>

                    <div className="ml-auto flex items-center gap-4">
                      {/* Back price */}
                      <div className="text-right">
                        <span className="text-[10px] text-gray-500 block">Back</span>
                        <span className="font-mono font-bold text-white">{o.back_price.toFixed(2)}</span>
                        <span className="text-[10px] text-gray-500 ml-1">(${o.back_size.toFixed(0)})</span>
                      </div>

                      {/* Edge */}
                      <div className="text-right">
                        <span className="text-[10px] text-gray-500 block">Edge</span>
                        <span className="font-mono font-bold text-emerald-400">+{(o.edge * 100).toFixed(1)}%</span>
                      </div>

                      {/* W.E. */}
                      <div className="text-right">
                        <span className="text-[10px] text-gray-500 block">W.E.</span>
                        <span className={`font-mono font-bold ${o.we_net > 1.05 ? 'text-emerald-400' : 'text-amber-400'}`}>{o.we_net.toFixed(3)}</span>
                      </div>

                      {/* Recommended stake */}
                      <div className="text-right min-w-[60px]">
                        <span className="text-[10px] text-gray-500 block">Bet</span>
                        <span className="font-mono font-bold text-white">{stake > 0 ? `$${stake}` : '—'}</span>
                      </div>

                      {/* Start time */}
                      <div className="text-right">
                        <span className="text-[10px] text-gray-500 block">Start</span>
                        <span className="text-[10px] text-gray-400">{formatTime(o.start_time)}</span>
                      </div>

                      {/* Expand icon */}
                      <span className={`text-gray-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                        ▼
                      </span>
                    </div>
                  </div>
                </button>

                {/* Explanation bubble */}
                {isExpanded && (
                  <div className="px-4 pb-4">
                    <ExplanationBubble overlay={o} bankroll={bankroll} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Footer info */}
      <div className="mt-4 text-[10px] text-gray-600 leading-relaxed">
        Alan Woods formula: W.E. = P(win) × odds (net of 5% commission). Model uses 8 factors: form, barrier draw, jockey, trainer, weight, freshness, age, favourite-longshot bias. Click any row to see the full breakdown.
      </div>
    </div>
  )
}

async function fetchLiveBets(): Promise<LiveBet[]> {
  const { data, error } = await supabase
    .from('system_config')
    .select('value')
    .eq('key', 'live_betfair_bets')
    .single()
  if (error || !data?.value) return []
  const orders = data.value as Array<{bet_id: string; side: string; price: number; size: number; matched: number; remaining: number; status: string; placed: string}>

  // Group by market (Gunston has 2 bet IDs)
  const gunston = orders.filter(o => o.bet_id === '422437009637' || o.bet_id === '422437182350')
  const chol = orders.filter(o => o.bet_id === '422437183925')

  const bets: LiveBet[] = []
  if (gunston.length > 0) {
    const totalMatched = gunston.reduce((s, o) => s + (o.matched || 0), 0)
    const totalRemaining = gunston.reduce((s, o) => s + (o.remaining || 0), 0)
    bets.push({
      player: 'Jack Gunston',
      market: 'Goals - Jack Gunston',
      selection: 'Over 1.5 Goals',
      odds: 1.28,
      stake: 100,
      matched: totalMatched,
      unmatched: totalRemaining,
      potential_profit: totalMatched * (1.28 - 1) * 0.95,
      game: 'Hawthorn v Sydney Swans',
      bet_id: gunston.map(o => o.bet_id).join(' / '),
      status: totalRemaining === 0 ? 'MATCHED' : 'PARTIAL',
    })
  }
  if (chol.length > 0) {
    const o = chol[0]
    bets.push({
      player: 'Mabior Chol',
      market: 'Goals - Mabior Chol',
      selection: 'Over 1.5 Goals',
      odds: 2.06,
      stake: 100,
      matched: o.matched || 0,
      unmatched: o.remaining || 0,
      potential_profit: (o.matched || 0) * (2.06 - 1) * 0.95,
      game: 'Hawthorn v Sydney Swans',
      bet_id: o.bet_id,
      status: (o.remaining || 0) === 0 ? 'MATCHED' : 'PARTIAL',
    })
  }
  return bets
}

export function DashboardPage() {
  const { data: bets, isLoading, error } = useAllBets()
  const viewMode = useViewMode()
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
  const allBets = viewMode === 'live'
    ? rawBets.filter(b => b.notes?.includes('LIVE'))
    : rawBets.filter(b => !b.notes?.includes('LIVE'))
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

      {/* Find Overlay Bets — main feature */}
      {sportMode === 'racing' && <OverlayFinderSection bankroll={2546} />}

      <KPICards bets={allBets} />

      {/* Live Betfair Bets */}
      {LIVE_BETS.length > 0 && (
        <div className="rounded-xl border-2 border-cyan-500/30 bg-gray-900 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-white">Live Betfair Bets</h3>
            <span className="text-xs text-cyan-400">Betfair Balance: $2,300 AUD</span>
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
