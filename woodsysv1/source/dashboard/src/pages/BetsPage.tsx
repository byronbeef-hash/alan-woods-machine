import { useState } from 'react'
import { useFilteredBets, useRealtimeBets } from '../hooks/useBets'
import { BetFilters } from '../components/bets/BetFilters'
import { BetsTable } from '../components/bets/BetsTable'
import { LoadingSpinner } from '../components/common/LoadingSpinner'
import type { BetFilters as BetFiltersType } from '../lib/queries'

export function BetsPage() {
  const [filters, setFilters] = useState<BetFiltersType>({})
  const { data: bets, isLoading, error } = useFilteredBets(filters)
  useRealtimeBets()

  if (error) return <div className="text-red-400">Error loading bets: {error.message}</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">Bet History</h2>
        <span className="text-sm text-gray-400">
          {bets?.length || 0} bets
        </span>
      </div>
      <BetFilters filters={filters} onChange={setFilters} />
      {isLoading ? <LoadingSpinner /> : <BetsTable bets={bets || []} />}
    </div>
  )
}
