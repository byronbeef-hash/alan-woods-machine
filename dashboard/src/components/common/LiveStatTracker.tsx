import { getMarketLabel } from '../../lib/utils'

interface LiveStatTrackerProps {
  liveStat: number
  line: number
  side: 'Over' | 'Under'
  market: string
}

export function LiveStatTracker({ liveStat, line, side, market }: LiveStatTrackerProps) {
  const onPace = side === 'Over' ? liveStat > line * 0.5 : liveStat < line * 0.75
  const color = onPace ? 'text-emerald-400' : 'text-red-400'
  const label = getMarketLabel(market)

  return (
    <span className={`font-mono text-xs ${color}`}>
      {liveStat} / {line} {label}
    </span>
  )
}
