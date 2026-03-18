import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { format, parseISO } from 'date-fns'
import type { Bet } from '../../lib/types'
import { STARTING_BANKROLL } from '../../lib/types'
import { formatBankroll } from '../../lib/utils'

interface BankrollChartProps {
  bets: Bet[]
}

export function BankrollChart({ bets }: BankrollChartProps) {
  const settled = bets.filter(b => b.result !== 'PENDING' && b.running_bankroll !== null)

  const data = [
    { date: 'Start', bankroll: STARTING_BANKROLL },
    ...settled.map(b => ({
      date: format(parseISO(b.created_at), 'MMM d'),
      bankroll: b.running_bankroll!,
    })),
  ]

  if (data.length < 2) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border border-gray-800 bg-gray-900 text-sm text-gray-500">
        No settled bets yet — bankroll chart will appear here
      </div>
    )
  }

  const min = Math.min(...data.map(d => d.bankroll))
  const max = Math.max(...data.map(d => d.bankroll))
  const isUp = data[data.length - 1].bankroll >= STARTING_BANKROLL

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
      <h3 className="mb-4 text-sm font-semibold text-gray-300">Bankroll Over Time</h3>
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={data}>
          <defs>
            <linearGradient id="bankrollGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={isUp ? '#22c55e' : '#ef4444'} stopOpacity={0.3} />
              <stop offset="95%" stopColor={isUp ? '#22c55e' : '#ef4444'} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="date" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis
            domain={[min * 0.95, max * 1.05]}
            tick={{ fill: '#6b7280', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={v => `$${(v / 1000).toFixed(1)}k`}
          />
          <Tooltip
            contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: 8 }}
            labelStyle={{ color: '#9ca3af' }}
            formatter={(value) => [formatBankroll(Number(value)), 'Bankroll']}
          />
          <Area
            type="monotone"
            dataKey="bankroll"
            stroke={isUp ? '#22c55e' : '#ef4444'}
            fill="url(#bankrollGrad)"
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
