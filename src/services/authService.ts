import type { User as SupabaseUser } from '@supabase/supabase-js'
import supabase from '@/lib/supabase/client'
import { User } from '@/types'

export const DEMO_USER: User = {
  id: 'usr-1',
  name: 'João Silva',
  email: 'demo@yesodautomation.com',
  company: 'Gráfica Exemplo',
  plan: 'Plano Profissional',
  avatarUrl: '',
  role: 'Operador',
}

export function mapSupabaseUser(user: SupabaseUser): User {
  const email = user.email || ''
  return {
    id: user.id,
    name: (user.user_metadata?.name as string) || email || 'Usuário',
    email,
    avatarUrl: '',
    company: 'Yesod Automation',
    plan: 'Plano Profissional',
    role: 'Operador',
  }
}

export const authService = {
  async login(email: string, password: string): Promise<User> {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    return mapSupabaseUser(data.user)
  },

  async logout(): Promise<void> {
    await supabase.auth.signOut()
  },

  async getCurrentUser(): Promise<User | null> {
    const { data } = await supabase.auth.getUser()
    return data.user ? mapSupabaseUser(data.user) : null
  },
}
