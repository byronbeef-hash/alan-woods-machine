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
