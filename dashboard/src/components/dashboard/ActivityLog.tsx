import { useQuery } from '@tanstack/react-query'
import { fetchSystemConfig } from '../../lib/queries'

interface LogEntry {
  ts: string
  type: 'scan' | 'bet' | 'settle' | 'mirror' | 'system' | 'error'
  msg: string
}

const TYPE_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  scan: { bg: 'bg-cyan-500/20', text: 'text-cyan-400', label: 'SCAN' },
  bet: { bg: 'bg-emerald-500/20', text: 'text-emerald-400', label: 'BET' },
  settle: { bg: 'bg-amber-500/20', text: 'text-amber-400', label: 'SETTLE' },
  mirror: { bg: 'bg-violet-500/20', text: 'text-violet-400', label: 'LIVE' },
  system: { bg: 'bg-blue-500/20', text: 'text-blue-400', label: 'SYSTEM' },
  error: { bg: 'bg-red-500/20', text: 'text-red-400', label: 'ERROR' },
}

function formatLogTime(ts: string): string {
  try {
    const d = new Date(ts)
    return d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: true })
  } catch {
    return ts
  }
}

function formatLogDate(ts: string): string {
  try {
    const d = new Date(ts)
    return d.toLocaleDateString('en-AU', { month: 'short', day: 'numeric' })
  } catch {
    return ''
  }
}

export function ActivityLog() {
  const { data: config } = useQuery({
    queryKey: ['system-config'],
    queryFn: fetchSystemConfig,
    refetchInterval: 30000,
  })

  const rawLog = (config?.['activity_log'] as LogEntry[]) || []
  const entries = [...rawLog].reverse() // Most recent first

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-300">Activity Log</h3>
        <span className="text-[10px] text-gray-600">{entries.length} events</span>
      </div>

      {entries.length === 0 ? (
        <p className="text-xs text-gray-600 text-center py-6">No activity yet. Waiting for autonomous scan...</p>
      ) : (
        <div className="space-y-1 max-h-80 overflow-y-auto pr-1">
          {entries.map((entry, i) => {
            const style = TYPE_STYLES[entry.type] || TYPE_STYLES.system
            const prevEntry = entries[i - 1]
            const showDate = !prevEntry || formatLogDate(entry.ts) !== formatLogDate(prevEntry.ts)

            return (
              <div key={i}>
                {showDate && (
                  <div className="text-[10px] text-gray-600 font-medium mt-2 mb-1 first:mt-0">
                    {formatLogDate(entry.ts)}
                  </div>
                )}
                <div className="flex items-start gap-2 py-1 px-2 rounded hover:bg-gray-800/50">
                  <span className="text-[10px] text-gray-600 font-mono w-16 flex-shrink-0 pt-0.5">
                    {formatLogTime(entry.ts)}
                  </span>
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${style.bg} ${style.text} flex-shrink-0`}>
                    {style.label}
                  </span>
                  <span className={`text-xs ${entry.type === 'error' ? 'text-red-400' : 'text-gray-400'}`}>
                    {entry.msg}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
