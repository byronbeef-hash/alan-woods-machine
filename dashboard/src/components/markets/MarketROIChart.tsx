import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { format, parseISO } from 'date-fns'
import type { Bet } from '../../lib/types'
import { getMarketLabel } from '../../lib/utils'

interface MarketROIChartProps {
  bets: Bet[]
}

const COLORS = ['#22c55e', '#3b82f6', '#eab308', '#f97316']

export function MarketROIChart({ bets }: MarketROIChartProps) {
  const settled = bets.filter(b => b.result !== 'PENDING').sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  )

  if (settled.length === 0) return null

  // Get unique markets
  const markets = [...new Set(settled.map(b => b.market))]

  // Build cumulative P&L per market over time
  const cumulativePnl: Record<string, number> = {}
  markets.forEach(m => { cumulativePnl[m] = 0 })

  const data = settled.map(bet => {
    cumulativePnl[bet.market] = (cumulativePnl[bet.market] || 0) + (bet.pnl || 0)
    return {
      date: format(parseISO(bet.created_at), 'MMM d'),
      ...Object.fromEntries(markets.map(m => [m, cumulativePnl[m]])),
    }
  })

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
      <h3 className="mb-4 text-sm font-semibold text-gray-300">Cumulative P&L by Market</h3>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data}>
          <XAxis dataKey="date" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis
            tick={{ fill: '#6b7280', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={v => `$${v}`}
          />
          <Tooltip
            contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: 8 }}
            labelStyle={{ color: '#9ca3af' }}
            formatter={(value, name) => [`$${Number(value).toFixed(2)}`, getMarketLabel(String(name))]}
          />
          <Legend formatter={(value: string) => getMarketLabel(value)} wrapperStyle={{ fontSize: 12 }} />
          {markets.map((market, i) => (
            <Line
              key={market}
              type="monotone"
              dataKey={market}
              stroke={COLORS[i % COLORS.length]}
              strokeWidth={2}
              dot={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
