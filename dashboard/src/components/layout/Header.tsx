import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { fetchSystemConfig } from '../../lib/queries'

type SportMode = 'nba' | 'racing' | 'afl' | 'soccer'

const SPORT_TABS: { key: SportMode; label: string; icon: string; defaultRoute: string }[] = [
  { key: 'racing', label: 'Horse Racing', icon: '🏇', defaultRoute: '/racing' },
  { key: 'nba', label: 'NBA', icon: '🏀', defaultRoute: '/scanner' },
  { key: 'afl', label: 'AFL', icon: '🏈', defaultRoute: '/overlays' },
  { key: 'soccer', label: 'Soccer', icon: '⚽', defaultRoute: '/overlays' },
]

interface HeaderProps {
  onMenuToggle: () => void
  viewMode: 'demo' | 'live'
  onViewModeChange: (mode: 'demo' | 'live') => void
  sportMode: SportMode
  onSportModeChange: (mode: SportMode) => void
}

export function Header({ onMenuToggle, viewMode, onViewModeChange, sportMode, onSportModeChange }: HeaderProps) {
  const navigate = useNavigate()
  const { data: config } = useQuery({
    queryKey: ['system-config'],
    queryFn: fetchSystemConfig,
  })

  const tradingMode = (config?.['woods_mode'] as string) || 'demo'

  return (
    <header className="flex h-14 items-center border-b border-gray-800 bg-gray-950 px-4 lg:px-6">
      {/* Hamburger menu - mobile only */}
      <button
        onClick={onMenuToggle}
        className="mr-3 flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-800 hover:text-white lg:hidden"
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      <div className="flex items-center gap-2 lg:gap-3">
        <div className="flex h-7 w-7 lg:h-8 lg:w-8 items-center justify-center rounded-lg bg-emerald-600 text-xs lg:text-sm font-bold text-white">
          W
        </div>
        <h1 className="text-base lg:text-lg font-bold text-white">Woods System</h1>
      </div>

      {/* Sport tabs */}
      <div className="ml-4 flex items-center gap-1 overflow-x-auto">
        {SPORT_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => { onSportModeChange(tab.key); navigate(tab.defaultRoute) }}
            className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              sportMode === tab.key
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                : 'text-gray-500 hover:bg-gray-800 hover:text-gray-300'
            }`}
          >
            <span>{tab.icon}</span>
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        ))}
      </div>

      <div className="ml-auto flex items-center gap-2">
        {/* Trading mode indicator */}
        <span className={`hidden sm:inline text-[10px] px-2 py-0.5 rounded ${
          tradingMode === 'live'
            ? 'bg-red-500/10 text-red-400'
            : 'bg-gray-800 text-gray-500'
        }`}>
          Trading: {tradingMode === 'live' ? 'LIVE' : 'DEMO'}
        </span>

        {/* View toggle — switches which data you see */}
        <div className="flex rounded-full border border-gray-700 overflow-hidden">
          <button
            onClick={() => onViewModeChange('demo')}
            className={`px-3 py-1 text-xs font-bold transition-colors ${
              viewMode === 'demo'
                ? 'bg-emerald-500/20 text-emerald-400'
                : 'bg-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            Demo
          </button>
          <button
            onClick={() => onViewModeChange('live')}
            className={`px-3 py-1 text-xs font-bold transition-colors ${
              viewMode === 'live'
                ? 'bg-red-500/20 text-red-400'
                : 'bg-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            Live
          </button>
        </div>
      </div>
    </header>
  )
}
