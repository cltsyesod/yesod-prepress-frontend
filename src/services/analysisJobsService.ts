import supabase from '@/lib/supabase/client'
import { getErrorMessage, normalizeRow, unwrap } from '@/lib/supabase/errors'
import type { ProductionProfile } from '@/types'

export type AnalysisJobStatus =
  | 'queued'
  | 'preparing'
  | 'downloading'
  | 'validating'
  | 'extracting'
  | 'analyzing'
  | 'generating_preview'
  | 'completed'
  | 'completed_with_warnings'
  | 'failed'
  | 'cancelled'

export interface AnalysisJob {
  id: string
  project: string
  file: string
  version: string
  production_profile: string
  user: string
  status: AnalysisJobStatus
  progress: number
  current_step: string
  external_job_id: string
  started_at: string
  completed_at: string
  error_code: string
  error_message: string
  retry_count: number
  created: string
  updated: string
}

export interface AnalysisJobStatusResponse {
  id: string
  status: AnalysisJobStatus
  progress: number
  current_step: string
  started_at: string
  completed_at: string
  error_code: string
  error_message: string
}

export type IssueSeverity = 'critical' | 'warning' | 'informational'
export type IssueStatus = 'pending' | 'approved' | 'rejected' | 'ignored' | 'corrected'

export interface AnalysisIssue {
  id: string
  analysis: string
  project: string
  file: string
  user: string
  rule_code: string
  title: string
  category: string
  severity: IssueSeverity
  status: IssueStatus
  page: number
  object_id: string
  coordinates: string
  found_value: string
  expected_value: string
  description: string
  recommendation: string
  confidence: number
  source: string
  can_auto_correct: boolean
  decision_reason: string
  decision_user: string
  decision_at: string
  created: string
  updated: string
}

export interface StartAnalysisParams {
  productionProfile: ProductionProfile | { id: string; rules?: unknown[] }
  version?: string
}

export const toJob = (row: Record<string, unknown>) => normalizeRow<AnalysisJob>(row)
export const toIssue = (row: Record<string, unknown>) => normalizeRow<AnalysisIssue>(row)

export const analysisJobsService = {
  async startAnalysis(fileId: string, params: StartAnalysisParams): Promise<AnalysisJob> {
    const profile = params.productionProfile as { id?: string; name?: string }
    return toJob(
      unwrap(
        await supabase.rpc('start_analysis', {
          p_file: fileId,
          p_production_profile: profile.id || profile.name || '',
          p_version: params.version ?? null,
        }),
      ),
    )
  },

  async getLatestJobForFile(fileId: string): Promise<AnalysisJob | null> {
    const { data, error } = await supabase
      .from('analysis_jobs')
      .select('*')
      .eq('file', fileId)
      .order('created', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    return data ? toJob(data) : null
  },

  async getAnalysis(analysisId: string): Promise<AnalysisJob> {
    return toJob(unwrap(await supabase.from('analysis_jobs').select('*').eq('id', analysisId).single()))
  },

  async getAnalysisStatus(analysisId: string): Promise<AnalysisJobStatusResponse> {
    return this.getAnalysis(analysisId)
  },

  async getAnalysisIssues(analysisId: string): Promise<AnalysisIssue[]> {
    const rows = unwrap(
      await supabase
        .from('analysis_issues')
        .select('*')
        .eq('analysis', analysisId)
        .order('created', { ascending: false }),
    )
    return rows.map(toIssue)
  },

  async retryAnalysis(
    analysisId: string,
  ): Promise<{ id: string; status: string; retry_count: number }> {
    return toJob(unwrap(await supabase.rpc('retry_analysis', { p_id: analysisId })))
  },

  async cancelAnalysis(analysisId: string): Promise<{ id: string; status: string }> {
    return toJob(unwrap(await supabase.rpc('cancel_analysis', { p_id: analysisId })))
  },

  getErrorMessage(error: unknown): string {
    return getErrorMessage(error)
  },
}
