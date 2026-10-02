import type {
  Project,
  AnalysisResult,
  ProjectVersion,
  DashboardMetrics,
  RecurringIssue,
} from '@/types'
import { MOCK_PROJECTS } from '@/services/mockProjects'
import { RECURRING_ISSUES } from '@/services/mockData'
import { versionService } from '@/services/versionService'
import supabase from '@/lib/supabase/client'

const STORAGE_KEY = 'yesod-projects'

function getStoredProjects(): Project[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored ? (JSON.parse(stored) as Project[]) : []
  } catch {
    return []
  }
}

function saveStoredProjects(projects: Project[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects))
  } catch {
    /* noop */
  }
}

function mapRowToProject(row: Record<string, any>): Project {
  return {
    id: row.id,
    name: row.name || 'Projeto sem nome',
    clientId: row.client_id || 'cli-default',
    clientName: row.client_name || 'Cliente Padrão',
    status: row.status || 'draft',
    severity: row.severity || 'none',
    issueCount: Number(row.issue_count ?? 0),
    orderNumber: row.order_number || '',
    filename: row.filename || '',
    fileType: row.file_type || 'PDF',
    fileSize: Number(row.file_size ?? 0),
    productionProfile: row.production_profile || '',
    profileId: row.profile_id || '',
    productionType: row.production_type || 'Offset',
    responsibleId: row.responsible_id || '',
    responsibleName: row.responsible_name || '',
    createdAt: row.created_at || new Date().toISOString(),
    updatedAt: row.updated_at || new Date().toISOString(),
    deadline: row.deadline || '',
    description: row.description || '',
    observations: row.observations || '',
    tags: Array.isArray(row.tags) ? row.tags : [],
    files: Array.isArray(row.files) ? row.files : [],
  }
}

function mapProjectToRow(data: Partial<Project>, userId?: string): Record<string, any> {
  const row: Record<string, any> = {}
  if (userId) row.user_id = userId
  if (data.name !== undefined) row.name = data.name
  if (data.clientId !== undefined) row.client_id = data.clientId
  if (data.clientName !== undefined) row.client_name = data.clientName
  if (data.orderNumber !== undefined) row.order_number = data.orderNumber
  if (data.responsibleId !== undefined) row.responsible_id = data.responsibleId
  if (data.responsibleName !== undefined) row.responsible_name = data.responsibleName
  if (data.deadline !== undefined) row.deadline = data.deadline
  if (data.description !== undefined) row.description = data.description
  if (data.observations !== undefined) row.observations = data.observations
  if (data.tags !== undefined) row.tags = data.tags
  if (data.profileId !== undefined) row.profile_id = data.profileId
  if (data.productionProfile !== undefined) row.production_profile = data.productionProfile
  if (data.productionType !== undefined) row.production_type = data.productionType
  if (data.status !== undefined) row.status = data.status
  if (data.severity !== undefined) row.severity = data.severity
  if (data.issueCount !== undefined) row.issue_count = data.issueCount
  if (data.filename !== undefined) row.filename = data.filename
  if (data.fileType !== undefined) row.file_type = data.fileType
  if (data.fileSize !== undefined) row.file_size = data.fileSize
  return row
}

export const projectService = {
  /**
   * Cria um novo projeto no Supabase com fallback para localStorage.
   */
  async createProject(data: Partial<Project>): Promise<Project> {
    const { data: auth } = await supabase.auth.getUser()
    const userId = auth.user?.id

    const insertPayload = mapProjectToRow(
      {
        name: data.name || 'Novo Projeto',
        clientId: data.clientId || 'cli-default',
        clientName: data.clientName || 'Cliente Padrão',
        orderNumber: data.orderNumber || `PED-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
        responsibleId: data.responsibleId || userId || 'usr-1',
        responsibleName: data.responsibleName || auth.user?.email || 'Usuário Atual',
        deadline: data.deadline || new Date(Date.now() + 14 * 86400000).toISOString(),
        description: data.description || '',
        observations: data.observations || '',
        tags: data.tags || [],
        profileId: data.profileId || data.productionProfile || 'default',
        productionProfile: data.productionProfile || 'Padrão Offset',
        productionType: data.productionType || 'Offset',
        status: data.status || 'draft',
        severity: data.severity || 'none',
        issueCount: data.issueCount ?? 0,
        filename: data.filename || '',
        fileType: data.fileType || 'PDF',
        fileSize: data.fileSize || 0,
      },
      userId,
    )

    try {
      const { data: created, error } = await supabase
        .from('projects')
        .insert(insertPayload)
        .select()
        .single()

      if (!error && created) {
        return mapRowToProject(created)
      }
    } catch (err) {
      console.warn('Erro ao inserir projeto no Supabase, usando persistência local:', err)
    }

    // Fallback local
    const fallbackProj: Project = {
      id: data.id || `proj-${Date.now()}`,
      name: data.name || 'Novo Projeto',
      clientId: data.clientId || 'cli-default',
      clientName: data.clientName || 'Cliente Padrão',
      status: data.status || 'draft',
      severity: data.severity || 'none',
      issueCount: data.issueCount ?? 0,
      orderNumber: data.orderNumber || `PED-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
      filename: data.filename || '',
      fileType: data.fileType || 'PDF',
      fileSize: data.fileSize || 0,
      productionProfile: data.productionProfile || 'Offset 4x4 - Cores',
      productionType: data.productionType || 'Offset',
      responsibleId: data.responsibleId || 'usr-1',
      responsibleName: data.responsibleName || 'Usuário Demo',
      createdAt: new Date().toISOString(),
      deadline: data.deadline || new Date(Date.now() + 14 * 86400000).toISOString(),
      updatedAt: new Date().toISOString(),
      description: data.description || '',
      observations: data.observations || '',
      tags: data.tags || [],
      files: data.files || [],
    }
    const stored = getStoredProjects()
    stored.unshift(fallbackProj)
    saveStoredProjects(stored)
    return fallbackProj
  },

  /**
   * Busca projetos com filtros opcionais.
   */
  async getProjects(filters?: { status?: string; clientId?: string }): Promise<Project[]> {
    try {
      let query = supabase.from('projects').select('*').order('created_at', { ascending: false })
      if (filters?.status) {
        query = query.eq('status', filters.status)
      }
      if (filters?.clientId) {
        query = query.eq('client_id', filters.clientId)
      }
      const { data, error } = await query
      if (!error && data && data.length > 0) {
        return data.map(mapRowToProject)
      }
    } catch (err) {
      console.warn('Erro ao buscar projetos do Supabase:', err)
    }

    // Retorna projetos armazenados localmente e mocks
    const local = [...getStoredProjects(), ...MOCK_PROJECTS]
    if (filters?.status) {
      return local.filter((p) => p.status === filters.status)
    }
    return local
  },

  /** Alias para manter retrocompatibilidade */
  async listProjects(): Promise<Project[]> {
    return this.getProjects()
  },

  /**
   * Busca um único projeto por ID.
   */
  async getProject(projectId: string): Promise<Project | null> {
    try {
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .eq('id', projectId)
        .maybeSingle()

      if (!error && data) {
        return mapRowToProject(data)
      }
    } catch (err) {
      console.warn('Erro ao buscar projeto do Supabase:', err)
    }

    const local = [...getStoredProjects(), ...MOCK_PROJECTS]
    return local.find((p) => p.id === projectId) || null
  },

  /**
   * Atualiza dados de um projeto.
   */
  async updateProject(projectId: string, updates: Partial<Project>): Promise<Project> {
    const updatePayload = mapProjectToRow(updates)
    updatePayload.updated_at = new Date().toISOString()

    try {
      const { data, error } = await supabase
        .from('projects')
        .update(updatePayload)
        .eq('id', projectId)
        .select()
        .single()

      if (!error && data) {
        return mapRowToProject(data)
      }
    } catch (err) {
      console.warn('Erro ao atualizar projeto no Supabase:', err)
    }

    // Fallback local
    const stored = getStoredProjects()
    const idx = stored.findIndex((p) => p.id === projectId)
    if (idx !== -1) {
      stored[idx] = { ...stored[idx], ...updates, updatedAt: new Date().toISOString() }
      saveStoredProjects(stored)
      return stored[idx]
    }
    return { id: projectId, ...updates } as Project
  },

  /**
   * Arquiva um projeto (status = 'archived').
   */
  async archiveProject(projectId: string): Promise<void> {
    await this.updateProject(projectId, { status: 'archived' })
  },

  /**
   * Assina alterações na tabela de projetos via Supabase Realtime.
   */
  subscribeToProjects(
    callback: () => void,
    errorHandler?: (error: unknown) => void,
  ): () => void {
    const channel = supabase
      .channel(`projects-all-${Math.random().toString(36).slice(2, 8)}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'projects' },
        () => {
          callback()
        },
      )
      .subscribe((status, err) => {
        if (err && errorHandler) {
          errorHandler(err)
        }
      })

    return () => {
      supabase.removeChannel(channel)
    }
  },

  // ---------- Métodos analíticos para Dashboards e Relatórios ----------
  async getMetrics(): Promise<DashboardMetrics> {
    const all = await this.listProjects()
    return {
      total: all.length,
      pendingAnalysis: all.filter(
        (p) => p.status === 'pending_analysis' || p.status === 'analyzing',
      ).length,
      requiresAttention: all.filter(
        (p) => p.severity === 'critical' || p.status === 'failed' || p.status === 'needs_review',
      ).length,
      pendingApproval: all.filter((p) => p.status === 'pending_approval').length,
      approved: all.filter((p) => p.status === 'approved').length,
      filesProcessed: 28 + all.length,
    }
  },

  async getPriorityProjects(): Promise<Project[]> {
    const all = await this.listProjects()
    return all.filter(
      (p) => p.severity === 'critical' || p.status === 'failed' || p.status === 'pending_approval',
    )
  },

  async getRecurringIssues(): Promise<RecurringIssue[]> {
    return RECURRING_ISSUES
  },

  async getProjectAnalysis(projectId: string): Promise<AnalysisResult | null> {
    const project = await this.getProject(projectId)
    if (!project) return null
    return {
      id: `ana-${projectId}`,
      projectId,
      fileId: 'file-1',
      status: 'completed',
      issues:
        project.issueCount > 0
          ? [
              {
                id: 'iss-1',
                severity: 'critical',
                category: 'Resolução de Imagem',
                message: 'Imagem em 150 DPI encontrada na página 3 (mínimo recomendado: 300 DPI).',
                page: 3,
              },
              {
                id: 'iss-2',
                severity: 'warning',
                category: 'Espaço de Cor',
                message: 'Objetos em RGB identificados na página 1.',
                page: 1,
              },
            ]
          : [],
      summary: `Arquivo analisado com ${project.issueCount} problema(s) encontrado(s).`,
      createdAt: new Date().toISOString(),
    }
  },

  async getProjectVersions(projectId: string): Promise<ProjectVersion[]> {
    return versionService.getVersions(projectId)
  },
}
