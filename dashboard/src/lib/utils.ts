import { format, parseISO } from 'date-fns'
import type { Bet, MarketStats } from './types'
import { MARKET_LABELS } from './types'

export function formatCurrency(value: number): string {
  const sign = value >= 0 ? '+' : ''
  return `${sign}$${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function formatBankroll(value: number): string {
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

export function formatEdge(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

export function formatOdds(american: number | null): string {
  if (american === null) return '—'
  return american > 0 ? `+${american}` : `${american}`
}

export function formatDate(dateStr: string): string {
  const date = parseISO(dateStr)
  return formatToBrisbane(date, 'MMM d, yyyy')
}

export function formatDateTime(dateStr: string): string {
  const date = parseISO(dateStr)
  return formatToBrisbane(date, 'MMM d, h:mm a')
}

export function formatGameTime(dateStr: string): string {
  const date = parseISO(dateStr)
  return formatToBrisbane(date, 'EEE MMM d, h:mm a') + ' AEST'
}

function formatToBrisbane(date: Date, fmt: string): string {
  // Brisbane is UTC+10 (no daylight saving)
  const utc = date.getTime() + date.getTimezoneOffset() * 60000
  const brisbane = new Date(utc + 10 * 3600000)
  return format(brisbane, fmt)
}

export function getMarketLabel(market: string): string {
  return MARKET_LABELS[market] || market
}

export function computeMarketStats(bets: Bet[]): MarketStats[] {
  const grouped = new Map<string, Bet[]>()

  for (const bet of bets) {
    const existing = grouped.get(bet.market) || []
    existing.push(bet)
    grouped.set(bet.market, existing)
  }

  return Array.from(grouped.entries()).map(([market, marketBets]) => {
    const settled = marketBets.filter(b => b.result !== 'PENDING')
    const wins = settled.filter(b => b.result === 'WIN').length
    const losses = settled.filter(b => b.result === 'LOSS').length
    const totalPnl = settled.reduce((sum, b) => sum + (b.pnl || 0), 0)
    const totalWagered = settled.reduce((sum, b) => sum + (b.bet_size || 0), 0)
    const avgEdge = settled.length > 0
      ? settled.reduce((sum, b) => sum + (b.edge || 0), 0) / settled.length
      : 0

    const tierDistribution: Record<string, number> = {}
    for (const b of settled) {
      if (b.tier) {
        tierDistribution[b.tier] = (tierDistribution[b.tier] || 0) + 1
      }
    }

    return {
      market,
      totalBets: settled.length,
      wins,
      losses,
      winRate: settled.length > 0 ? wins / settled.length : 0,
      totalPnl,
      totalWagered,
      roi: totalWagered > 0 ? totalPnl / totalWagered : 0,
      avgEdge,
      tierDistribution,
    }
  }).sort((a, b) => b.totalPnl - a.totalPnl)
}
