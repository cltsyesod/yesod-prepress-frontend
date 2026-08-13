import pb from '@/lib/pocketbase/client'
import { getErrorMessage } from '@/lib/pocketbase/errors'

export const analysisIssuesService = {
  async updateStatus(issueId: string, status: string, reason?: string): Promise<void> {
    const userId = pb.authStore.record?.id || ''
    await pb.collection('analysis_issues').update(issueId, {
      status,
      decision_reason: reason || '',
      decision_user: userId,
      decision_at: new Date().toISOString(),
    })
  },

  getErrorMessage(error: unknown): string {
    return getErrorMessage(error)
  },
}
