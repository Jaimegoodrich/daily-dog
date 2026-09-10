import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabaseClient'
import type { Employee, Profile } from '@/types/database'

interface AuthContextValue {
  session: Session | null
  profile: Profile | null
  employee: Employee | null
  loading: boolean
  signInAdmin: (email: string, password: string) => Promise<{ error: string | null }>
  signInEmployeePin: (employeeId: string, pin: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (!data.session) setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
      if (!newSession) {
        setProfile(null)
        setEmployee(null)
        setLoading(false)
      }
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) return

    let cancelled = false
    setLoading(true)

    async function loadProfile() {
      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session!.user.id)
        .maybeSingle()

      if (cancelled) return
      setProfile(profileData)

      if (profileData?.role === 'employee') {
        const { data: employeeData } = await supabase
          .from('employees')
          .select('*')
          .eq('profile_id', session!.user.id)
          .maybeSingle()
        if (!cancelled) setEmployee(employeeData)
      } else {
        setEmployee(null)
      }

      if (!cancelled) setLoading(false)
    }

    loadProfile()
    return () => {
      cancelled = true
    }
  }, [session])

  async function signInAdmin(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error?.message ?? null }
  }

  async function signInEmployeePin(employeeId: string, pin: string) {
    const { data, error } = await supabase.functions.invoke('pin-login', {
      body: { employee_id: employeeId, pin },
    })

    if (error || !data?.access_token) {
      return { error: data?.error ?? error?.message ?? 'Invalid PIN' }
    }

    const { error: setError } = await supabase.auth.setSession({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
    })

    return { error: setError?.message ?? null }
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider
      value={{ session, profile, employee, loading, signInAdmin, signInEmployeePin, signOut }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
