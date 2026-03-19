import { useState, createContext, useContext } from 'react'
import { Outlet } from 'react-router-dom'
import { Header } from './Header'
import { Sidebar } from './Sidebar'

type ViewMode = 'demo' | 'live'
type SportMode = 'nba' | 'racing' | 'afl' | 'soccer'

const ViewModeContext = createContext<ViewMode>('demo')
const SportModeContext = createContext<SportMode>('nba')

export function useViewMode() {
  return useContext(ViewModeContext)
}

export function useSportMode() {
  return useContext(SportModeContext)
}

export function PageShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('demo')
  const [sportMode, setSportMode] = useState<SportMode>('racing')

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
