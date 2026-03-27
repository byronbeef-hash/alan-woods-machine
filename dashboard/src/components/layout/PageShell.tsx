import { useState, useEffect, createContext, useContext } from 'react'
import { Outlet } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Header } from './Header'
import { Sidebar } from './Sidebar'
import { supabase } from '../../lib/supabase'

type ViewMode = 'demo' | 'live'
type SportMode = 'nba' | 'racing' | 'afl' | 'soccer'

const ViewModeContext = createContext<ViewMode>('live')
const SportModeContext = createContext<SportMode>('racing')

export function useViewMode() {
  return useContext(ViewModeContext)
}

export function useSportMode() {
  return useContext(SportModeContext)
}

export function PageShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('live')
  const [sportMode, setSportMode] = useState<SportMode>('racing')

  // Sync viewMode from system_config
  const { data: configMode } = useQuery({
    queryKey: ['woods_mode_sync'],
    queryFn: async () => {
      const { data } = await supabase.from('system_config').select('value').eq('key', 'woods_mode').single()
      return (data?.value as string) || 'live'
    },
    refetchInterval: 300000,
  })

  useEffect(() => {
    if (configMode) setViewMode(configMode as ViewMode)
  }, [configMode])

  return (
    <ViewModeContext.Provider value={viewMode}>
      <SportModeContext.Provider value={sportMode}>
        <div className="flex h-screen flex-col bg-gray-950 text-gray-100">
          <Header
            onMenuToggle={() => setSidebarOpen(prev => !prev)}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            sportMode={sportMode}
            onSportModeChange={setSportMode}
          />
          <div className="flex flex-1 overflow-hidden">
            <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} sportMode={sportMode} />
            <main className="flex-1 overflow-y-auto p-3 sm:p-4 lg:p-6">
              <Outlet />
            </main>
          </div>
        </div>
      </SportModeContext.Provider>
    </ViewModeContext.Provider>
  )
}
