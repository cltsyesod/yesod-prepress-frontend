import supabase from '@/lib/supabase/client'
import { getErrorMessage, normalizeRow, unwrap } from '@/lib/supabase/errors'
import { profileService } from '@/services/profileService'
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

export type AnalysisJobStatusResponse = AnalysisJob

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

// Os perfis ainda vivem no navegador: o perfil completo segue junto com o job
// para que o analisador aplique os parâmetros definidos pelo operador.
const resolveProfile = (idOrName: string): ProductionProfile | undefined =>
  profileService.getProfilesSync().find((p) => p.id === idOrName || p.name === idOrName)

export const analysisJobsService = {
  /**
   * Inicia a análise:
   * 1. Registra o job no Supabase (via RPC start_analysis ou insert direto)
   * 2. Aciona a Edge Function start_analysis para disparar o analisador Python
   */
  async startAnalysis(
    fileId: string,
    profileOrParams: string | StartAnalysisParams,
  ): Promise<AnalysisJob> {
    let profileId = ''
    let version: string | undefined = undefined

    if (typeof profileOrParams === 'string') {
      profileId = profileOrParams
    } else if (profileOrParams && typeof profileOrParams === 'object') {
      const p = profileOrParams.productionProfile as { id?: string; name?: string }
      profileId = p?.id || p?.name || ''
      version = profileOrParams.version
    }

    if (!profileId) {
      profileId = 'default'
    }

    // 1. Chamar RPC start_analysis
    const row = unwrap(
      await supabase.rpc('start_analysis', {
        p_file: fileId,
        p_production_profile: profileId,
        p_version: version ?? null,
      }),
    )
    const job = toJob(row)

    // 2. Acionar a Edge Function start_analysis
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token

      await supabase.functions.invoke('start_analysis', {
        body: {
          jobId: job.id,
          fileId: fileId,
          profileId: profileId,
          productionProfile: resolveProfile(profileId),
        },
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      })
    } catch (edgeErr) {
      console.warn('Edge Function start_analysis não respondeu ou em mock; job permanece registrado:', edgeErr)
    }

    return job
  },

  /**
   * Busca status detalhado de uma análise por ID.
   */
  async getAnalysisStatus(jobId: string): Promise<AnalysisJob> {
    const { data, error } = await supabase
      .from('analysis_jobs')
      .select('*')
      .eq('id', jobId)
      .single()

    if (error) throw error
    return toJob(data)
  },

  /** Alias para manter compatibilidade */
  async getAnalysis(analysisId: string): Promise<AnalysisJob> {
    return this.getAnalysisStatus(analysisId)
  },

  /**
   * Busca lista de ocorrências (issues) encontradas na análise ordenadas por severidade e página.
   */
  async getAnalysisIssues(jobId: string): Promise<AnalysisIssue[]> {
    const { data, error } = await supabase
      .from('analysis_issues')
      .select('*')
      .eq('analysis', jobId)
      .order('severity', { ascending: false })
      .order('page', { ascending: true })

    if (error) throw error
    return (data || []).map(toIssue)
  },

  /**
   * Atualiza o status de uma ocorrência (aprovada, rejeitada, corrigida, ignorada).
   */
  async updateIssueStatus(issueId: string, status: string, reason?: string): Promise<void> {
    const { data: auth } = await supabase.auth.getUser()
    const { error } = await supabase
      .from('analysis_issues')
      .update({
        status,
        decision_reason: reason || '',
        decision_user: auth.user?.id || null,
        decision_at: new Date().toISOString(),
      })
      .eq('id', issueId)

    if (error) throw error
  },

  /**
   * Assina atualizações em tempo real do status de uma análise via Supabase Realtime.
   * Retorna uma função para cancelar a assinatura (unsubscribe).
   */
  subscribeToAnalysisStatus(
    jobId: string,
    callback: (job: AnalysisJob) => void,
    errorHandler?: (error: unknown) => void,
  ): () => void {
    const channel = supabase
      .channel(`job-status-${jobId}-${Math.random().toString(36).slice(2, 8)}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'analysis_jobs',
          filter: `id=eq.${jobId}`,
        },
        (payload) => {
          if (payload.new) {
            callback(toJob(payload.new as Record<string, unknown>))
          }
        },
      )
      .subscribe((subStatus, err) => {
        if (err && errorHandler) {
          errorHandler(err)
        }
      })

    return () => {
      supabase.removeChannel(channel)
    }
  },

  /**
   * Cancela uma análise ativa.
   */
  async cancelAnalysis(jobId: string): Promise<void> {
    try {
      unwrap(await supabase.rpc('cancel_analysis', { p_id: jobId }))
    } catch {
      const { error } = await supabase
        .from('analysis_jobs')
        .update({ status: 'cancelled', completed_at: new Date().toISOString() })
        .eq('id', jobId)
      if (error) throw error
    }
  },

  /**
   * Retenta uma análise com falha.
   */
  async retryAnalysis(jobId: string): Promise<AnalysisJob> {
    const job = toJob(unwrap(await supabase.rpc('retry_analysis', { p_id: jobId })))
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token

      await supabase.functions.invoke('start_analysis', {
        body: {
          jobId: job.id,
          fileId: job.file,
          profileId: job.production_profile,
          productionProfile: resolveProfile(job.production_profile),
        },
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      })
    } catch (edgeErr) {
      console.warn('Erro ao acionar start_analysis no retry:', edgeErr)
    }
    return job
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

  getErrorMessage(error: unknown): string {
    return getErrorMessage(error)
  },
}
