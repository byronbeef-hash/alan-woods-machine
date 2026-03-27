import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchSystemConfig, updateSystemConfig } from '../../lib/queries'

interface HeaderProps {
  onMenuToggle: () => void
  viewMode: 'demo' | 'live'
  onViewModeChange: (mode: 'demo' | 'live') => void
  sportMode?: string
  onSportModeChange?: (mode: string) => void
}

export function Header({ onMenuToggle, viewMode, onViewModeChange }: HeaderProps) {
  const queryClient = useQueryClient()

  const handleModeChange = async (mode: 'demo' | 'live') => {
    onViewModeChange(mode)
    await updateSystemConfig('woods_mode', mode)
    queryClient.invalidateQueries({ queryKey: ['woods_mode_sync'] })
    queryClient.invalidateQueries({ queryKey: ['system-config'] })
  }

  const { data: config } = useQuery({
    queryKey: ['system-config'],
    queryFn: fetchSystemConfig,
  })

  const tradingMode = (config?.['woods_mode'] as string) || 'demo'

  return (
    <header className="flex h-14 items-center border-b border-gray-800 bg-gray-950 px-4 lg:px-6">
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

      <div className="ml-auto flex items-center gap-2">
        <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${
          tradingMode === 'live'
            ? 'bg-red-500/10 text-red-400 border border-red-500/30'
            : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
        }`}>
          {tradingMode === 'live' ? 'LIVE' : 'DEMO'}
        </span>

        <div className="flex rounded-full border border-gray-700 overflow-hidden">
          <button
            onClick={() => handleModeChange('demo')}
            className={`px-3 py-1 text-xs font-bold transition-colors ${
              viewMode === 'demo'
                ? 'bg-emerald-500/20 text-emerald-400'
                : 'bg-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            Demo
          </button>
          <button
            onClick={() => handleModeChange('live')}
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
