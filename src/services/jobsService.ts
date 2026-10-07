import supabase from '@/lib/supabase/client'
import { analysisJobsService, type AnalysisJob, type AnalysisIssue } from '@/services/analysisJobsService'
import { projectFilesService } from '@/services/projectFilesService'
import type { ProjectFile } from '@/types'

/**
 * Ficha técnica do trabalho, definida pelo operador para cada pedido.
 * Todos os campos são opcionais: o que ficar vazio vem do perfil de produção.
 */
export interface JobTicket {
  finalWidthMm?: number
  finalHeightMm?: number
  /** "1:1", "1:2", "1:10"... */
  fileScale?: string
  minResolution?: number
  minBleed?: number
  /** managed: o RIP converte RGB com perfil; cmyk_only: todo RGB é apontado. */
  rgbPolicy?: 'managed' | 'cmyk_only'
  cutLayerRequired?: boolean
  notes?: string
}

/** Um trabalho = um projeto com seu arquivo e a última análise. */
export interface Job {
  id: string
  name: string
  clientName: string
  profileId: string
  ticket: JobTicket
  issueCount: number
  severity: string
  updatedAt: string
  latestAnalysis: Pick<AnalysisJob, 'id' | 'status' | 'progress' | 'current_step' | 'error_message'> | null
}

export type JobState = 'analyzing' | 'blocked' | 'review' | 'ready' | 'failed' | 'waiting'

const ACTIVE = ['queued', 'preparing', 'downloading', 'validating', 'extracting', 'analyzing', 'generating_preview']

export function jobState(job: Job): JobState {
  const status = job.latestAnalysis?.status
  if (!status) return 'waiting'
  if (ACTIVE.includes(status)) return 'analyzing'
  if (status === 'failed' || status === 'cancelled') return 'failed'
  if (job.severity === 'critical') return 'blocked'
  if (job.issueCount > 0) return 'review'
  return 'ready'
}

function toJob(row: Record<string, any>, latest: Job['latestAnalysis']): Job {
  return {
    id: row.id,
    name: row.name || 'Trabalho sem nome',
    clientName: row.client_name || '',
    profileId: row.profile_id || '',
    ticket: (row.job_ticket as JobTicket) || {},
    issueCount: Number(row.issue_count ?? 0),
    severity: row.severity || 'none',
    updatedAt: row.updated_at || row.created_at || '',
    latestAnalysis: latest,
  }
}

const PROJECT_COLUMNS =
  'id, name, client_name, profile_id, job_ticket, issue_count, severity, updated_at, created_at'

async function latestAnalyses(projectIds: string[]) {
  const latest = new Map<string, Job['latestAnalysis']>()
  if (!projectIds.length) return latest
  const { data, error } = await supabase
    .from('analysis_jobs')
    .select('id, project, status, progress, current_step, error_message, created')
    .in('project', projectIds)
    .order('created', { ascending: false })
  if (error) throw error
  for (const row of data ?? []) {
    if (!latest.has(row.project)) latest.set(row.project, row as Job['latestAnalysis'])
  }
  return latest
}

export const jobsService = {
  async listJobs(): Promise<Job[]> {
    const { data, error } = await supabase
      .from('projects')
      .select(PROJECT_COLUMNS)
      .neq('status', 'archived')
      .order('updated_at', { ascending: false })
      .limit(200)
    if (error) throw error
    const rows = data ?? []
    const latest = await latestAnalyses(rows.map((row) => row.id))
    return rows.map((row) => toJob(row, latest.get(row.id) ?? null))
  },

  async getJob(id: string): Promise<Job | null> {
    const { data, error } = await supabase
      .from('projects')
      .select(PROJECT_COLUMNS)
      .eq('id', id)
      .maybeSingle()
    if (error) throw error
    if (!data) return null
    const latest = await latestAnalyses([id])
    return toJob(data, latest.get(id) ?? null)
  },

  /** Cria o trabalho, envia o PDF e já dispara a análise. Retorna o id do trabalho. */
  async createFromFile(
    file: File,
    params: { clientName: string; profileId: string; profileName: string; ticket: JobTicket },
  ): Promise<string> {
    const { data: auth } = await supabase.auth.getUser()
    if (!auth.user) throw new Error('Faça login novamente para enviar arquivos.')

    const { data: project, error } = await supabase
      .from('projects')
      .insert({
        user_id: auth.user.id,
        name: file.name.replace(/\.pdf$/i, ''),
        client_name: params.clientName,
        profile_id: params.profileId,
        production_profile: params.profileName,
        job_ticket: params.ticket,
        filename: file.name,
        file_type: 'PDF',
        file_size: file.size,
        status: 'analyzing',
      })
      .select('id')
      .single()
    if (error) throw error

    const uploaded = await projectFilesService.uploadPDF(file, project.id)
    await analysisJobsService.startAnalysis(uploaded.id, params.profileId || 'default')
    return project.id
  },

  async updateTicket(id: string, ticket: JobTicket, profileId: string): Promise<void> {
    const { error } = await supabase
      .from('projects')
      .update({ job_ticket: ticket, profile_id: profileId })
      .eq('id', id)
    if (error) throw error
  },

  async archive(id: string): Promise<void> {
    const { error } = await supabase.from('projects').update({ status: 'archived' }).eq('id', id)
    if (error) throw error
  },

  async getPrimaryFile(projectId: string): Promise<ProjectFile | null> {
    const files = await projectFilesService.getProjectFiles(projectId)
    return files.find((f) => f.is_primary) ?? files[0] ?? null
  },

  /** Mantém o resumo da fila coerente com as decisões tomadas na tela do trabalho. */
  async syncSummary(projectId: string, issues: AnalysisIssue[]): Promise<void> {
    const { issueCount, severity } = summarizeIssues(issues)
    await supabase
      .from('projects')
      .update({
        issue_count: issueCount,
        severity,
        status: issueCount ? 'needs_review' : 'pending_approval',
      })
      .eq('id', projectId)
  },
}

/** Pendências que impedem o "Pronto": tudo que não é informativo e ainda não foi decidido. */
export function summarizeIssues(issues: AnalysisIssue[]): Pick<Job, 'issueCount' | 'severity'> {
  const pending = issues.filter((i) => i.status === 'pending' && i.severity !== 'informational')
  const severity = pending.some((i) => i.severity === 'critical')
    ? 'critical'
    : pending.length
      ? 'warning'
      : 'none'
  return { issueCount: pending.length, severity }
}
