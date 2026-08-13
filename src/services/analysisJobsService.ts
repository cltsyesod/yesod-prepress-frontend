import pb from '@/lib/pocketbase/client'
import { getErrorMessage } from '@/lib/pocketbase/errors'
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

export interface ExternalAnalyzerPayload {
  analysisId: string
  projectId: string
  fileId: string
  versionId: string
  productionProfile: {
    id: string
    rules: unknown[]
    colorModeExpected: string
    minimumResolutionDpi: number
    minimumBleedMm: number
    minimumSafetyMarginMm: number
    requiresCutLayer: boolean
  }
  callbackUrl: string
}

export interface StartAnalysisParams {
  productionProfile: ProductionProfile | { id: string; rules?: unknown[] }
  version?: string
}

export const analysisJobsService = {
  async startAnalysis(
    fileId: string,
    params: StartAnalysisParams,
  ): Promise<ExternalAnalyzerPayload> {
    return pb.send(`/backend/v1/files/${fileId}/analyze`, {
      method: 'POST',
      body: JSON.stringify(params),
      headers: { 'Content-Type': 'application/json' },
    })
  },

  async getAnalysis(analysisId: string): Promise<AnalysisJob> {
    return pb.send(`/backend/v1/analyses/${analysisId}`, { method: 'GET' })
  },

  async getAnalysisStatus(analysisId: string): Promise<AnalysisJobStatusResponse> {
    return pb.send(`/backend/v1/analyses/${analysisId}/status`, { method: 'GET' })
  },

  async getAnalysisIssues(analysisId: string): Promise<AnalysisIssue[]> {
    return pb.send(`/backend/v1/analyses/${analysisId}/issues`, { method: 'GET' })
  },

  async retryAnalysis(
    analysisId: string,
  ): Promise<{ id: string; status: string; retry_count: number }> {
    return pb.send(`/backend/v1/analyses/${analysisId}/retry`, { method: 'POST' })
  },

  async cancelAnalysis(analysisId: string): Promise<{ id: string; status: string }> {
    return pb.send(`/backend/v1/analyses/${analysisId}/cancel`, { method: 'POST' })
  },

  getErrorMessage(error: unknown): string {
    return getErrorMessage(error)
  },
}
