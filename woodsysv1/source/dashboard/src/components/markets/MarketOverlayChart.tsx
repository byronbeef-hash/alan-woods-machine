import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import type { MarketStats } from '../../lib/types'
import { getMarketLabel } from '../../lib/utils'

interface MarketOverlayChartProps {
  stats: MarketStats[]
}

export function MarketOverlayChart({ stats }: MarketOverlayChartProps) {
  const data = stats.map(s => ({
    market: getMarketLabel(s.market),
    avgEdge: Math.round(s.avgEdge * 1000) / 10,
    bets: s.totalBets,
  }))

  if (data.length === 0) return null

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
      <h3 className="mb-4 text-sm font-semibold text-gray-300">Average Edge by Market (%)</h3>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data}>
          <XAxis dataKey="market" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} unit="%" />
          <Tooltip
            contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: 8 }}
            labelStyle={{ color: '#9ca3af' }}
            formatter={(value, name) => [
              name === 'avgEdge' ? `${value}%` : String(value),
              name === 'avgEdge' ? 'Avg Edge' : 'Total Bets',
            ]}
          />
          <Bar dataKey="avgEdge" fill="#22c55e" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
