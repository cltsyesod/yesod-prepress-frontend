import pb from '@/lib/pocketbase/client'
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

export const authService = {
  async login(email: string, password: string): Promise<User> {
    const authData = await pb.collection('users').authWithPassword(email, password)
    return {
      id: authData.record.id,
      name: authData.record.name || authData.record.email,
      email: authData.record.email,
      avatarUrl: '',
      company: 'Yesod Automation',
      plan: 'Plano Profissional',
      role: 'Operador',
    }
  },

  async logout(): Promise<void> {
    pb.authStore.clear()
  },

  getCurrentUser(): User | null {
    if (!pb.authStore.isValid || !pb.authStore.record) return null
    const record = pb.authStore.record as any
    return {
      id: record.id,
      name: record.name || record.email,
      email: record.email,
      avatarUrl: '',
      company: 'Yesod Automation',
      plan: 'Plano Profissional',
      role: 'Operador',
    }
  },
}
