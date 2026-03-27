import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './lib/auth'
import { PageShell } from './components/layout/PageShell'
import { DashboardPage } from './pages/DashboardPage'
import { ScannerPage } from './pages/ScannerPage'
import { BetsPage } from './pages/BetsPage'
import { SettingsPage } from './pages/SettingsPage'
import { PlannerPage } from './pages/PlannerPage'
import { ResultsPage } from './pages/ResultsPage'
import { LoginPage } from './pages/LoginPage'
import { LoadingSpinner } from './components/common/LoadingSpinner'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000,
      retry: 2,
    },
  },
})

function ProtectedApp() {
  const { user, loading, mfaPending } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950">
        <LoadingSpinner />
      </div>
    )
  }

  if (!user || mfaPending) {
    return <LoginPage />
  }

  return (
    <Routes>
      <Route element={<PageShell />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/scanner" element={<ScannerPage />} />
        <Route path="/planner" element={<PlannerPage />} />
        <Route path="/results" element={<ResultsPage />} />
        <Route path="/bets" element={<BetsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <ProtectedApp />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}
