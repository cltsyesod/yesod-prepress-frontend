import supabase from '@/lib/supabase/client'
import { getErrorMessage } from '@/lib/supabase/errors'

/** Papel na empresa: o dono gerencia a equipe; operadores trabalham nos mesmos trabalhos. */
export type TeamRole = 'owner' | 'operator'

export interface Member {
  userId: string
  name: string
  email: string
  role: TeamRole
  active: boolean
}

export interface Membership {
  orgId: string
  orgName: string
  role: TeamRole
  name: string
}

export const ROLE_LABEL: Record<TeamRole, string> = { owner: 'Administrador', operator: 'Operador' }

async function manage(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('manage_team', { body })
  if (error) {
    const detail = await (error as { context?: Response }).context?.json?.().catch(() => null)
    throw new Error(detail?.error || getErrorMessage(error))
  }
  return data
}

export const teamService = {
  /** Empresa e papel da conta logada; null se a conta não está numa empresa. */
  async me(userId: string): Promise<Membership | null> {
    const { data, error } = await supabase
      .from('memberships')
      .select('org_id, role, name, active, organizations(name)')
      .eq('user_id', userId)
      .maybeSingle()
    if (error) throw error
    if (!data || !data.active) return null
    const org = data.organizations as unknown as { name: string } | null
    return { orgId: data.org_id, orgName: org?.name ?? '', role: data.role as TeamRole, name: data.name }
  },

  async list(): Promise<Member[]> {
    const { data, error } = await supabase
      .from('memberships')
      .select('user_id, name, email, role, active')
      .order('created_at')
    if (error) throw error
    return (data ?? []).map((row) => ({
      userId: row.user_id,
      name: row.name || row.email,
      email: row.email,
      role: row.role as TeamRole,
      active: row.active,
    }))
  },

  /** Inclui um operador: a conta é criada já confirmada, com a senha provisória informada. */
  add(member: { name: string; email: string; password: string }) {
    return manage({ action: 'add', ...member })
  },

  setActive(userId: string, active: boolean) {
    return manage({ action: active ? 'reactivate' : 'deactivate', userId })
  },

  rename(name: string) {
    return manage({ action: 'rename', name })
  },
}
