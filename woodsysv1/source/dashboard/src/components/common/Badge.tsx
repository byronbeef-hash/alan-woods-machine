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

export function ResultBadge({ result }: { result: string }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold',
        result === 'WIN' && 'bg-emerald-500/20 text-emerald-400',
        result === 'LOSS' && 'bg-red-500/20 text-red-400',
        result === 'PENDING' && 'bg-gray-500/20 text-gray-400'
      )}
    >
      {result}
    </span>
  )
}
