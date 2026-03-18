import type { BetFilters as BetFiltersType } from '../../lib/queries'

interface BetFiltersProps {
  filters: BetFiltersType
  onChange: (filters: BetFiltersType) => void
}

const sports = [
  { value: '', label: 'All Sports' },
  { value: 'basketball_nba', label: 'NBA' },
  { value: 'soccer_epl', label: 'EPL' },
  { value: 'soccer_uefa_champions_league', label: 'UCL' },
  { value: 'americanfootball_nfl', label: 'NFL' },
  { value: 'aussierules_afl', label: 'AFL' },
]

const markets = [
  { value: '', label: 'All Markets' },
  // NBA
  { value: 'player_points', label: 'Points' },
  { value: 'player_rebounds', label: 'Rebounds' },
  { value: 'player_assists', label: 'Assists' },
  { value: 'player_threes', label: 'Threes' },
  { value: 'player_steals', label: 'Steals' },
  { value: 'player_blocks', label: 'Blocks' },
  { value: 'player_turnovers', label: 'Turnovers' },
  // Soccer
  { value: 'player_goals', label: 'Goals' },
  { value: 'player_shots_on_target', label: 'Shots on Target' },
  { value: 'player_soccer_assists', label: 'Soccer Assists' },
  { value: 'player_tackles', label: 'Tackles' },
  { value: 'player_passes', label: 'Passes' },
  // NFL
  { value: 'player_pass_yds', label: 'Pass Yards' },
  { value: 'player_rush_yds', label: 'Rush Yards' },
  { value: 'player_reception_yds', label: 'Rec Yards' },
  { value: 'player_pass_tds', label: 'Pass TDs' },
  { value: 'player_anytime_td', label: 'Anytime TD' },
  { value: 'player_receptions', label: 'Receptions' },
  { value: 'player_rush_attempts', label: 'Rush Attempts' },
  // AFL
  { value: 'player_disposals', label: 'Disposals' },
  { value: 'player_marks', label: 'Marks' },
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
  { value: 'PENDING', label: 'Placed' },
]

const selectClass =
  'rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-200 focus:border-emerald-500 focus:outline-none'

export function BetFilters({ filters, onChange }: BetFiltersProps) {
  return (
    <div className="flex flex-wrap gap-3">
      <select
        value={filters.sport || ''}
        onChange={e => onChange({ ...filters, sport: e.target.value || undefined })}
        className={selectClass}
      >
        {sports.map(s => (
          <option key={s.value} value={s.value}>{s.label}</option>
        ))}
      </select>
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
