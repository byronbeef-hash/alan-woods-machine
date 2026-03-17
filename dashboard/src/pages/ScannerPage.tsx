import { useState } from 'react'
import type { ScanFilters } from '../lib/queries'
import type { ScanResult } from '../lib/types'
import { useScanResults, usePlaceBetFromScan, useRealtimeScanResults } from '../hooks/useScanResults'
import { ScannerFilters } from '../components/scanner/ScannerFilters'
import { ScannerTable } from '../components/scanner/ScannerTable'
import { formatDateTime } from '../lib/utils'

export function ScannerPage() {
  const [filters, setFilters] = useState<ScanFilters>({})
  const [placingId, setPlacingId] = useState<number | null>(null)

  const { data: results = [], isLoading, error, dataUpdatedAt } = useScanResults(filters)
  const placeBet = usePlaceBetFromScan()

  // Subscribe to realtime updates
  useRealtimeScanResults()

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
          <div className="flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            <span className="text-xs text-gray-400">Auto-scan active</span>
          </div>
        </div>
      </div>

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
              <ScannerTable results={placedResults} />
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
                label="Avg Model Prob"
                value={`${(results.reduce((s, r) => s + (r.model_prob ?? 0), 0) / results.length * 100).toFixed(1)}%`}
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
