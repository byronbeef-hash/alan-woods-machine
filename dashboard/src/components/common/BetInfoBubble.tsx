import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import type { Bet } from '../../lib/types'
import { formatPercent, formatEdge, formatOdds, formatGameTime, formatCurrency, formatBankroll, getMarketLabel } from '../../lib/utils'
import { TierBadge, ResultBadge } from './Badge'

interface BetInfoBubbleProps {
  bet: Bet
  children: React.ReactNode
}

export function BetInfoBubble({ bet, children }: BetInfoBubbleProps) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const triggerRef = useRef<HTMLSpanElement>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const bubbleHeight = 480
    const spaceBelow = window.innerHeight - rect.bottom
    const top = spaceBelow < bubbleHeight ? rect.top - bubbleHeight - 4 : rect.bottom + 4
    setPos({ top, left: rect.left })
  }, [])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (bubbleRef.current && !bubbleRef.current.contains(e.target as Node) &&
          triggerRef.current && !triggerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClick)
      updatePosition()
    }
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open, updatePosition])

  const kellyFraction = bet.model_prob !== null && bet.odds_decimal !== null
    ? ((bet.model_prob * bet.odds_decimal - 1) / (bet.odds_decimal - 1))
    : null
  const quarterKelly = kellyFraction !== null ? kellyFraction * 0.25 : null

  // Estimated win value: profit if bet wins = bet_size * (odds_decimal - 1)
  const estimatedWin = bet.bet_size !== null && bet.odds_decimal !== null
    ? bet.bet_size * (bet.odds_decimal - 1)
    : null

  // Expected value: (model_prob * win_amount) - ((1 - model_prob) * bet_size)
  const expectedValue = bet.model_prob !== null && bet.bet_size !== null && bet.odds_decimal !== null
    ? (bet.model_prob * bet.bet_size * (bet.odds_decimal - 1)) - ((1 - bet.model_prob) * bet.bet_size)
    : null

  return (
    <>
      <span
        ref={triggerRef}
        className="cursor-pointer"
        onClick={() => setOpen(!open)}
      >
        {children}
      </span>
      {open && createPortal(
        <div
          ref={bubbleRef}
          className="fixed z-[9999] w-80 rounded-lg border border-gray-700 shadow-2xl"
          style={{ backgroundColor: '#1a2332', top: pos.top, left: pos.left }}
        >
          {/* Header */}
          <div className="border-b border-gray-700 px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-white">{bet.player}</span>
              <ResultBadge result={bet.result} />
            </div>
            {(bet.home_team || bet.away_team) && (
              <div className="mt-1.5 text-xs font-medium text-amber-400">
                {bet.away_team} @ {bet.home_team}
              </div>
            )}
            <div className="mt-1 text-xs text-gray-400">
              {bet.game_time
                ? <>Tip-off: {formatGameTime(bet.game_time)}</>
                : formatGameTime(bet.created_at)
              }
            </div>
          </div>

          {/* Bet Details */}
          <div className="px-4 py-3 space-y-2">
            <Row label="Market" value={getMarketLabel(bet.market)} />
            <Row label="Play" value={`${bet.side} ${bet.line}`} />
            <Row label="Odds" value={`${formatOdds(bet.odds_american)} (${bet.odds_decimal?.toFixed(2) ?? '—'})`} />

            <div className="border-t border-gray-700/50 pt-2" />

            <Row label="Win Probability" value={bet.model_prob !== null ? formatPercent(bet.model_prob) : '—'} color="text-cyan-400" />
            <Row label="Market Implied" value={bet.market_implied !== null ? formatPercent(bet.market_implied) : '—'} />
            <Row label="Edge (Overlay)" value={bet.edge !== null ? formatEdge(bet.edge) : '—'} color="text-emerald-400" />

            <div className="border-t border-gray-700/50 pt-2" />

            <Row label="Kelly Criterion" value={kellyFraction !== null ? formatPercent(kellyFraction) : '—'} />
            <Row label="Quarter Kelly" value={quarterKelly !== null ? formatPercent(quarterKelly) : '—'} />
            <Row label="Bet Size" value={bet.bet_size !== null ? formatBankroll(bet.bet_size) : '—'} />
            <Row label="Bankroll at Bet" value={bet.bankroll_at_bet !== null ? formatBankroll(bet.bankroll_at_bet) : '—'} />

            <div className="border-t border-gray-700/50 pt-2" />

            <Row label="Est. Win (if successful)" value={estimatedWin !== null ? `+${formatBankroll(estimatedWin)}` : '—'} color="text-emerald-400" />
            <Row label="Expected Value" value={expectedValue !== null ? formatCurrency(expectedValue) : '—'}
              color={expectedValue !== null ? (expectedValue >= 0 ? 'text-emerald-400' : 'text-red-400') : undefined} />

            {bet.tier && (
              <>
                <div className="border-t border-gray-700/50 pt-2" />
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">Tier</span>
                  <TierBadge tier={bet.tier} />
                </div>
              </>
            )}

            {bet.result !== 'PENDING' && (
              <>
                <div className="border-t border-gray-700/50 pt-2" />
                <Row label="Actual Stat" value={bet.actual_stat !== null ? String(bet.actual_stat) : '—'} />
                <Row label="P&L" value={bet.pnl !== null ? formatCurrency(bet.pnl) : '—'}
                  color={bet.pnl !== null ? (bet.pnl >= 0 ? 'text-emerald-400' : 'text-red-400') : undefined} />
              </>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  )
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-gray-500">{label}</span>
      <span className={`text-xs font-mono ${color || 'text-gray-300'}`}>{value}</span>
    </div>
  )
}
