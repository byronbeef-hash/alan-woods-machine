import { useState, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ScanFilters } from '../lib/queries'
import { cancelScanResult } from '../lib/queries'
import type { ScanResult } from '../lib/types'
import { SPORT_LABELS } from '../lib/types'
import { useScanResults, usePlaceBetFromScan, useRealtimeScanResults, useTriggerScan, useScanStatus } from '../hooks/useScanResults'
import { ScannerFilters } from '../components/scanner/ScannerFilters'
import { ScannerTable } from '../components/scanner/ScannerTable'
import { formatDateTime } from '../lib/utils'

const scanSports = [
  { value: '', label: 'All Sports' },
  { value: 'basketball_nba', label: 'NBA' },
  { value: 'soccer_epl', label: 'EPL' },
  { value: 'soccer_uefa_champions_league', label: 'UCL' },
  { value: 'americanfootball_nfl', label: 'NFL' },
  { value: 'aussierules_afl', label: 'AFL' },
]

export function ScannerPage() {
  const [filters, setFilters] = useState<ScanFilters>({})
  const [placingId, setPlacingId] = useState<number | null>(null)
  const [scanSport, setScanSport] = useState('')
  const [scanning, setScanning] = useState(false)
  const [scanMessage, setScanMessage] = useState('')

  const { data: results = [], isLoading, error, dataUpdatedAt } = useScanResults(filters)
  const placeBet = usePlaceBetFromScan()
  const triggerScan = useTriggerScan()
  const { data: scanStatus } = useScanStatus(scanning)

  // Subscribe to realtime updates
  useRealtimeScanResults()

  // Detect when scan completes (runner clears the request)
  useEffect(() => {
    if (scanning && scanStatus === null) {
      setScanning(false)
      setScanMessage('Scan complete')
      setTimeout(() => setScanMessage(''), 5000)
    }
  }, [scanning, scanStatus])

  const placedResults = results.filter(r => r.status === 'PLACED')
  const activeResults = results.filter(r => r.status === 'ACTIVE')

  const handlePlaceBet = async (result: ScanResult) => {
    setPlacingId(result.id)
    try {
      await placeBet.mutateAsync(result)
    } catch (err) {
      console.error('Failed to place bet:', err)
    } finally {
      setPlacingId(null)
    }
  }

  const queryClient = useQueryClient()
  const cancelMutation = useMutation({
    mutationFn: cancelScanResult,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scan_results'] })
    },
  })

  const handleCancelBet = (resultId: number) => {
    cancelMutation.mutate(resultId)
  }

  const handleScanNow = async () => {
    try {
      setScanning(true)
      setScanMessage('')
      await triggerScan.mutateAsync(scanSport)
      const sportLabel = scanSport ? (SPORT_LABELS[scanSport] || scanSport) : 'all sports'
      setScanMessage(`Scanning ${sportLabel}...`)
    } catch (err) {
      console.error('Failed to trigger scan:', err)
      setScanning(false)
      setScanMessage('Scan request failed')
      setTimeout(() => setScanMessage(''), 5000)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Bet Scanner</h1>
          <p className="mt-1 text-sm text-gray-400">
            {results.length} opportunities found
            {placedResults.length > 0 && ` | ${placedResults.length} auto-placed`}
            {dataUpdatedAt > 0 && (
              <span className="ml-2 text-gray-600">
                Last updated: {formatDateTime(new Date(dataUpdatedAt).toISOString())}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Scan Now Controls */}
          <select
            value={scanSport}
            onChange={e => setScanSport(e.target.value)}
            disabled={scanning}
            className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-200 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
          >
            {scanSports.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <button
            onClick={handleScanNow}
            disabled={scanning}
            className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {scanning ? (
              <>
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Scanning...
              </>
            ) : (
              'Scan Now'
            )}
          </button>

          {/* Auto-scan badge */}
          <div className="flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            <span className="text-xs text-gray-400">Auto-scan active</span>
          </div>
        </div>
      </div>

      {/* Scan Status Message */}
      {scanMessage && (
        <div className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm ${
          scanning
            ? 'border border-amber-700 bg-amber-900/20 text-amber-400'
            : 'border border-emerald-700 bg-emerald-900/20 text-emerald-400'
        }`}>
          {scanning && (
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
          {scanMessage}
        </div>
      )}

      {/* Filters */}
      <ScannerFilters filters={filters} onChange={setFilters} />

      {/* Loading / Error States */}
      {isLoading && (
        <div className="flex h-48 items-center justify-center rounded-xl border border-gray-800 bg-gray-900 text-sm text-gray-500">
          Loading scan results...
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-800 bg-red-900/20 p-4 text-sm text-red-400">
          Error loading scan results: {(error as Error).message}
        </div>
      )}

      {!isLoading && !error && (
        <>
          {/* Auto-Placed Bets Section */}
          {placedResults.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-white">Auto-Placed Today</h2>
                <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-400">
                  {placedResults.length}
                </span>
              </div>
              <ScannerTable results={placedResults} onCancelBet={handleCancelBet} />
            </div>
          )}

          {/* Active Opportunities Section */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-white">Active Opportunities</h2>
              <span className="rounded-full bg-blue-500/15 px-2.5 py-0.5 text-xs font-semibold text-blue-400">
                {activeResults.length}
              </span>
            </div>
            <ScannerTable
              results={activeResults}
              onPlaceBet={handlePlaceBet}
              onCancelBet={handleCancelBet}
              placingId={placingId}
            />
          </div>

          {/* Stats Summary */}
          {results.length > 0 && (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <StatCard
                label="Avg Edge"
                value={`${(results.reduce((s, r) => s + (r.edge ?? 0), 0) / results.length * 100).toFixed(1)}%`}
                color="text-emerald-400"
              />
              <StatCard
                label="Avg Win Expectation"
                value={(results.reduce((s, r) => s + ((r.model_prob ?? 0) * (r.odds_decimal ?? 0)), 0) / results.length).toFixed(2)}
                color="text-cyan-400"
              />
              <StatCard
                label="Sports Covered"
                value={String(new Set(results.map(r => r.sport)).size)}
                color="text-amber-400"
              />
              <StatCard
                label="Markets Scanned"
                value={String(new Set(results.map(r => r.market)).size)}
                color="text-purple-400"
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`mt-1 text-xl font-bold ${color}`}>{value}</p>
    </div>
  )
}
