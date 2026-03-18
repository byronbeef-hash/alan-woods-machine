interface LiveBadgeProps {
  gameStatus: string | null
  gameClock: string | null
  result?: string | null
}

export function LiveBadge({ gameStatus, gameClock, result }: LiveBadgeProps) {
  const status = (gameStatus || '').toUpperCase()

  // Settled bets — show Final
  if (result === 'WIN' || result === 'LOSS') {
    return (
      <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-gray-700 text-gray-300">
        Final
      </span>
    )
  }

  // Live game
  if (status.startsWith('LIVE')) {
    const label = gameClock || status.replace('LIVE_', '').replace('LIVE', 'In Play')
    return (
      <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-emerald-900/50 text-emerald-400">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
        </span>
        {label}
      </span>
    )
  }

  // Final (case-insensitive)
  if (status === 'FINAL' || status === 'COMPLETED') {
    return (
      <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-gray-700 text-gray-300">
        Final
      </span>
    )
  }

  // Pending/Scheduled — show "Placed"
  return (
    <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-violet-900/50 text-violet-400">
      Placed
    </span>
  )
}
