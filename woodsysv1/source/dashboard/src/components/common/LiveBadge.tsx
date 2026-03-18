interface LiveBadgeProps {
  gameStatus: string | null
  gameClock: string | null
}

export function LiveBadge({ gameStatus, gameClock }: LiveBadgeProps) {
  if (!gameStatus || gameStatus === 'SCHEDULED') return null

  if (gameStatus === 'FINAL') {
    return (
      <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-gray-700 text-gray-300">
        Final
      </span>
    )
  }

  if (gameStatus.startsWith('LIVE_')) {
    const label = gameClock || gameStatus.replace('LIVE_', '')
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

  return null
}
