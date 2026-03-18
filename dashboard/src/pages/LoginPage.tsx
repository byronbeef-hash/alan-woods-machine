import { useState } from 'react'
import { useAuth } from '../lib/auth'

export function LoginPage() {
  const { signIn, verifyMfa, mfaPending, mfaFactorId } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mfaCode, setMfaCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await signIn(email, password)
    if (error) setError(error)
    setLoading(false)
  }

  const handleMfa = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!mfaFactorId) return
    setError('')
    setLoading(true)
    const { error } = await verifyMfa(mfaCode, mfaFactorId)
    if (error) setError(error)
    setLoading(false)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-600 text-xl font-bold text-white">
            W
          </div>
          <h1 className="text-xl font-bold text-white">Woods System</h1>
          <p className="mt-1 text-sm text-gray-500">Sign in to your account</p>
        </div>

        {mfaPending ? (
          <form onSubmit={handleMfa} className="space-y-4">
            <div className="rounded-xl border border-gray-800 bg-gray-900 p-6 space-y-4">
              <div className="text-center">
                <p className="text-sm text-gray-300 font-medium">Two-Factor Authentication</p>
                <p className="text-xs text-gray-500 mt-1">Enter the 6-digit code from your authenticator app</p>
              </div>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={mfaCode}
                onChange={e => setMfaCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-3 text-center text-2xl font-mono tracking-[0.5em] text-white placeholder-gray-600 focus:border-cyan-500 focus:outline-none"
                autoFocus
              />
              {error && <p className="text-xs text-red-400 text-center">{error}</p>}
              <button
                type="submit"
                disabled={loading || mfaCode.length !== 6}
                className="w-full rounded-lg bg-cyan-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {loading ? 'Verifying...' : 'Verify'}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="rounded-xl border border-gray-800 bg-gray-900 p-6 space-y-4">
              <div>
                <label className="mb-1 block text-xs text-gray-400">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:border-cyan-500 focus:outline-none"
                  autoFocus
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-400">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Enter password"
                  className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:border-cyan-500 focus:outline-none"
                  required
                />
              </div>
              {error && <p className="text-xs text-red-400">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {loading ? 'Signing in...' : 'Sign In'}
              </button>
            </div>
            <p className="text-center text-xs text-gray-600">
              Protected by Supabase Auth + 2FA
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
