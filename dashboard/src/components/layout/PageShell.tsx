import { useState, useEffect, createContext, useContext } from 'react'
import { Outlet } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Header } from './Header'
import { Sidebar } from './Sidebar'
import { supabase } from '../../lib/supabase'

type ViewMode = 'demo' | 'live'

const ViewModeContext = createContext<ViewMode>('live')

export function useViewMode() {
  return useContext(ViewModeContext)
}

// Keep for backward compat with any remaining references
export function useSportMode() {
  return 'racing'
}

export function PageShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('live')

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
      <div className="flex h-screen flex-col bg-gray-950 text-gray-100">
        <Header
          onMenuToggle={() => setSidebarOpen(prev => !prev)}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
        />
        <div className="flex flex-1 overflow-hidden">
          <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
          <main className="flex-1 overflow-y-auto p-3 sm:p-4 lg:p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </ViewModeContext.Provider>
  )
}
