import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import type { Bet } from '../../lib/types'
import { DEFAULT_COMMISSION_RATE, DATA_SOURCES, MODEL_METHODOLOGY, SPORT_LABELS } from '../../lib/types'
import { formatPercent, formatEdge, formatOdds, formatGameTime, formatCurrency, formatBankroll, getMarketLabel } from '../../lib/utils'
import { TierBadge, ResultBadge } from './Badge'
import { LiveBadge } from './LiveBadge'

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
    const bubbleHeight = 560
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

  const commission = bet.commission_rate ?? DEFAULT_COMMISSION_RATE
  const effectiveB = bet.odds_decimal !== null ? (bet.odds_decimal - 1) * (1 - commission) : null

  const kellyFraction = bet.model_prob !== null && effectiveB !== null && effectiveB > 0
    ? ((effectiveB * bet.model_prob - (1 - bet.model_prob)) / effectiveB)
    : null
  const quarterKelly = kellyFraction !== null ? kellyFraction * 0.25 : null

  const estimatedWin = bet.bet_size !== null && effectiveB !== null
    ? bet.bet_size * effectiveB
    : null

  const expectedValue = bet.model_prob !== null && bet.bet_size !== null && effectiveB !== null
    ? (bet.model_prob * bet.bet_size * effectiveB) - ((1 - bet.model_prob) * bet.bet_size)
    : null

  const isLive = bet.game_status?.startsWith('LIVE_')

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
              <span className="text-sm font-semibold text-white">
                {bet.jersey_number && <span className="text-gray-400 mr-1">#{bet.jersey_number}</span>}
                {bet.player}
              </span>
              <ResultBadge result={bet.result} />
            </div>
            {(bet.home_team || bet.away_team) && (
              <div className="mt-1.5 flex items-center gap-2">
                <span className="text-xs font-medium text-amber-400">
                  {bet.away_team}
                  {bet.away_score !== null && <span className="ml-1 text-white">{bet.away_score}</span>}
                  {' @ '}
                  {bet.home_team}
                  {bet.home_score !== null && <span className="ml-1 text-white">{bet.home_score}</span>}
                </span>
                <LiveBadge gameStatus={bet.game_status} gameClock={bet.game_clock} />
              </div>
            )}
            <div className="mt-1 text-xs text-gray-400">
              {bet.game_time
                ? <>Tip-off: {formatGameTime(bet.game_time)}</>
                : formatGameTime(bet.created_at)
              }
            </div>
          </div>

          {/* Live Data Section */}
          {isLive && (
            <div className="border-b border-gray-700 bg-emerald-900/10 px-4 py-2.5 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                </span>
                <span className="text-xs font-semibold text-emerald-400">LIVE</span>
              </div>
              {bet.live_stat !== null && (
                <Row label={`Current ${getMarketLabel(bet.market)}`} value={String(bet.live_stat)} color="text-white" />
              )}
              {bet.live_model_prob !== null && (
                <Row label="Live Win Prob" value={formatPercent(bet.live_model_prob)}
                  color={bet.live_model_prob > (bet.model_prob ?? 0) ? 'text-emerald-400' : 'text-red-400'} />
              )}
              {bet.live_model_prob !== null && bet.model_prob !== null && (
                <Row label="Change from Open"
                  value={`${bet.live_model_prob > bet.model_prob ? '+' : ''}${formatEdge(bet.live_model_prob - bet.model_prob)}`}
                  color={bet.live_model_prob > bet.model_prob ? 'text-emerald-400' : 'text-red-400'} />
              )}
            </div>
          )}

          {/* Bet Details */}
          <div className="px-4 py-3 space-y-2">
            <Row label="Market" value={getMarketLabel(bet.market)} />
            <Row label="Play" value={`${bet.side} ${bet.line}`} />
            <Row label="Odds" value={`${formatOdds(bet.odds_american)} (${bet.odds_decimal?.toFixed(2) ?? '—'})`} />
            <Row label="Commission" value={formatPercent(commission)} color="text-gray-400" />

            <div className="border-t border-gray-700/50 pt-2" />

            <Row label="Win Probability" value={bet.model_prob !== null ? formatPercent(bet.model_prob) : '—'} color="text-cyan-400" />
            <Row label="Market Implied" value={bet.market_implied !== null ? formatPercent(bet.market_implied) : '—'} />
            <Row label="Edge (Overlay)" value={bet.edge !== null ? formatEdge(bet.edge) : '—'} color="text-emerald-400" />
            {bet.model_prob !== null && bet.odds_decimal !== null && (
              <Row
                label="Win Expectation"
                value={(bet.model_prob * bet.odds_decimal).toFixed(2)}
                color={(bet.model_prob * bet.odds_decimal) > 1.0 ? 'text-emerald-400' : (bet.model_prob * bet.odds_decimal) >= 0.82 ? 'text-amber-400' : 'text-red-400'}
              />
            )}

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

            {/* Methodology & Data Source */}
            <div className="border-t border-gray-700/50 pt-2" />
            <div className="space-y-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Methodology</span>
              {bet.sport && (
                <Row label="Sport" value={SPORT_LABELS[bet.sport] || bet.sport} />
              )}
              {bet.sport && DATA_SOURCES[bet.sport] && (
                <Row label="Data Source" value={DATA_SOURCES[bet.sport]} />
              )}
              {MODEL_METHODOLOGY[bet.market] && (
                <div className="mt-1">
                  <span className="text-[10px] text-gray-500">Model</span>
                  <p className="mt-0.5 text-[10px] leading-relaxed text-gray-400">
                    {MODEL_METHODOLOGY[bet.market]}
                  </p>
                </div>
              )}
              <Row label="Sizing" value="Quarter-Kelly (25%)" />
              <Row label="Commission" value={formatPercent(commission)} color="text-gray-400" />
            </div>
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
