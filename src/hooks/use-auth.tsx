import { createContext, useCallback, useContext, useState, useEffect, ReactNode } from 'react'
import supabase from '@/lib/supabase/client'
import { mapSupabaseUser } from '@/services/authService'
import { ROLE_LABEL, teamService, type Membership } from '@/services/teamService'
import type { User } from '@/types'

interface AuthContextType {
  user: User | null
  /** Empresa e papel da conta (null: conta sem empresa ou desativada). */
  membership: Membership | null
  isAuthenticated: boolean
  loading: boolean
  signIn: (email: string, pass: string) => Promise<void>
  signOut: () => Promise<void>
  /** Relê a empresa (ex.: depois de renomeá-la). */
  refreshMembership: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [membership, setMembership] = useState<Membership | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    localStorage.removeItem('yesod_prepress_user')

    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ? mapSupabaseUser(data.session.user) : null)
      if (!data.session?.user) setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ? mapSupabaseUser(session.user) : null)
    })

    return () => {
      sub.subscription.unsubscribe()
    }
  }, [])

  // Empresa e papel vêm do banco (memberships), não da sessão.
  const userId = user?.id
  const loadMembership = useCallback(async () => {
    if (!userId) {
      setMembership(null)
      return
    }
    try {
      setMembership(await teamService.me(userId))
    } catch {
      setMembership(null)
    }
    setLoading(false)
  }, [userId])

  useEffect(() => {
    loadMembership()
  }, [loadMembership])

  const signIn = async (email: string, pass: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password: pass })
    if (error) throw error
    setUser(mapSupabaseUser(data.user))
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    setUser(null)
    setMembership(null)
  }

  const shown: User | null = user
    ? {
        ...user,
        name: membership?.name || user.name,
        company: membership?.orgName || '',
        plan: '',
        role: membership ? ROLE_LABEL[membership.role] : '',
      }
    : null

  return (
    <AuthContext.Provider
      value={{
        user: shown,
        membership,
        isAuthenticated: user !== null,
        loading,
        signIn,
        signOut,
        refreshMembership: loadMembership,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth deve ser usado dentro de um AuthProvider')
  }
  return context
}
