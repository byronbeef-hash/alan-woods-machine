import { StatCard } from '../common/StatCard'
import { formatCurrency, formatBankroll, formatPercent } from '../../lib/utils'
import type { Bet } from '../../lib/types'
import { STARTING_BANKROLL } from '../../lib/types'

interface KPICardsProps {
  bets: Bet[]
}

export function KPICards({ bets }: KPICardsProps) {
  const settled = bets.filter(b => b.result !== 'PENDING')
  const wins = settled.filter(b => b.result === 'WIN').length
  const totalPnl = settled.reduce((sum, b) => sum + (b.pnl || 0), 0)
  const totalWagered = settled.reduce((sum, b) => sum + (b.bet_size || 0), 0)
  const winRate = settled.length > 0 ? wins / settled.length : 0
  const roi = totalWagered > 0 ? totalPnl / totalWagered : 0
  const lastSettled = settled[settled.length - 1]
  const currentBankroll = lastSettled?.running_bankroll || STARTING_BANKROLL
  const pending = bets.filter(b => b.result === 'PENDING').length

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <StatCard
        label="Total P&L"
        value={formatCurrency(totalPnl)}
        subValue={`${settled.length} settled bets`}
        positive={totalPnl >= 0}
      />
      <StatCard
        label="Win Rate"
        value={formatPercent(winRate)}
        subValue={`${wins}W / ${settled.length - wins}L`}
        positive={winRate >= 0.5}
      />
      <StatCard
        label="ROI"
        value={formatPercent(roi)}
        subValue={`${formatBankroll(totalWagered)} wagered`}
        positive={roi >= 0}
      />
      <StatCard
        label="Bankroll"
        value={formatBankroll(currentBankroll)}
        subValue={pending > 0 ? `${pending} pending` : 'No pending bets'}
      />
    </div>
  )
}
