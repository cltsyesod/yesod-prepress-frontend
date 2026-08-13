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

function getAllProjects(): Project[] {
  return [...getStoredProjects(), ...MOCK_PROJECTS]
}

export const projectService = {
  async listProjects(): Promise<Project[]> {
    await new Promise((r) => setTimeout(r, 400))
    return getAllProjects()
  },

  async getProject(id: string): Promise<Project | null> {
    await new Promise((r) => setTimeout(r, 200))
    return getAllProjects().find((p) => p.id === id) || null
  },

  async createProject(data: Partial<Project>): Promise<Project> {
    await new Promise((r) => setTimeout(r, 300))
    const newProj: Project = {
      id: data.id || `proj-${Date.now()}`,
      name: data.name || 'Novo Projeto',
      clientId: data.clientId || 'cli-default',
      clientName: data.clientName || 'Cliente Padrão',
      status: data.status || 'active',
      severity: data.severity || 'none',
      issueCount: data.issueCount ?? 0,
      orderNumber:
        data.orderNumber || `PED-2026-${String(Math.floor(Math.random() * 9000) + 1000)}`,
      filename: data.filename || 'arquivo.pdf',
      fileType: data.fileType || 'PDF',
      fileSize: data.fileSize || 0,
      productionProfile: data.productionProfile || 'Offset 4x4 - Cores',
      productionType: data.productionType || 'Offset',
      responsibleId: data.responsibleId || 'usr-1',
      responsibleName: data.responsibleName || 'Usuário Demo',
      createdAt: data.createdAt || new Date().toISOString(),
      deadline: data.deadline || new Date(Date.now() + 14 * 86400000).toISOString(),
      updatedAt: new Date().toISOString(),
      description: data.description || '',
      observations: data.observations || '',
      tags: data.tags || [],
      files: data.files || [],
    }
    const stored = getStoredProjects()
    stored.unshift(newProj)
    saveStoredProjects(stored)
    return newProj
  },

  async updateProject(id: string, updates: Partial<Project>): Promise<void> {
    const stored = getStoredProjects()
    const idx = stored.findIndex((p) => p.id === id)
    if (idx !== -1) {
      stored[idx] = { ...stored[idx], ...updates, updatedAt: new Date().toISOString() }
      saveStoredProjects(stored)
    }
  },

  async getMetrics(): Promise<DashboardMetrics> {
    await new Promise((r) => setTimeout(r, 300))
    const all = getAllProjects()
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
      filesProcessed: 28 + getStoredProjects().length,
    }
  },

  async getPriorityProjects(): Promise<Project[]> {
    await new Promise((r) => setTimeout(r, 200))
    return getAllProjects().filter(
      (p) => p.severity === 'critical' || p.status === 'failed' || p.status === 'pending_approval',
    )
  },

  async getRecurringIssues(): Promise<RecurringIssue[]> {
    await new Promise((r) => setTimeout(r, 150))
    return RECURRING_ISSUES
  },

  async getProjectAnalysis(projectId: string): Promise<AnalysisResult | null> {
    await new Promise((r) => setTimeout(r, 200))
    const project = getAllProjects().find((p) => p.id === projectId)
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
    await new Promise((r) => setTimeout(r, 200))
    return versionService.getVersions(projectId)
  },
}
