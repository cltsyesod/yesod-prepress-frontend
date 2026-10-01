import supabase from '@/lib/supabase/client'
import { getErrorMessage } from '@/lib/supabase/errors'

export const analysisIssuesService = {
  async updateStatus(issueId: string, status: string, reason?: string): Promise<void> {
    const { data: auth } = await supabase.auth.getUser()
    const { error } = await supabase
      .from('analysis_issues')
      .update({
        status,
        decision_reason: reason || '',
        decision_user: auth.user?.id ?? null,
        decision_at: new Date().toISOString(),
      })
      .eq('id', issueId)
    if (error) throw error
  },

  getErrorMessage(error: unknown): string {
    return getErrorMessage(error)
  },
}
