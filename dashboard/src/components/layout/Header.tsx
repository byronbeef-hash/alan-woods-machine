import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchSystemConfig, updateSystemConfig } from '../../lib/queries'

interface HeaderProps {
  onMenuToggle: () => void
}

export function Header({ onMenuToggle }: HeaderProps) {
  const queryClient = useQueryClient()
  const { data: config } = useQuery({
    queryKey: ['system-config'],
    queryFn: fetchSystemConfig,
  })

  const mode = (config?.['woods_mode'] as string) || 'demo'

  const toggleMode = useMutation({
    mutationFn: async () => {
      const newMode = mode === 'demo' ? 'live' : 'demo'
      await updateSystemConfig('woods_mode', newMode)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system-config'] })
    },
  })

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
        <span className="hidden sm:inline rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-emerald-400">
          NBA Props
        </span>
      </div>

      <div className="ml-auto flex items-center gap-3">
        {/* Demo/Live toggle - visible on every page */}
        <button
          onClick={() => toggleMode.mutate()}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold transition-colors ${
            mode === 'live'
              ? 'bg-red-500/20 text-red-400 border border-red-500/40 hover:bg-red-500/30'
              : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 hover:bg-emerald-500/30'
          }`}
        >
          <span className={`h-2 w-2 rounded-full ${mode === 'live' ? 'bg-red-500' : 'bg-emerald-500'} animate-pulse`} />
          {mode === 'live' ? 'LIVE' : 'DEMO'}
        </button>
      </div>
    </header>
  )
}
