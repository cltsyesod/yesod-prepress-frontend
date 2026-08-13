import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import pb from '@/lib/pocketbase/client'
import type { User } from '@/types'

interface AuthContextType {
  user: User | null
  isAuthenticated: boolean
  loading: boolean
  signIn: (email: string, pass: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

function mapPbUser(record: any): User {
  return {
    id: record.id,
    name: record.name || record.email || 'Usuário',
    email: record.email || '',
    avatarUrl: '',
    company: 'Yesod Automation',
    plan: 'Plano Profissional',
    role: 'Operador',
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isAuthenticated, setIsAuthenticated] = useState(pb.authStore.isValid)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    localStorage.removeItem('yesod_prepress_user')

    const init = async () => {
      if (pb.authStore.isValid && pb.authStore.record) {
        try {
          await pb.collection('users').authRefresh()
          setUser(mapPbUser(pb.authStore.record))
          setIsAuthenticated(true)
        } catch {
          pb.authStore.clear()
          setUser(null)
          setIsAuthenticated(false)
        }
      } else {
        pb.authStore.clear()
        setUser(null)
        setIsAuthenticated(false)
      }
      setLoading(false)
    }
    init()

    const unsub = pb.authStore.onChange((_token, record) => {
      if (pb.authStore.isValid && record) {
        setUser(mapPbUser(record))
        setIsAuthenticated(true)
      } else {
        setUser(null)
        setIsAuthenticated(false)
      }
    })

    return () => {
      unsub()
    }
  }, [])

  const signIn = async (email: string, pass: string) => {
    const authData = await pb.collection('users').authWithPassword(email, pass)
    setUser(mapPbUser(authData.record))
    setIsAuthenticated(true)
  }

  const signOut = async () => {
    pb.authStore.clear()
    setUser(null)
    setIsAuthenticated(false)
  }

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
