import clsx from 'clsx'

interface BadgeProps {
  tier: string
}

export function TierBadge({ tier }: BadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold',
        tier === 'STRONG' && 'bg-emerald-500/20 text-emerald-400',
        tier === 'MODERATE' && 'bg-yellow-500/20 text-yellow-400',
        tier === 'MARGINAL' && 'bg-orange-500/20 text-orange-400'
      )}
    >
      {tier}
    </span>
  )
}

export function ResultBadge({ result, actualStat, line }: { result: string; actualStat?: number | null; line?: number }) {
  const icon = result === 'WIN' ? '\u2713' : result === 'LOSS' ? '\u2717' : '\u2022'

  // Build stat detail string like "17pts" when actual_stat is available
  let statDetail = ''
  if (actualStat !== null && actualStat !== undefined && result !== 'PENDING') {
    statDetail = ` ${actualStat}${line !== undefined ? 'pts' : ''}`
  }

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold',
        result === 'WIN' && 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30',
        result === 'LOSS' && 'bg-red-500/20 text-red-400 ring-1 ring-red-500/30',
        result === 'PENDING' && 'bg-gray-500/15 text-gray-500'
      )}
    >
      <span className={clsx(
        result === 'WIN' && 'text-emerald-400',
        result === 'LOSS' && 'text-red-400',
        result === 'PENDING' && 'text-gray-600'
      )}>
        {icon}
      </span>
      {result}{statDetail}
    </span>
  )
}

export function DemoBadge() {
  return (
    <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-violet-500/15 text-violet-400 ring-1 ring-violet-500/30">
      Demo
    </span>
  )
}
