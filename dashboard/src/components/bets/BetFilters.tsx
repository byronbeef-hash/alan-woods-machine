import type { BetFilters as BetFiltersType } from '../../lib/queries'

interface BetFiltersProps {
  filters: BetFiltersType
  onChange: (filters: BetFiltersType) => void
}

const markets = [
  { value: '', label: 'All Markets' },
  { value: 'player_points', label: 'Points' },
  { value: 'player_rebounds', label: 'Rebounds' },
  { value: 'player_assists', label: 'Assists' },
  { value: 'player_threes', label: 'Threes' },
]

const tiers = [
  { value: '', label: 'All Tiers' },
  { value: 'STRONG', label: 'Strong' },
  { value: 'MODERATE', label: 'Moderate' },
  { value: 'MARGINAL', label: 'Marginal' },
]

const results = [
  { value: '', label: 'All Results' },
  { value: 'WIN', label: 'Win' },
  { value: 'LOSS', label: 'Loss' },
  { value: 'PENDING', label: 'Pending' },
]

const selectClass =
  'rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-200 focus:border-emerald-500 focus:outline-none'

export function BetFilters({ filters, onChange }: BetFiltersProps) {
  return (
    <div className="flex flex-wrap gap-3">
      <select
        value={filters.market || ''}
        onChange={e => onChange({ ...filters, market: e.target.value || undefined })}
        className={selectClass}
      >
        {markets.map(m => (
          <option key={m.value} value={m.value}>{m.label}</option>
        ))}
      </select>
      <select
        value={filters.tier || ''}
        onChange={e => onChange({ ...filters, tier: e.target.value || undefined })}
        className={selectClass}
      >
        {tiers.map(t => (
          <option key={t.value} value={t.value}>{t.label}</option>
        ))}
      </select>
      <select
        value={filters.result || ''}
        onChange={e => onChange({ ...filters, result: e.target.value || undefined })}
        className={selectClass}
      >
        {results.map(r => (
          <option key={r.value} value={r.value}>{r.label}</option>
        ))}
      </select>
    </div>
  )
}
