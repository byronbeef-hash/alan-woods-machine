import clsx from 'clsx'

interface StatCardProps {
  label: string
  value: string
  subValue?: string
  positive?: boolean
}

export function StatCard({ label, value, subValue, positive }: StatCardProps) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-3 sm:p-5">
      <p className="text-xs sm:text-sm text-gray-400">{label}</p>
      <p
        className={clsx(
          'mt-1 text-lg sm:text-2xl font-bold',
          positive === true && 'text-emerald-400',
          positive === false && 'text-red-400',
          positive === undefined && 'text-white'
        )}
      >
        {value}
      </p>
      {subValue && (
        <p className="mt-1 text-xs text-gray-500">{subValue}</p>
      )}
    </div>
  )
}
