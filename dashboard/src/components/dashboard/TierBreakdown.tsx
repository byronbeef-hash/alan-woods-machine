import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, Cell, LabelList } from 'recharts'
import type { RenderableText } from 'recharts/types/component/Text'
import type { Bet } from '../../lib/types'

const pctFormatter = (v: RenderableText) => `${v}%`

interface TierBreakdownProps {
  bets: Bet[]
}

export function TierBreakdown({ bets }: TierBreakdownProps) {
  const settled = bets.filter(b => b.result !== 'PENDING')

  const tiers = ['STRONG', 'MODERATE', 'MARGINAL']
  const data = tiers.map(tier => {
    const tierBets = settled.filter(b => b.tier === tier)
    const wins = tierBets.filter(b => b.result === 'WIN').length
    const totalPnl = tierBets.reduce((sum, b) => sum + (b.pnl || 0), 0)
    const totalWagered = tierBets.reduce((sum, b) => sum + (b.bet_size || 0), 0)

    return {
      tier,
      bets: tierBets.length,
      winRate: tierBets.length > 0 ? Math.round((wins / tierBets.length) * 100) : 0,
      roi: totalWagered > 0 ? Math.round((totalPnl / totalWagered) * 100) : 0,
    }
  })

  if (settled.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border border-gray-800 bg-gray-900 text-sm text-gray-500">
        No settled bets yet — tier breakdown will appear here
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
      <h3 className="mb-4 text-sm font-semibold text-gray-300">Performance by Overlay Tier</h3>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} barGap={8}>
          <XAxis dataKey="tier" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} unit="%" />
          <Tooltip
            contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: 8 }}
            labelStyle={{ color: '#9ca3af' }}
          />
          <Legend wrapperStyle={{ fontSize: 12, color: '#9ca3af' }} />
          <Bar dataKey="winRate" name="Win Rate %" fill="#22c55e" radius={[4, 4, 0, 0]}>
            <LabelList dataKey="winRate" position="top" fill="#22c55e" fontSize={11} formatter={pctFormatter} />
            {data.map((entry) => (
              <Cell key={entry.tier} fill="#22c55e" />
            ))}
          </Bar>
          <Bar dataKey="roi" name="ROI %" fill="#3b82f6" radius={[4, 4, 0, 0]}>
            <LabelList dataKey="roi" position="top" fill="#3b82f6" fontSize={11} formatter={pctFormatter} />
            {data.map((entry) => (
              <Cell key={entry.tier} fill="#3b82f6" />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
