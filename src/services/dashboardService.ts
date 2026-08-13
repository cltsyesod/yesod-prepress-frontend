import type { Project, AnalysisProblem, ActivityEvent } from '@/types'
import { analysisService } from '@/services/analysisService'
import { activityService } from '@/services/activityService'
import { versionService } from '@/services/versionService'

export interface DashboardFilters {
  period: string
  client: string
  responsible: string
  profile: string
  status: string
}

export const DEFAULT_DASHBOARD_FILTERS: DashboardFilters = {
  period: 'all',
  client: 'all',
  responsible: 'all',
  profile: 'all',
  status: 'all',
}

export interface OperationalMetrics {
  awaitingAnalysis: number
  inAnalysis: number
  needsRevision: number
  awaitingApproval: number
  criticalPendingProblems: number
  upcomingOrOverdueDeadlines: number
}

export interface ManagerialMetrics {
  totalProjects: number
  completedProjects: number
  approvalRate: number
  analyzedFiles: number
  problemsFound: number
  problemsFixed: number
  avgProblemsPerProject: number
}

export interface ChartData {
  projectsByStatus: { name: string; value: number; color: string }[]
  problemsByCriticality: { name: string; value: number; color: string }[]
  recurringProblems: { name: string; value: number }[]
  projectsByProfile: { name: string; value: number }[]
}

export interface ActivityWithProject extends ActivityEvent {
  projectName: string
}

export interface DashboardData {
  projects: Project[]
  operationalMetrics: OperationalMetrics
  managerialMetrics: ManagerialMetrics
  attentionProjects: Project[]
  recentActivities: ActivityWithProject[]
  chartData: ChartData
}

const STATUS_COLORS: Record<string, string> = {
  active: '#3b82f6',
  completed: '#22c55e',
  paused: '#f59e0b',
  archived: '#64748b',
  pending_analysis: '#f59e0b',
  pending_approval: '#a855f7',
  approved: '#22c55e',
  failed: '#ef4444',
  draft: '#64748b',
  analyzing: '#3b82f6',
  needs_review: '#f97316',
}
const STATUS_LABELS: Record<string, string> = {
  active: 'Ativo',
  completed: 'Concluído',
  paused: 'Pausado',
  archived: 'Arquivado',
  pending_analysis: 'Aguard. Análise',
  pending_approval: 'Aguard. Aprovação',
  approved: 'Aprovado',
  failed: 'Falhou',
  draft: 'Rascunho',
  analyzing: 'Analisando',
  needs_review: 'Requer Revisão',
}
const SEV_COLORS: Record<string, string> = {
  critical: '#ef4444',
  warning: '#f59e0b',
  info: '#3b82f6',
  none: '#64748b',
}
const SEV_LABELS: Record<string, string> = {
  critical: 'Crítico',
  warning: 'Atenção',
  info: 'Informativo',
  none: 'Sem issues',
}

function filterProjects(projects: Project[], f: DashboardFilters): Project[] {
  return projects.filter((p) => {
    if (f.status !== 'all' && p.status !== f.status) return false
    if (f.client !== 'all' && p.clientId !== f.client) return false
    if (f.responsible !== 'all' && p.responsibleId !== f.responsible) return false
    if (f.profile !== 'all' && p.productionProfile !== f.profile) return false
    if (f.period !== 'all') {
      const days: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 }
      const cutoff = Date.now() - (days[f.period] || 0) * 86400000
      if (new Date(p.createdAt).getTime() < cutoff) return false
    }
    return true
  })
}

function mkCount<T>(arr: T[], key: (t: T) => string): [string, number][] {
  const m = new Map<string, number>()
  arr.forEach((x) => m.set(key(x), (m.get(key(x)) || 0) + 1))
  return [...m.entries()]
}

export function computeDashboardData(projects: Project[], f: DashboardFilters): DashboardData {
  const filtered = filterProjects(projects, f)
  const probsByProj = new Map<string, AnalysisProblem[]>()
  let allProblems: AnalysisProblem[] = []
  for (const p of filtered) {
    const probs = analysisService.getProblems(p)
    probsByProj.set(p.id, probs)
    allProblems = allProblems.concat(probs)
  }
  const now = Date.now()
  const total = filtered.length
  const approved = filtered.filter((p) => p.status === 'approved').length

  const operationalMetrics: OperationalMetrics = {
    awaitingAnalysis: filtered.filter((p) => p.status === 'pending_analysis').length,
    inAnalysis: filtered.filter((p) => p.status === 'analyzing').length,
    needsRevision: filtered.filter((p) => p.status === 'needs_review').length,
    awaitingApproval: filtered.filter((p) => p.status === 'pending_approval').length,
    criticalPendingProblems: allProblems.filter(
      (p) => p.severity === 'critical' && p.status === 'pending',
    ).length,
    upcomingOrOverdueDeadlines: filtered.filter(
      (p) => new Date(p.deadline).getTime() <= now + 7 * 86400000,
    ).length,
  }

  const managerialMetrics: ManagerialMetrics = {
    totalProjects: total,
    completedProjects: filtered.filter((p) => p.status === 'completed').length,
    approvalRate: total > 0 ? Math.round((approved / total) * 1000) / 10 : 0,
    analyzedFiles: filtered.filter((p) => !['draft', 'pending_analysis'].includes(p.status)).length,
    problemsFound: allProblems.length,
    problemsFixed: allProblems.filter((p) => p.status !== 'pending').length,
    avgProblemsPerProject: total > 0 ? Math.round((allProblems.length / total) * 100) / 100 : 0,
  }

  const attentionProjects = filtered.filter((p) => {
    if (
      p.severity === 'critical' ||
      ['failed', 'needs_review', 'pending_approval'].includes(p.status)
    )
      return true
    if (new Date(p.deadline).getTime() < now + 3 * 86400000) return true
    const probs = probsByProj.get(p.id) || []
    if (probs.some((pr) => pr.status === 'pending')) return true
    if (versionService.getVersions(p.id, p).some((v) => v.status === 'aguardando_aprovacao'))
      return true
    return false
  })

  const recentActivities = filtered
    .flatMap((p) =>
      activityService.listActivities(p.id, p).map((a) => ({ ...a, projectName: p.name })),
    )
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 20)

  const projectsByStatus = mkCount(filtered, (p) => p.status).map(([s, v]) => ({
    name: STATUS_LABELS[s] || s,
    value: v,
    color: STATUS_COLORS[s] || '#64748b',
  }))
  const problemsByCriticality = mkCount(allProblems, (p) => p.severity).map(([s, v]) => ({
    name: SEV_LABELS[s] || s,
    value: v,
    color: SEV_COLORS[s] || '#64748b',
  }))
  const recurringProblems = mkCount(allProblems, (p) => p.category)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5)
  const projectsByProfile = mkCount(filtered, (p) => p.productionProfile).map(([name, value]) => ({
    name,
    value,
  }))

  return {
    projects: filtered,
    operationalMetrics,
    managerialMetrics,
    attentionProjects,
    recentActivities,
    chartData: { projectsByStatus, problemsByCriticality, recurringProblems, projectsByProfile },
  }
}
