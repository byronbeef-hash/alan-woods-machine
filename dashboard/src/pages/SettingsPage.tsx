import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchSystemConfig, updateSystemConfig } from '../lib/queries'
import { LoadingSpinner } from '../components/common/LoadingSpinner'
import { SPORT_LABELS } from '../lib/types'

interface SettingField {
  key: string
  label: string
  min: number
  max: number
  step: number
  format: 'percent' | 'dollar' | 'number'
}

const KELLY_FIELDS: SettingField[] = [
  { key: 'kelly_fraction', label: 'Kelly Fraction', min: 0.05, max: 1.0, step: 0.05, format: 'percent' },
  { key: 'tier_cap_strong', label: 'Strong Tier Cap', min: 0.01, max: 0.25, step: 0.01, format: 'percent' },
  { key: 'tier_cap_moderate', label: 'Moderate Tier Cap', min: 0.01, max: 0.15, step: 0.01, format: 'percent' },
  { key: 'tier_cap_marginal', label: 'Marginal Tier Cap', min: 0.01, max: 0.10, step: 0.01, format: 'percent' },
  { key: 'max_bet_fraction', label: 'Max Bet Fraction', min: 0.01, max: 0.25, step: 0.01, format: 'percent' },
]

const THRESHOLD_FIELDS: SettingField[] = [
  { key: 'min_edge_threshold', label: 'Min Edge Threshold', min: 0.01, max: 0.15, step: 0.01, format: 'percent' },
  { key: 'min_bet_size', label: 'Min Bet Size', min: 1, max: 100, step: 1, format: 'dollar' },
  { key: 'starting_bankroll', label: 'Starting Bankroll', min: 100, max: 100000, step: 100, format: 'dollar' },
]

const COMMISSION_FIELDS: SettingField[] = [
  { key: 'commission_rate', label: 'Commission Rate', min: 0, max: 0.15, step: 0.005, format: 'percent' },
]

const ALL_SPORTS = Object.entries(SPORT_LABELS)

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
    onError: () => {
      setSaving(false)
    },
  })

  const handleChange = (key: string, value: number) => {
    setLocal(prev => ({ ...prev, [key]: value }))
    setDirty(prev => new Set(prev).add(key))
  }

  const handleSportsChange = (sportKey: string, enabled: boolean) => {
    const current = (local['active_sports'] as string[]) || ['basketball_nba']
    const updated = enabled
      ? [...current, sportKey]
      : current.filter(s => s !== sportKey)
    setLocal(prev => ({ ...prev, active_sports: updated }))
    setDirty(prev => new Set(prev).add('active_sports'))
  }

  const handleSave = () => {
    const changes: Record<string, unknown> = {}
    for (const key of dirty) {
      changes[key] = local[key]
    }
    setSaving(true)
    mutation.mutate(changes)
  }

  if (isLoading) return <LoadingSpinner />
  if (error) return <div className="text-red-400">Error loading settings: {(error as Error).message}</div>

  const activeSports = (local['active_sports'] as string[]) || ['basketball_nba']
  const tradingMode = (local['woods_mode'] as string) || 'demo'
  const autoScanEnabled = (local['auto_scan_enabled'] as boolean) ?? false
  const scanMode = (local['scan_mode'] as string) || 'manual'

  const handleModeChange = (mode: string) => {
    setLocal(prev => ({ ...prev, woods_mode: mode }))
    setDirty(prev => new Set(prev).add('woods_mode'))
  }

  const handleScanModeChange = (mode: string) => {
    setLocal(prev => ({ ...prev, scan_mode: mode }))
    setDirty(prev => new Set(prev).add('scan_mode'))
  }

  const handleAutoScanToggle = (enabled: boolean) => {
    setLocal(prev => ({ ...prev, auto_scan_enabled: enabled }))
    setDirty(prev => new Set(prev).add('auto_scan_enabled'))
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">Settings</h2>
        <div className="flex items-center gap-3">
          {saved && <span className="text-sm text-emerald-400">Saved</span>}
          <button
            onClick={handleSave}
            disabled={dirty.size === 0 || saving}
            className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : `Save Changes${dirty.size > 0 ? ` (${dirty.size})` : ''}`}
          </button>
        </div>
      </div>

      <p className="text-xs text-gray-500">
        Changes take up to 5 minutes to be picked up by the Python worker.
      </p>

      {/* Trading Mode — prominent at the top */}
      <div className="rounded-xl border-2 border-gray-700 bg-gray-900 p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-300">Trading Mode</h3>
            <p className="text-xs text-gray-500 mt-1">Controls whether bets are placed on Betfair or paper-traded</p>
          </div>
          <div className={`px-3 py-1 rounded-full text-xs font-bold ${
            tradingMode === 'live'
              ? 'bg-red-500/20 text-red-400 border border-red-500/40'
              : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
          }`}>
            {tradingMode === 'live' ? '● LIVE' : '● DEMO'}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => handleModeChange('demo')}
            className={`rounded-lg p-4 text-left transition-all ${
              tradingMode === 'demo'
                ? 'bg-emerald-500/10 border-2 border-emerald-500/50 ring-1 ring-emerald-500/20'
                : 'bg-gray-800 border-2 border-gray-700 hover:border-gray-600'
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-lg">📊</span>
              <span className={`text-sm font-semibold ${tradingMode === 'demo' ? 'text-emerald-400' : 'text-gray-400'}`}>
                Demo Mode
              </span>
            </div>
            <p className="text-xs text-gray-500">Paper trading only. No real money at risk. Bets are simulated and tracked.</p>
          </button>

          <button
            onClick={() => handleModeChange('live')}
            className={`rounded-lg p-4 text-left transition-all ${
              tradingMode === 'live'
                ? 'bg-red-500/10 border-2 border-red-500/50 ring-1 ring-red-500/20'
                : 'bg-gray-800 border-2 border-gray-700 hover:border-gray-600'
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-lg">💰</span>
              <span className={`text-sm font-semibold ${tradingMode === 'live' ? 'text-red-400' : 'text-gray-400'}`}>
                Live Trading
              </span>
            </div>
            <p className="text-xs text-gray-500">Real bets placed on Betfair Exchange. Requires funded account and API key.</p>
          </button>
        </div>

        {tradingMode === 'live' && (
          <div className="mt-3 rounded-lg bg-red-500/10 border border-red-500/30 p-3">
            <p className="text-xs text-red-400 font-medium">
              ⚠️ Live mode will place real bets with real money on Betfair. Ensure your account is funded and API credentials are configured.
            </p>
          </div>
        )}

        {dirty.has('woods_mode') && (
          <p className="mt-2 text-xs text-cyan-400">* Mode change pending — click Save Changes to apply</p>
        )}
      </div>

      {/* Auto-Scan Toggle */}
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-300">Autonomous Auto-Scan</h3>
            <p className="text-xs text-gray-500 mt-1">
              Automatically scan markets and place best bets daily (min 4 bets/day when enabled)
            </p>
          </div>
          <button
            onClick={() => handleAutoScanToggle(!autoScanEnabled)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              autoScanEnabled ? 'bg-cyan-600' : 'bg-gray-700'
            }`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              autoScanEnabled ? 'translate-x-6' : 'translate-x-1'
            }`} />
          </button>
        </div>
        {autoScanEnabled && (
          <p className="mt-2 text-xs text-cyan-400">
            Auto-scan is enabled. The system will scan all active sports and place qualifying bets autonomously.
          </p>
        )}
      </div>

      {/* Scan Mode: Autonomous vs Manual */}
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
        <h3 className="text-sm font-semibold text-gray-300 mb-3">Scan Mode</h3>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => handleScanModeChange('autonomous')}
            className={`rounded-lg p-3 text-left transition-all ${
              scanMode === 'autonomous'
                ? 'bg-cyan-500/10 border-2 border-cyan-500/50'
                : 'bg-gray-800 border-2 border-gray-700 hover:border-gray-600'
            }`}
          >
            <span className={`text-sm font-semibold ${scanMode === 'autonomous' ? 'text-cyan-400' : 'text-gray-400'}`}>
              🤖 Autonomous
            </span>
            <p className="text-xs text-gray-500 mt-1">System scans and places bets automatically on schedule</p>
          </button>
          <button
            onClick={() => handleScanModeChange('manual')}
            className={`rounded-lg p-3 text-left transition-all ${
              scanMode === 'manual'
                ? 'bg-cyan-500/10 border-2 border-cyan-500/50'
                : 'bg-gray-800 border-2 border-gray-700 hover:border-gray-600'
            }`}
          >
            <span className={`text-sm font-semibold ${scanMode === 'manual' ? 'text-cyan-400' : 'text-gray-400'}`}>
              👤 Manual
            </span>
            <p className="text-xs text-gray-500 mt-1">You click Scan Now and approve each bet before placement</p>
          </button>
        </div>
      </div>

      {/* Risk Management */}
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
        <h3 className="text-sm font-semibold text-gray-300 mb-4">Risk Management</h3>
        <div className="space-y-4">
          {/* Bankroll Limit */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-400">Bankroll Limit</p>
              <p className="text-[10px] text-gray-600 mt-0.5">Maximum total bankroll for betting. System stops when reached.</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">$</span>
              <input
                type="number"
                value={typeof local['bankroll_limit'] === 'number' ? local['bankroll_limit'] : 10000}
                onChange={e => {
                  const v = parseFloat(e.target.value)
                  if (!isNaN(v) && v >= 0) {
                    setLocal(prev => ({ ...prev, bankroll_limit: v }))
                    setDirty(prev => new Set(prev).add('bankroll_limit'))
                  }
                }}
                className="w-28 rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-right text-sm font-mono text-white focus:border-cyan-500 focus:outline-none"
                step={500}
                min={0}
                max={100000}
              />
            </div>
          </div>

          {/* Max Daily Spend */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-400">Max Daily Spend</p>
              <p className="text-[10px] text-gray-600 mt-0.5">Maximum total stake per day across all bets</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">$</span>
              <input
                type="number"
                value={typeof local['daily_limit'] === 'number' ? local['daily_limit'] : 2000}
                onChange={e => {
                  const v = parseFloat(e.target.value)
                  if (!isNaN(v) && v >= 0) {
                    setLocal(prev => ({ ...prev, daily_limit: v }))
                    setDirty(prev => new Set(prev).add('daily_limit'))
                  }
                }}
                className="w-28 rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-right text-sm font-mono text-white focus:border-cyan-500 focus:outline-none"
                step={100}
                min={0}
                max={50000}
              />
            </div>
          </div>

          {/* Max Single Bet */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-400">Max Single Bet</p>
              <p className="text-[10px] text-gray-600 mt-0.5">Maximum stake on any single bet</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">$</span>
              <input
                type="number"
                value={typeof local['max_single_bet'] === 'number' ? local['max_single_bet'] : 500}
                onChange={e => {
                  const v = parseFloat(e.target.value)
                  if (!isNaN(v) && v >= 0) {
                    setLocal(prev => ({ ...prev, max_single_bet: v }))
                    setDirty(prev => new Set(prev).add('max_single_bet'))
                  }
                }}
                className="w-28 rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-right text-sm font-mono text-white focus:border-cyan-500 focus:outline-none"
                step={50}
                min={0}
                max={10000}
              />
            </div>
          </div>

          {/* Stop Loss */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-400">Daily Stop Loss</p>
              <p className="text-[10px] text-gray-600 mt-0.5">Stop placing bets if daily losses exceed this amount</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">$</span>
              <input
                type="number"
                value={typeof local['daily_stop_loss'] === 'number' ? local['daily_stop_loss'] : 1000}
                onChange={e => {
                  const v = parseFloat(e.target.value)
                  if (!isNaN(v) && v >= 0) {
                    setLocal(prev => ({ ...prev, daily_stop_loss: v }))
                    setDirty(prev => new Set(prev).add('daily_stop_loss'))
                  }
                }}
                className="w-28 rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-right text-sm font-mono text-white focus:border-cyan-500 focus:outline-none"
                step={100}
                min={0}
                max={25000}
              />
            </div>
          </div>
        </div>

        {tradingMode === 'live' && (
          <div className="mt-3 rounded-lg bg-amber-500/10 border border-amber-500/30 p-2">
            <p className="text-[10px] text-amber-400">These limits apply to live Betfair trading. The system will halt if any limit is reached.</p>
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <SettingsSection title="Kelly & Sizing" fields={KELLY_FIELDS} values={local} onChange={handleChange} dirty={dirty} />
        <SettingsSection title="Thresholds" fields={THRESHOLD_FIELDS} values={local} onChange={handleChange} dirty={dirty} />
        <SettingsSection title="Commission" fields={COMMISSION_FIELDS} values={local} onChange={handleChange} dirty={dirty} />

        {/* Active Sports */}
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
          <h3 className="mb-4 text-sm font-semibold text-gray-300">Active Sports</h3>
          <div className="space-y-3">
            {ALL_SPORTS.map(([key, label]) => (
              <label key={key} className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={activeSports.includes(key)}
                  onChange={e => handleSportsChange(key, e.target.checked)}
                  className="h-4 w-4 rounded border-gray-600 bg-gray-800 text-cyan-500 focus:ring-cyan-500 focus:ring-offset-0"
                />
                <span className="text-sm text-gray-300">{label}</span>
                <span className="text-xs text-gray-600">{key}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Betfair Connection Status */}
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
          <h3 className="mb-4 text-sm font-semibold text-gray-300">Betfair Exchange</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">Account</span>
              <span className="text-xs font-mono text-gray-300">trdickinson</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">App Key</span>
              <span className="text-xs font-mono text-gray-300">mbbTz...NoOl (delay)</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">Status</span>
              <span className="text-xs text-emerald-400 font-medium">Connected</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">Commission</span>
              <span className="text-xs text-gray-300">5%</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function SettingsSection({
  title,
  fields,
  values,
  onChange,
  dirty,
}: {
  title: string
  fields: SettingField[]
  values: Record<string, unknown>
  onChange: (key: string, value: number) => void
  dirty: Set<string>
}) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
      <h3 className="mb-4 text-sm font-semibold text-gray-300">{title}</h3>
      <div className="space-y-4">
        {fields.map(field => {
          const rawValue = values[field.key]
          const numValue = typeof rawValue === 'number' ? rawValue : Number(rawValue) || 0
          const isDirty = dirty.has(field.key)

          return (
            <div key={field.key} className="flex items-center justify-between gap-4">
              <div className="flex-1">
                <label className="text-xs text-gray-400">
                  {field.label}
                  {isDirty && <span className="ml-1 text-cyan-400">*</span>}
                </label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={field.format === 'percent' ? (numValue * 100).toFixed(1) : numValue}
                  onChange={e => {
                    const v = parseFloat(e.target.value)
                    if (isNaN(v)) return
                    const actual = field.format === 'percent' ? v / 100 : v
                    if (actual >= field.min && actual <= field.max) {
                      onChange(field.key, actual)
                    }
                  }}
                  className="w-24 rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-right text-sm font-mono text-white focus:border-cyan-500 focus:outline-none"
                  step={field.format === 'percent' ? field.step * 100 : field.step}
                />
                <span className="w-6 text-xs text-gray-500">
                  {field.format === 'percent' ? '%' : field.format === 'dollar' ? '$' : ''}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
