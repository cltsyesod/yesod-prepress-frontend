import type { AnalysisProblem, Project, ActivityEvent } from '@/types'
import { analysisService } from '@/services/analysisService'
import { versionService } from '@/services/versionService'
import { activityService } from '@/services/activityService'
import { projectService } from '@/services/projectService'

export type ProjectClassification =
  | 'Aprovado'
  | 'Aprovado com ressalvas'
  | 'Requer revisão'
  | 'Reprovado tecnicamente'

export interface ReportListItem {
  id: string
  projectId: string
  projectName: string
  clientId: string
  clientName: string
  orderNumber: string
  productionProfile: string
  filename: string
  currentVersionNumber?: number
  responsibleId: string
  responsibleName: string
  classification: ProjectClassification
  criticalCount: number
  attentionCount: number
  problemCount: number
  status: string
  analysisDate: string
  createdAt: string
}

export interface ReportFilters {
  search: string
  period: string
  client: string
  responsible: string
  profile: string
  result: string
  status: string
  severity: string
}

export const DEFAULT_REPORT_FILTERS: ReportFilters = {
  search: '',
  period: 'all',
  client: 'all',
  responsible: 'all',
  profile: 'all',
  result: 'all',
  status: 'all',
  severity: 'all',
}

export interface ReportIndicators {
  total: number
  approved: number
  approvedWithReservations: number
  requiresRevision: number
  technicallyRejected: number
}

export function calculateClassification(problems: AnalysisProblem[]): ProjectClassification {
  if (problems.length === 0) return 'Aprovado'
  if (problems.some((p) => p.severity === 'critical' && p.status === 'pending'))
    return 'Reprovado tecnicamente'
  if (problems.some((p) => p.status === 'rejected' || p.status === 'ignored'))
    return 'Requer revisão'
  if (
    problems.some((p) => p.status === 'pending') ||
    problems.some((p) => p.status === 'approved' && p.justification)
  )
    return 'Aprovado com ressalvas'
  return 'Aprovado'
}

function buildReport(project: Project): ReportListItem | null {
  if (['draft', 'pending_analysis'].includes(project.status)) return null
  const problems = analysisService.getProblems(project)
  const versions = versionService.getVersions(project.id, project)
  const cv = versions.find((v) => v.isCurrent) || versions[versions.length - 1]
  const activities = activityService.listActivities(project.id, project)
  const analysisDate = activities.find((a) => a.type === 'analysis')?.timestamp || project.updatedAt
  return {
    id: `rpt-${project.id}`,
    projectId: project.id,
    projectName: project.name,
    clientId: project.clientId,
    clientName: project.clientName,
    orderNumber: project.orderNumber,
    productionProfile: project.productionProfile,
    filename: project.filename,
    currentVersionNumber: cv?.versionNumber,
    responsibleId: project.responsibleId,
    responsibleName: project.responsibleName,
    classification: calculateClassification(problems),
    criticalCount: problems.filter((p) => p.severity === 'critical' && p.status === 'pending')
      .length,
    attentionCount: problems.filter((p) => p.status === 'pending').length,
    problemCount: problems.length,
    status: project.status,
    analysisDate,
    createdAt: project.createdAt,
  }
}

function matchesFilters(r: ReportListItem, f: ReportFilters): boolean {
  if (f.search.trim()) {
    const q = f.search.toLowerCase()
    if (
      !`${r.projectName} ${r.clientName} ${r.orderNumber} ${r.filename}`.toLowerCase().includes(q)
    )
      return false
  }
  if (f.client !== 'all' && r.clientId !== f.client) return false
  if (f.responsible !== 'all' && r.responsibleId !== f.responsible) return false
  if (f.profile !== 'all' && r.productionProfile !== f.profile) return false
  if (f.result !== 'all' && r.classification !== f.result) return false
  if (f.status !== 'all' && r.status !== f.status) return false
  if (f.severity !== 'all') {
    if (f.severity === 'critical' && r.criticalCount === 0) return false
    if (f.severity === 'warning' && r.criticalCount > 0) return false
    if (f.severity === 'none' && r.problemCount > 0) return false
  }
  if (f.period !== 'all') {
    const days: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 }
    if (new Date(r.analysisDate).getTime() < Date.now() - (days[f.period] || 0) * 86400000)
      return false
  }
  return true
}

export const reportService = {
  async listReports(): Promise<ReportListItem[]> {
    const projects = await projectService.listProjects()
    return projects
      .map(buildReport)
      .filter((r): r is ReportListItem => r !== null)
      .sort((a, b) => new Date(b.analysisDate).getTime() - new Date(a.analysisDate).getTime())
  },
  filterReports(reports: ReportListItem[], f: ReportFilters): ReportListItem[] {
    return reports.filter((r) => matchesFilters(r, f))
  },
  getIndicators(reports: ReportListItem[]): ReportIndicators {
    return {
      total: reports.length,
      approved: reports.filter((r) => r.classification === 'Aprovado').length,
      approvedWithReservations: reports.filter((r) => r.classification === 'Aprovado com ressalvas')
        .length,
      requiresRevision: reports.filter((r) => r.classification === 'Requer revisão').length,
      technicallyRejected: reports.filter((r) => r.classification === 'Reprovado tecnicamente')
        .length,
    }
  },
}
