import supabase from '@/lib/supabase/client'

export interface DashboardStats {
  days: number
  topRules: { rule_code: string; title: string; severity: string; occurrences: number; jobs: number }[]
  clients: { client: string; jobs: number; jobs_with_blockers: number; problems: number }[]
  decisions: Partial<Record<'pending' | 'corrected' | 'approved' | 'rejected' | 'ignored', number>>
  fixes: { id: string; label: string; n: number }[]
  analyses: { total: number; failed: number; avg_seconds: number | null; stuck: number }
  nesting: { runs: number; length_mm: number; efficiency: number | null }
  tiling: { exports: number }
}

/** Números do painel, calculados no banco (cada empresa vê só os seus). */
export const dashboardService = {
  async stats(days: number): Promise<DashboardStats> {
    const { data, error } = await supabase.rpc('dashboard_stats', { p_days: days })
    if (error) throw error
    return data as DashboardStats
  },

  /** Bytes ocupados pelos arquivos da empresa (o plano gratuito tem 1 GB no total). */
  async storageBytes(): Promise<number> {
    const { data, error } = await supabase.rpc('org_storage_bytes')
    if (error) throw error
    return Number(data) || 0
  },
}
