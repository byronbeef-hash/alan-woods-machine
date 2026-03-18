interface HeaderProps {
  onMenuToggle: () => void
}

export function Header({ onMenuToggle }: HeaderProps) {
  return (
    <header className="flex h-14 items-center border-b border-gray-800 bg-gray-950 px-4 lg:px-6">
      {/* Hamburger menu - mobile only */}
      <button
        onClick={onMenuToggle}
        className="mr-3 flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-800 hover:text-white lg:hidden"
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      <div className="flex items-center gap-2 lg:gap-3">
        <div className="flex h-7 w-7 lg:h-8 lg:w-8 items-center justify-center rounded-lg bg-emerald-600 text-xs lg:text-sm font-bold text-white">
          W
        </div>
        <h1 className="text-base lg:text-lg font-bold text-white">Woods System</h1>
        <span className="hidden sm:inline rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-emerald-400">
          NBA Props
        </span>
      </div>
      <div className="ml-auto flex items-center gap-3">
        <span className="flex items-center gap-1.5 text-xs text-gray-400">
          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          Live
        </span>
      </div>
    </header>
  )
}
