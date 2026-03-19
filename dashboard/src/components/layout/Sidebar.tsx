import { NavLink } from 'react-router-dom'
import clsx from 'clsx'
import { useAuth } from '../../lib/auth'

type SportMode = 'nba' | 'racing' | 'afl' | 'soccer'

const commonItems = [
  { to: '/', label: 'Dashboard', icon: '~' },
]

const sportNavItems: Record<SportMode, { to: string; label: string; icon: string }[]> = {
  racing: [
    { to: '/racing', label: 'Scanner', icon: '!' },
    { to: '/overlays', label: 'Overlays', icon: '⚡' },
    { to: '/bets', label: 'Bets', icon: '#' },
  ],
  nba: [
    { to: '/scanner', label: 'Scanner', icon: '!' },
    { to: '/overlays', label: 'Overlays', icon: '⚡' },
    { to: '/bets', label: 'Bets', icon: '#' },
  ],
  afl: [
    { to: '/overlays', label: 'Overlays', icon: '⚡' },
    { to: '/bets', label: 'Bets', icon: '#' },
  ],
  soccer: [
    { to: '/overlays', label: 'Overlays', icon: '⚡' },
    { to: '/bets', label: 'Bets', icon: '#' },
  ],
}

const bottomItems = [
  { to: '/markets', label: 'Markets', icon: '%' },
  { to: '/settings', label: 'Settings', icon: '*' },
]

interface SidebarProps {
  open: boolean
  onClose: () => void
  sportMode?: SportMode
}

export function Sidebar({ open, onClose, sportMode = 'racing' }: SidebarProps) {
  const { signOut, user } = useAuth()

  const navItems = [
    ...commonItems,
    ...(sportNavItems[sportMode] || sportNavItems.racing),
    ...bottomItems,
  ]

  return (
    <>
      {/* Overlay for mobile */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <nav
        className={clsx(
          'fixed inset-y-0 left-0 z-40 flex w-48 flex-col border-r border-gray-800 bg-gray-950 p-3 pt-16 transition-transform duration-200 lg:static lg:translate-x-0 lg:pt-3',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex flex-1 flex-col gap-1">
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onClose}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200'
                )
              }
            >
              <span className="w-4 text-center font-mono text-xs text-gray-500">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </div>

        {/* Sign out */}
        <div className="mt-auto border-t border-gray-800 pt-3">
          <p className="truncate px-3 text-[10px] text-gray-600 mb-2">{user?.email}</p>
          <button
            onClick={signOut}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-800/50 hover:text-red-400"
          >
            <span className="w-4 text-center font-mono text-xs">{'>'}</span>
            Sign Out
          </button>
        </div>
      </nav>
    </>
  )
}
