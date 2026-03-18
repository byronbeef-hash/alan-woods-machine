import { useState, createContext, useContext } from 'react'
import { Outlet } from 'react-router-dom'
import { Header } from './Header'
import { Sidebar } from './Sidebar'

type ViewMode = 'demo' | 'live'

const ViewModeContext = createContext<ViewMode>('demo')

export function useViewMode() {
  return useContext(ViewModeContext)
}

export function PageShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('demo')

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
