export function Header() {
  return (
    <header className="flex h-14 items-center border-b border-gray-800 bg-gray-950 px-6">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-sm font-bold text-white">
          W
        </div>
        <h1 className="text-lg font-bold text-white">Woods System</h1>
        <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-emerald-400">
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
