import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import supabase from '@/lib/supabase/client'
import { mapSupabaseUser } from '@/services/authService'
import type { User } from '@/types'

interface AuthContextType {
  user: User | null
  isAuthenticated: boolean
  loading: boolean
  signIn: (email: string, pass: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    localStorage.removeItem('yesod_prepress_user')

    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ? mapSupabaseUser(data.session.user) : null)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ? mapSupabaseUser(session.user) : null)
    })

    return () => {
      sub.subscription.unsubscribe()
    }
  }, [])

  const signIn = async (email: string, pass: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password: pass })
    if (error) throw error
    setUser(mapSupabaseUser(data.user))
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    setUser(null)
  }

  const isAuthenticated = user !== null

  return (
    <AuthContext.Provider value={{ user, isAuthenticated, loading, signIn, signOut }}>
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
