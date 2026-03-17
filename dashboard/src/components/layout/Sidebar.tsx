import { NavLink } from 'react-router-dom'
import clsx from 'clsx'

const navItems = [
  { to: '/', label: 'Dashboard', icon: '~' },
  { to: '/bets', label: 'Bets', icon: '#' },
  { to: '/markets', label: 'Markets', icon: '%' },
]

export function Sidebar() {
  return (
    <nav className="flex w-48 flex-col border-r border-gray-800 bg-gray-950 p-3">
      <div className="flex flex-col gap-1">
        {navItems.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
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
    </nav>
  )
}
