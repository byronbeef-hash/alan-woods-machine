import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchSystemConfig, updateSystemConfig } from '../lib/queries'
import { LoadingSpinner } from '../components/common/LoadingSpinner'
import { supabase } from '../lib/supabase'

// ---------------------------------------------------------------------------
// Sport definitions
// ---------------------------------------------------------------------------

const SPORTS = [
  { key: 'racing', label: 'Horse Racing', icon: '#' },
  { key: 'basketball_nba', label: 'NBA', icon: '@' },
  { key: 'aussierules_afl', label: 'AFL', icon: '&' },
  { key: 'soccer_epl', label: 'Soccer', icon: '*' },
]

// ---------------------------------------------------------------------------
// Toggle component
// ---------------------------------------------------------------------------

function Toggle({ enabled, onChange, size = 'md' }: { enabled: boolean; onChange: (v: boolean) => void; size?: 'sm' | 'md' }) {
  const h = size === 'sm' ? 'h-5 w-9' : 'h-6 w-11'
  const dot = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'
  const tx = enabled ? (size === 'sm' ? 'translate-x-[18px]' : 'translate-x-6') : 'translate-x-1'
  return (
    <button
      onClick={() => onChange(!enabled)}
      className={`relative inline-flex ${h} items-center rounded-full transition-colors ${enabled ? 'bg-cyan-600' : 'bg-gray-700'}`}
    >
      <span className={`inline-block ${dot} transform rounded-full bg-white transition-transform ${tx}`} />
    </button>
  )
}

// ---------------------------------------------------------------------------
// Slider component
// ---------------------------------------------------------------------------

function Slider({ value, min, max, step, onChange, prefix = '', suffix = '', presets }: {
  value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; prefix?: string; suffix?: string;
  presets?: number[]
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={e => onChange(parseFloat(e.target.value))}
          className="flex-1 h-2 rounded-full appearance-none bg-gray-700 accent-cyan-500 cursor-pointer
                     [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4
                     [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cyan-400 [&::-webkit-slider-thumb]:cursor-pointer"
        />
        <span className="text-lg font-mono font-bold text-white min-w-[80px] text-right">
          {prefix}{typeof value === 'number' ? value.toLocaleString() : value}{suffix}
        </span>
      </div>
      {presets && (
        <div className="flex items-center gap-1.5">
          {presets.map(p => (
            <button
              key={p}
              onClick={() => onChange(p)}
              className={`rounded px-2 py-0.5 text-[10px] font-mono transition-colors ${
                value === p ? 'bg-cyan-600 text-white' : 'bg-gray-800 text-gray-500 hover:bg-gray-700'
              }`}
            >{prefix}{p.toLocaleString()}{suffix}</button>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Settings Page
// ---------------------------------------------------------------------------

export function SettingsPage() {
  const queryClient = useQueryClient()
  const { data: config, isLoading, error } = useQuery({
    queryKey: ['system-config'],
    queryFn: fetchSystemConfig,
  })

  const [local, setLocal] = useState<Record<string, unknown>>({})
  const [dirty, setDirty] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (config) setLocal(config)
  }, [config])

  const mutation = useMutation({
    mutationFn: async (changes: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(changes)) {
        await updateSystemConfig(key, value)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system-config'] })
      setDirty(new Set())
      setSaving(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    },
    onError: () => setSaving(false),
  })

  const set = (key: string, value: unknown) => {
    setLocal(prev => ({ ...prev, [key]: value }))
    setDirty(prev => new Set(prev).add(key))
  }

  const get = <T,>(key: string, fallback: T): T => {
    const v = local[key]
    return (v !== undefined && v !== null ? v : fallback) as T
  }

  const handleSave = () => {
    const changes: Record<string, unknown> = {}
    for (const key of dirty) changes[key] = local[key]
    setSaving(true)
    mutation.mutate(changes)
  }

  if (isLoading) return <LoadingSpinner />
  if (error) return <div className="text-red-400">Error loading settings: {(error as Error).message}</div>

  const mode = get<string>('woods_mode', 'demo')
  const scanMode = get<string>('scan_mode', 'manual')
  const activeSports = get<string[]>('active_sports', ['basketball_nba'])
  const bankroll = get<number>('starting_bankroll', 2546)
  const dailyBudget = get<number>('daily_budget', 100)
  const maxSingleBet = get<number>('max_single_bet', 10)
  const dailyStopLoss = get<number>('daily_stop_loss', 500)
  const scanFrequency = get<string>('scan_frequency', 'daily')
  const autoScanEnabled = get<boolean>('auto_scan_enabled', false)
  const kellyFraction = get<number>('kelly_fraction', 0.25)
  const minEdge = get<number>('min_edge_threshold', 0.03)
  const racingMinWe = get<number>('racing_min_we', 1.05)

  const isLive = mode === 'live'
  const isAutonomous = scanMode === 'autonomous'

  const toggleSport = (key: string) => {
    const updated = activeSports.includes(key)
      ? activeSports.filter(s => s !== key)
      : [...activeSports, key]
    set('active_sports', updated)
  }

  const selectAllSports = () => set('active_sports', SPORTS.map(s => s.key))

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Settings</h2>
          <p className="text-xs text-gray-500 mt-0.5">Configure the Alan Woods autonomous betting system</p>
        </div>
        <div className="flex items-center gap-3">
          {saved && <span className="text-sm text-emerald-400 font-medium">Saved</span>}
          <button
            onClick={handleSave}
            disabled={dirty.size === 0 || saving}
            className="rounded-lg bg-cyan-600 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : `Save${dirty.size > 0 ? ` (${dirty.size} changes)` : ''}`}
          </button>
        </div>
      </div>

      {/* ================================================================= */}
      {/* STEP 1: MODE — Demo or Live                                       */}
      {/* ================================================================= */}
      <div className="rounded-xl border-2 border-gray-700 bg-gray-900 p-5">
        <div className="flex items-center gap-3 mb-4">
          <span className="rounded-full bg-gray-800 px-2.5 py-1 text-[10px] font-bold text-gray-400">STEP 1</span>
          <h3 className="text-sm font-bold text-white">Trading Mode</h3>
          <div className={`ml-auto px-3 py-1 rounded-full text-xs font-bold ${
            isLive ? 'bg-red-500/20 text-red-400 border border-red-500/40' : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
          }`}>
            {isLive ? 'LIVE' : 'DEMO'}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => set('woods_mode', 'demo')}
            className={`rounded-lg p-4 text-left transition-all ${
              !isLive ? 'bg-emerald-500/10 border-2 border-emerald-500/50' : 'bg-gray-800 border-2 border-gray-700 hover:border-gray-600'
            }`}
          >
            <span className={`text-sm font-bold ${!isLive ? 'text-emerald-400' : 'text-gray-400'}`}>Demo Mode</span>
            <p className="text-xs text-gray-500 mt-1">Paper trade, learn from results, backtest strategies. No real money.</p>
            <p className="text-[10px] text-gray-600 mt-2">The system learns from every demo bet to improve its live predictions.</p>
          </button>

          <button
            onClick={() => set('woods_mode', 'live')}
            className={`rounded-lg p-4 text-left transition-all ${
              isLive ? 'bg-red-500/10 border-2 border-red-500/50' : 'bg-gray-800 border-2 border-gray-700 hover:border-gray-600'
            }`}
          >
            <span className={`text-sm font-bold ${isLive ? 'text-red-400' : 'text-gray-400'}`}>Live Trading</span>
            <p className="text-xs text-gray-500 mt-1">Real bets on Betfair Exchange. Uses model refined from demo results.</p>
            <p className="text-[10px] text-gray-600 mt-2">Applies all risk limits below. Requires funded Betfair account.</p>
          </button>
        </div>

        {isLive && (
          <div className="mt-3 rounded-lg bg-red-500/10 border border-red-500/30 p-3">
            <p className="text-xs text-red-400 font-medium">
              Live mode places real bets with real money. All risk limits and stop-losses are enforced.
            </p>
          </div>
        )}
      </div>

      {/* ================================================================= */}
      {/* STEP 2: SPORTS — Select which sports to scan                      */}
      {/* ================================================================= */}
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
        <div className="flex items-center gap-3 mb-4">
          <span className="rounded-full bg-gray-800 px-2.5 py-1 text-[10px] font-bold text-gray-400">STEP 2</span>
          <h3 className="text-sm font-bold text-white">Active Sports</h3>
          <button
            onClick={selectAllSports}
            className="ml-auto rounded px-2.5 py-1 text-[10px] font-bold bg-gray-800 text-gray-400 hover:bg-gray-700 transition-colors"
          >Select All</button>
        </div>

        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {SPORTS.map(s => {
            const active = activeSports.includes(s.key)
            return (
              <button
                key={s.key}
                onClick={() => toggleSport(s.key)}
                className={`rounded-lg p-3 text-left transition-all ${
                  active ? 'bg-cyan-500/10 border-2 border-cyan-500/50' : 'bg-gray-800 border-2 border-gray-700 hover:border-gray-600'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-sm font-bold ${active ? 'text-cyan-400' : 'text-gray-500'}`}>{s.label}</span>
                  <div className={`h-3 w-3 rounded-full ${active ? 'bg-cyan-400' : 'bg-gray-700'}`} />
                </div>
              </button>
            )
          })}
        </div>

        <p className="text-[10px] text-gray-600 mt-3">
          {activeSports.length === 0 ? 'No sports selected — select at least one' :
           activeSports.length === SPORTS.length ? 'All sports active — system will scan across all markets' :
           `${activeSports.length} sport${activeSports.length > 1 ? 's' : ''} active`}
        </p>
      </div>

      {/* ================================================================= */}
      {/* STEP 3: MODE — Autonomous or Manual                               */}
      {/* ================================================================= */}
      <div className="rounded-xl border-2 border-gray-700 bg-gray-900 p-5">
        <div className="flex items-center gap-3 mb-4">
          <span className="rounded-full bg-gray-800 px-2.5 py-1 text-[10px] font-bold text-gray-400">STEP 3</span>
          <h3 className="text-sm font-bold text-white">Operation Mode</h3>
          <div className={`ml-auto px-3 py-1 rounded-full text-xs font-bold ${
            isAutonomous ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40' : 'bg-gray-700 text-gray-400 border border-gray-600'
          }`}>
            {isAutonomous ? 'AUTONOMOUS' : 'MANUAL'}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => set('scan_mode', 'autonomous')}
            className={`rounded-lg p-4 text-left transition-all ${
              isAutonomous ? 'bg-cyan-500/10 border-2 border-cyan-500/50' : 'bg-gray-800 border-2 border-gray-700 hover:border-gray-600'
            }`}
          >
            <span className={`text-sm font-bold ${isAutonomous ? 'text-cyan-400' : 'text-gray-400'}`}>Autonomous</span>
            <p className="text-xs text-gray-500 mt-1">System scans, selects, and places bets automatically — like Alan Woods.</p>
            <p className="text-[10px] text-gray-600 mt-2">Runs on schedule. Self-improves from backtesting results. Fully hands-off.</p>
          </button>

          <button
            onClick={() => set('scan_mode', 'manual')}
            className={`rounded-lg p-4 text-left transition-all ${
              !isAutonomous ? 'bg-cyan-500/10 border-2 border-cyan-500/50' : 'bg-gray-800 border-2 border-gray-700 hover:border-gray-600'
            }`}
          >
            <span className={`text-sm font-bold ${!isAutonomous ? 'text-cyan-400' : 'text-gray-400'}`}>Manual</span>
            <p className="text-xs text-gray-500 mt-1">You scan from the Planner, review each bet, and approve before placement.</p>
            <p className="text-[10px] text-gray-600 mt-2">Full control over every bet. Use the Planner tab to manage.</p>
          </button>
        </div>

        {/* Autonomous sub-settings */}
        {isAutonomous && (
          <div className="mt-4 space-y-4 rounded-lg bg-gray-800/50 p-4 border border-gray-700">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-300 font-medium">Auto-Scan Enabled</p>
                <p className="text-[10px] text-gray-600">Automatically scan markets on schedule</p>
              </div>
              <Toggle enabled={autoScanEnabled} onChange={v => set('auto_scan_enabled', v)} />
            </div>

            <div>
              <p className="text-xs text-gray-300 font-medium mb-2">Scan Frequency</p>
              <div className="flex items-center gap-2">
                {[
                  { key: 'hourly', label: 'Every Hour' },
                  { key: 'twice_daily', label: 'Twice Daily' },
                  { key: 'daily', label: 'Daily' },
                  { key: 'weekly', label: 'Weekly' },
                ].map(f => (
                  <button
                    key={f.key}
                    onClick={() => set('scan_frequency', f.key)}
                    className={`rounded px-3 py-1.5 text-xs font-bold transition-colors ${
                      scanFrequency === f.key ? 'bg-cyan-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                    }`}
                  >{f.label}</button>
                ))}
              </div>
            </div>

            <div className="rounded-lg bg-cyan-500/10 border border-cyan-500/30 p-3">
              <p className="text-xs text-cyan-400">
                {autoScanEnabled
                  ? `System will scan ${activeSports.length} sport${activeSports.length !== 1 ? 's' : ''} ${scanFrequency === 'hourly' ? 'every hour' : scanFrequency === 'twice_daily' ? 'at 6am and 12pm AEST' : scanFrequency === 'daily' ? 'at 6am AEST' : 'every Monday'}, find overlay bets, and ${isLive ? 'place them on Betfair' : 'paper-trade them in demo mode'} within your risk limits.`
                  : 'Enable auto-scan to run the system autonomously.'}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ================================================================= */}
      {/* STEP 4: BET SIZING — Sliders for per-bet and daily budget          */}
      {/* ================================================================= */}
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
        <div className="flex items-center gap-3 mb-5">
          <span className="rounded-full bg-gray-800 px-2.5 py-1 text-[10px] font-bold text-gray-400">STEP 4</span>
          <h3 className="text-sm font-bold text-white">Bet Sizing</h3>
        </div>

        <div className="space-y-6">
          {/* Bankroll */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-xs text-gray-300 font-medium">Bankroll</p>
                <p className="text-[10px] text-gray-600">Total capital available for betting</p>
              </div>
            </div>
            <Slider
              value={bankroll}
              min={100}
              max={25000}
              step={100}
              onChange={v => set('starting_bankroll', v)}
              prefix="$"
              presets={[500, 1000, 2500, 5000, 10000]}
            />
          </div>

          {/* Daily Budget */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-xs text-gray-300 font-medium">Daily Budget</p>
                <p className="text-[10px] text-gray-600">Maximum total stake per day across all bets ({((dailyBudget / bankroll) * 100).toFixed(1)}% of bankroll)</p>
              </div>
            </div>
            <Slider
              value={dailyBudget}
              min={10}
              max={Math.min(5000, bankroll)}
              step={10}
              onChange={v => set('daily_budget', v)}
              prefix="$"
              presets={[50, 100, 250, 500, 1000]}
            />
          </div>

          {/* Max Single Bet */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-xs text-gray-300 font-medium">Max Single Bet</p>
                <p className="text-[10px] text-gray-600">Maximum stake on any individual bet</p>
              </div>
            </div>
            <Slider
              value={maxSingleBet}
              min={5}
              max={Math.min(1000, dailyBudget)}
              step={5}
              onChange={v => set('max_single_bet', v)}
              prefix="$"
              presets={[10, 25, 50, 100, 200, 500]}
            />
          </div>

          {/* Daily Stop Loss */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-xs text-gray-300 font-medium">Daily Stop Loss</p>
                <p className="text-[10px] text-gray-600">Stop all betting if daily losses exceed this</p>
              </div>
            </div>
            <Slider
              value={dailyStopLoss}
              min={50}
              max={Math.min(5000, bankroll * 0.5)}
              step={50}
              onChange={v => set('daily_stop_loss', v)}
              prefix="$"
              presets={[100, 250, 500, 1000]}
            />
          </div>

          {/* Summary */}
          <div className="rounded-lg bg-gray-800 p-4 grid grid-cols-4 gap-3">
            <div>
              <span className="text-[10px] text-gray-500 block">Bankroll</span>
              <span className="text-sm font-mono font-bold text-white">${bankroll.toLocaleString()}</span>
            </div>
            <div>
              <span className="text-[10px] text-gray-500 block">Daily Budget</span>
              <span className="text-sm font-mono font-bold text-cyan-400">${dailyBudget.toLocaleString()}</span>
            </div>
            <div>
              <span className="text-[10px] text-gray-500 block">Max Bet</span>
              <span className="text-sm font-mono font-bold text-white">${maxSingleBet}</span>
            </div>
            <div>
              <span className="text-[10px] text-gray-500 block">Stop Loss</span>
              <span className="text-sm font-mono font-bold text-red-400">-${dailyStopLoss}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ================================================================= */}
      {/* STEP 5: MODEL TUNING — Kelly, edge thresholds, W.E.               */}
      {/* ================================================================= */}
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
        <div className="flex items-center gap-3 mb-5">
          <span className="rounded-full bg-gray-800 px-2.5 py-1 text-[10px] font-bold text-gray-400">STEP 5</span>
          <h3 className="text-sm font-bold text-white">Model Tuning</h3>
        </div>

        <div className="space-y-5">
          {/* Kelly Fraction */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-xs text-gray-300 font-medium">Kelly Fraction</p>
                <p className="text-[10px] text-gray-600">Fraction of full Kelly to use (0.25 = quarter-Kelly, safer)</p>
              </div>
            </div>
            <Slider
              value={Math.round(kellyFraction * 100)}
              min={5}
              max={100}
              step={5}
              onChange={v => set('kelly_fraction', v / 100)}
              suffix="%"
              presets={[10, 25, 50, 100]}
            />
          </div>

          {/* Min Edge */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-xs text-gray-300 font-medium">Minimum Edge</p>
                <p className="text-[10px] text-gray-600">Only bet when model edge exceeds this %</p>
              </div>
            </div>
            <Slider
              value={Math.round(minEdge * 100)}
              min={1}
              max={15}
              step={1}
              onChange={v => set('min_edge_threshold', v / 100)}
              suffix="%"
              presets={[2, 3, 5, 8, 10]}
            />
          </div>

          {/* Min W.E. for Racing */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-xs text-gray-300 font-medium">Min W.E. (Racing)</p>
                <p className="text-[10px] text-gray-600">Win Expectation threshold for horse racing overlays</p>
              </div>
            </div>
            <Slider
              value={Math.round(racingMinWe * 100) / 100}
              min={1.0}
              max={1.20}
              step={0.01}
              onChange={v => set('racing_min_we', v)}
              presets={[1.02, 1.05, 1.08, 1.10]}
            />
          </div>

          {/* Commission */}
          <div className="flex items-center justify-between rounded-lg bg-gray-800 p-3">
            <div>
              <p className="text-xs text-gray-300 font-medium">Betfair Commission</p>
              <p className="text-[10px] text-gray-600">Deducted from winnings</p>
            </div>
            <span className="text-sm font-mono font-bold text-white">{((get<number>('commission_rate', 0.05)) * 100).toFixed(1)}%</span>
          </div>
        </div>
      </div>

      {/* ================================================================= */}
      {/* SELF-IMPROVEMENT — How the system learns                           */}
      {/* ================================================================= */}
      <div className="rounded-xl border-2 border-cyan-500/30 bg-cyan-500/5 p-5">
        <h3 className="text-sm font-bold text-white mb-3">Self-Improvement Engine</h3>
        <p className="text-xs text-gray-400 mb-4">
          Like the original Alan Woods system, this engine continuously learns and improves from every bet placed.
        </p>

        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg bg-gray-900 border border-gray-800 p-3">
            <span className="text-[10px] text-gray-500 block mb-1">Demo Backtesting</span>
            <p className="text-xs text-gray-300">Every demo bet tests the model against real outcomes. Win rate, edge accuracy, and Kelly sizing are tracked to calibrate the live model.</p>
          </div>
          <div className="rounded-lg bg-gray-900 border border-gray-800 p-3">
            <span className="text-[10px] text-gray-500 block mb-1">Live Feedback Loop</span>
            <p className="text-xs text-gray-300">Live results feed back into the model. Factors like jockey/trainer success rates, barrier stats, and form weights are adjusted over time.</p>
          </div>
          <div className="rounded-lg bg-gray-900 border border-gray-800 p-3">
            <span className="text-[10px] text-gray-500 block mb-1">Risk Adaptation</span>
            <p className="text-xs text-gray-300">The system adjusts Kelly fraction and bet sizing based on recent variance. Reduces exposure during losing runs, increases during validated edges.</p>
          </div>
        </div>

        <div className="mt-4 rounded-lg bg-gray-900 border border-gray-800 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">Learning Pipeline</span>
            <span className="text-[10px] text-gray-600">Demo bets &rarr; Backtest &rarr; Calibrate &rarr; Live model &rarr; Live bets &rarr; Results &rarr; Refine</span>
          </div>
        </div>
      </div>

      {/* ================================================================= */}
      {/* RUNNER & INFRASTRUCTURE                                            */}
      {/* ================================================================= */}
      <RunnerHealthPanel />

      {/* ================================================================= */}
      {/* BETFAIR CONNECTION                                                 */}
      {/* ================================================================= */}
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
        <h3 className="text-sm font-bold text-white mb-3">Betfair Exchange</h3>
        <div className="grid grid-cols-4 gap-3">
          <div className="rounded-lg bg-gray-800 p-3">
            <span className="text-[10px] text-gray-500 block">Account</span>
            <span className="text-xs font-mono text-gray-300">trdickinson</span>
          </div>
          <div className="rounded-lg bg-gray-800 p-3">
            <span className="text-[10px] text-gray-500 block">App Key</span>
            <span className="text-xs font-mono text-gray-300">mbbTz...NoOl</span>
          </div>
          <div className="rounded-lg bg-gray-800 p-3">
            <span className="text-[10px] text-gray-500 block">Status</span>
            <span className="text-xs text-emerald-400 font-bold">Connected</span>
          </div>
          <div className="rounded-lg bg-gray-800 p-3">
            <span className="text-[10px] text-gray-500 block">Commission</span>
            <span className="text-xs font-mono text-gray-300">5%</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Runner Health Panel
// ---------------------------------------------------------------------------

function RunnerHealthPanel() {
  const { data } = useQuery({
    queryKey: ['runner_health'],
    queryFn: async () => {
      const { data: configs } = await supabase
        .from('system_config')
        .select('key, value, updated_at')
        .in('key', ['runner_heartbeat', 'activity_log'])

      const { count: overlayCount } = await supabase
        .from('racing_overlays')
        .select('*', { count: 'exact', head: true })

      const { count: betCount } = await supabase
        .from('bets')
        .select('*', { count: 'exact', head: true })

      const configMap: Record<string, { value: unknown; updated_at: string }> = {}
      for (const c of configs || []) configMap[c.key] = { value: c.value, updated_at: c.updated_at }

      const heartbeat = configMap.runner_heartbeat?.value as { ts: string; source: string; status: string } | null
      const actLog = configMap.activity_log?.value as Array<{ ts: string; msg: string; type: string }> | null
      const lastActivity = actLog && actLog.length > 0 ? actLog[actLog.length - 1] : null

      return { heartbeat, lastActivity, overlayCount: overlayCount || 0, betCount: betCount || 0 }
    },
    refetchInterval: 60000,
  })

  if (!data) return null

  const heartbeatAge = data.heartbeat?.ts
    ? Math.round((Date.now() - new Date(data.heartbeat.ts).getTime()) / 60000)
    : null

  const isHealthy = heartbeatAge !== null && heartbeatAge < 360 // 6 hours
  const sourceLabel = data.heartbeat?.source === 'github_actions' ? 'GitHub Actions' : data.heartbeat?.source || 'Unknown'

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
      <div className="flex items-center gap-3 mb-4">
        <h3 className="text-sm font-bold text-white">Runner Infrastructure</h3>
        <span className={`ml-auto rounded-full px-2.5 py-1 text-[10px] font-bold border ${
          isHealthy ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40' : 'bg-red-500/20 text-red-400 border-red-500/40'
        }`}>{isHealthy ? 'HEALTHY' : heartbeatAge === null ? 'NO DATA' : 'STALE'}</span>
      </div>

      <div className="grid grid-cols-4 gap-3 mb-3">
        <div className="rounded-lg bg-gray-800 p-3">
          <span className="text-[10px] text-gray-500 block">Runner</span>
          <span className="text-xs font-bold text-gray-300">{sourceLabel}</span>
        </div>
        <div className="rounded-lg bg-gray-800 p-3">
          <span className="text-[10px] text-gray-500 block">Last Heartbeat</span>
          <span className="text-xs font-mono text-gray-300">
            {heartbeatAge !== null ? (heartbeatAge < 60 ? `${heartbeatAge}m ago` : `${Math.round(heartbeatAge / 60)}h ago`) : 'Never'}
          </span>
        </div>
        <div className="rounded-lg bg-gray-800 p-3">
          <span className="text-[10px] text-gray-500 block">Racing Overlays</span>
          <span className="text-xs font-mono font-bold text-white">{data.overlayCount}</span>
        </div>
        <div className="rounded-lg bg-gray-800 p-3">
          <span className="text-[10px] text-gray-500 block">Total Bets</span>
          <span className="text-xs font-mono font-bold text-white">{data.betCount}</span>
        </div>
      </div>

      {data.lastActivity && (
        <div className="rounded-lg bg-gray-800/50 border border-gray-700 p-2.5">
          <span className="text-[10px] text-gray-500 block">Last Activity</span>
          <span className="text-xs text-gray-300">{data.lastActivity.msg}</span>
        </div>
      )}

      {!isHealthy && (
        <div className="mt-3 rounded-lg bg-amber-500/10 border border-amber-500/30 p-3">
          <p className="text-xs text-amber-400">
            Runner hasn't checked in recently. Scans run automatically via GitHub Actions (3x daily for racing, 1x for NBA).
            If this persists, check the <a href="https://github.com/byronbeef-hash/alan-woods-machine/actions" target="_blank" className="underline">Actions tab</a> on GitHub.
          </p>
        </div>
      )}
    </div>
  )
}
