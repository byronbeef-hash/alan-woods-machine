import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

interface AuthContextType {
  user: User | null
  session: Session | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  verifyMfa: (code: string, factorId: string) => Promise<{ error: string | null }>
  mfaPending: boolean
  mfaFactorId: string | null
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [mfaPending, setMfaPending] = useState(false)
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setUser(session?.user ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return { error: error.message }

    // Check if MFA is required
    const { data: factors } = await supabase.auth.mfa.listFactors()
    const totpFactors = factors?.totp || []
    if (totpFactors.length > 0 && totpFactors[0].status === 'verified') {
      setMfaPending(true)
      setMfaFactorId(totpFactors[0].id)
      return { error: null }
    }

    setUser(data.user)
    setSession(data.session)
    return { error: null }
  }

  const verifyMfa = async (code: string, factorId: string) => {
    const { data: challenge } = await supabase.auth.mfa.challenge({ factorId })
    if (!challenge) return { error: 'Failed to create MFA challenge' }

    const { error } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code,
    })
    if (error) return { error: error.message }

    // After MFA verify, refresh session
    const { data: sessionData } = await supabase.auth.getSession()
    setMfaPending(false)
    setMfaFactorId(null)
    setUser(sessionData.session?.user ?? null)
    setSession(sessionData.session)
    return { error: null }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    setUser(null)
    setSession(null)
    setMfaPending(false)
    setMfaFactorId(null)
  }

  return (
    <AuthContext.Provider value={{ user, session, loading, signIn, signOut, verifyMfa, mfaPending, mfaFactorId }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
