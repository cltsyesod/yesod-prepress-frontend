import supabase from '@/lib/supabase/client'
import { analysisJobsService, type AnalysisJob, type AnalysisIssue } from '@/services/analysisJobsService'
import { artworkType, projectFilesService } from '@/services/projectFilesService'
import type { ProjectFile, TextileSettings } from '@/types'
import type { DtgPlacement } from '@/domain/dtg/placement'

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
  /** DTF/DTG: sobrepõe o perfil têxtil neste trabalho (ex.: área do gabarito escolhido). */
  textile?: Partial<TextileSettings>
  /** DTG: gabarito, posição e peça. */
  dtg?: DtgPlacement
  notes?: string
}

export type Priority = 'baixa' | 'normal' | 'alta' | 'urgente'

/**
 * Etapa do trabalho na pré-impressão, calculada no banco (job_overview) a partir da
 * última análise do arquivo principal e das decisões: não depende de a tela estar aberta.
 */
export type JobStage =
  | 'waiting'
  | 'analyzing'
  | 'failed'
  | 'blocked'
  | 'decision'
  | 'returned'
  | 'ready'
  | 'sent'
  | 'archived'

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
  createdAt: string
  dueDate: string | null
  priority: Priority
  assigneeId: string | null
  sentToRipAt: string | null
  sentToRipBy: string | null
  /** Só na lista (job_overview). */
  stage?: JobStage
  lastActivity?: string
  pendingCritical?: number
  pendingWarning?: number
  returned?: number
  latestAnalysis: Pick<AnalysisJob, 'id' | 'status' | 'progress' | 'current_step' | 'error_message'> | null
}

export type JobState = 'analyzing' | 'blocked' | 'review' | 'returned' | 'ready' | 'sent' | 'failed' | 'waiting'

const STAGE_STATE: Record<JobStage, JobState> = {
  waiting: 'waiting',
  analyzing: 'analyzing',
  failed: 'failed',
  blocked: 'blocked',
  decision: 'review',
  returned: 'returned',
  ready: 'ready',
  sent: 'sent',
  archived: 'ready',
}

const ACTIVE = ['queued', 'preparing', 'downloading', 'validating', 'extracting', 'analyzing', 'generating_preview']

export function jobState(job: Job): JobState {
  if (job.sentToRipAt) return 'sent'
  if (job.stage) return STAGE_STATE[job.stage]
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
    createdAt: row.created_at || '',
    dueDate: row.due_date || null,
    priority: (row.priority as Priority) || 'normal',
    assigneeId: row.assignee_id || null,
    sentToRipAt: row.sent_to_rip_at || null,
    sentToRipBy: row.sent_to_rip_by || null,
    stage: row.stage as JobStage | undefined,
    lastActivity: row.last_activity || undefined,
    pendingCritical: row.pending_critical ?? undefined,
    pendingWarning: row.pending_warning ?? undefined,
    returned: row.returned ?? undefined,
    latestAnalysis: latest,
  }
}

const PROJECT_COLUMNS =
  'id, name, client_name, profile_id, job_ticket, issue_count, severity, updated_at, created_at, ' +
  'due_date, priority, assignee_id, sent_to_rip_at, sent_to_rip_by'

// A lista lê a etapa já calculada no banco, com os campos da ficha que ela usa.
const OVERVIEW_COLUMNS =
  'id, name, client_name, status, created_at, updated_at, due_date, priority, assignee_id, sent_to_rip_at, ' +
  'sent_to_rip_by, stage, last_activity, pending_critical, pending_warning, returned'

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
      .from('job_overview')
      .select(OVERVIEW_COLUMNS)
      .neq('status', 'archived')
      .order('last_activity', { ascending: false })
      .limit(300)
    if (error) throw error
    const rows = (data ?? []) as Record<string, any>[]
    const latest = await latestAnalyses(rows.map((row) => row.id))
    return rows.map((row) => toJob(row, latest.get(row.id) ?? null))
  },

  /** Prazo, prioridade e responsável (gestão; não mexem na análise). */
  async updateMeta(
    id: string,
    meta: Partial<{ dueDate: string | null; priority: Priority; assigneeId: string | null }>,
  ): Promise<void> {
    const row: Record<string, unknown> = {}
    if ('dueDate' in meta) row.due_date = meta.dueDate || null
    if ('priority' in meta) row.priority = meta.priority
    if ('assigneeId' in meta) row.assignee_id = meta.assigneeId || null
    const { error } = await supabase.from('projects').update(row).eq('id', id)
    if (error) throw error
  },

  /** Marca (ou desfaz) o envio ao RIP: fim da pré-impressão. */
  async setSentToRip(id: string, sent: boolean): Promise<void> {
    const { data: auth } = await supabase.auth.getUser()
    const { error } = await supabase
      .from('projects')
      .update(
        sent
          ? { sent_to_rip_at: new Date().toISOString(), sent_to_rip_by: auth.user?.id ?? null }
          : { sent_to_rip_at: null, sent_to_rip_by: null },
      )
      .eq('id', id)
    if (error) throw error
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

  /**
   * Cria o trabalho, envia a arte e já dispara a análise. Retorna o id do trabalho.
   * Imagem (TIFF, JPEG, PNG): o analisador primeiro a converte em PDF (sem reamostrar); o
   * PDF vira o arquivo principal e a imagem do cliente fica guardada como original.
   */
  async createFromFile(
    file: File,
    params: {
      clientName: string
      profileId: string
      profileName: string
      ticket: JobTicket
      dueDate?: string | null
      priority?: Priority
      assigneeId?: string | null
    },
  ): Promise<string> {
    const { data: auth } = await supabase.auth.getUser()
    if (!auth.user) throw new Error('Faça login novamente para enviar arquivos.')

    const { data: project, error } = await supabase
      .from('projects')
      .insert({
        user_id: auth.user.id,
        name: file.name.replace(/\.(pdf|tiff?|jpe?g|png)$/i, ''),
        client_name: params.clientName,
        profile_id: params.profileId,
        production_profile: params.profileName,
        job_ticket: params.ticket,
        due_date: params.dueDate || null,
        priority: params.priority || 'normal',
        assignee_id: params.assigneeId === undefined ? auth.user.id : params.assigneeId || null,
        filename: file.name,
        file_type: artworkType(file.name)?.extension ?? 'PDF',
        file_size: file.size,
        status: 'analyzing',
      })
      .select('id')
      .single()
    if (error) throw error

    const uploaded = await projectFilesService.uploadPDF(file, project.id)
    await analysisJobsService.startAnalysis(uploaded.id, params.profileId || 'default', uploaded)
    return project.id
  },

  /** Trabalhos cujo arquivo principal já recebeu a base branca gerada pelo sistema. */
  async withWhiteBase(projectIds: string[]): Promise<Set<string>> {
    if (!projectIds.length) return new Set()
    const { data, error } = await supabase
      .from('project_files')
      .select('project, applied_fixes')
      .in('project', projectIds)
      .eq('is_primary', true)
      .neq('status', 'removed')
    if (error) throw error
    return new Set(
      (data ?? [])
        .filter((row) =>
          ((row.applied_fixes as { id?: string }[] | null) ?? []).some((fix) => fix?.id === 'add_white_underbase'),
        )
        .map((row) => String(row.project)),
    )
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

  /**
   * Arquivo principal do trabalho e, se houver, a correção automática em andamento
   * (cópia ainda "pending" cuja análise não terminou).
   */
  async getFiles(
    projectId: string,
  ): Promise<{ primary: ProjectFile | null; correction: ProjectFile | null; original: ProjectFile | null }> {
    const files = await projectFilesService.getProjectFiles(projectId)
    const ready = files.filter((f) => f.status !== 'pending' || !f.derived_from)
    const primary = ready.find((f) => f.is_primary) ?? ready[0] ?? null
    // O arquivo como o cliente enviou (o principal, se nunca foi corrigido).
    const original = primary?.derived_from ? (files.find((f) => f.id === primary.derived_from) ?? null) : primary

    const pending = files.find((f) => f.status === 'pending' && f.derived_from)
    let correction: ProjectFile | null = null
    if (pending) {
      const job = await analysisJobsService.getLatestJobForFile(pending.id)
      if (job && ACTIVE.includes(job.status)) correction = pending
    }
    return { primary, correction, original }
  },

  /** Volta a usar outra versão (ex.: o original de uma cópia corrigida) como principal. */
  async setPrimaryFile(projectId: string, fileId: string): Promise<void> {
    const { error: clearErr } = await supabase
      .from('project_files')
      .update({ is_primary: false })
      .eq('project', projectId)
      .neq('id', fileId)
    if (clearErr) throw clearErr
    const { error } = await supabase.from('project_files').update({ is_primary: true }).eq('id', fileId)
    if (error) throw error
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
