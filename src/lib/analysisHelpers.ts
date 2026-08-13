import type { AnalysisProblem, ProblemStatus } from '@/types'
import type { QuickFilter } from '@/components/projects/analysis/QuickFilters'

export interface AnalysisCounts {
  total: number
  critical: number
  warning: number
  info: number
  pending: number
  fixed: number
  rejected: number
  ignored: number
  corrected: number
  autoCorrectable: number
}

export const PROBLEM_STATUS_LABELS: Record<ProblemStatus, string> = {
  pending: 'Pendente',
  approved: 'Aprovado',
  rejected: 'Rejeitado',
  ignored: 'Ignorado',
  corrected: 'Corrigido',
}

export function calculateCounts(problems: AnalysisProblem[]): AnalysisCounts {
  return {
    total: problems.length,
    critical: problems.filter((p) => p.severity === 'critical').length,
    warning: problems.filter((p) => p.severity === 'warning').length,
    info: problems.filter((p) => p.severity === 'info').length,
    pending: problems.filter((p) => p.status === 'pending').length,
    fixed: problems.filter((p) => p.status === 'approved').length,
    rejected: problems.filter((p) => p.status === 'rejected').length,
    ignored: problems.filter((p) => p.status === 'ignored').length,
    corrected: problems.filter((p) => p.status === 'corrected').length,
    autoCorrectable: problems.filter((p) => p.autoFixable).length,
  }
}

export function calculateFilterCounts(
  problems: AnalysisProblem[],
  counts: AnalysisCounts,
  currentPage: number,
): Record<QuickFilter, number> {
  return {
    all: problems.length,
    critical: counts.critical,
    pending: counts.pending,
    fixed: counts.fixed,
    rejected: counts.rejected,
    ignored: counts.ignored,
    corrected: counts.corrected,
    autoFixable: counts.autoCorrectable,
    currentPage: problems.filter((p) => p.page === currentPage).length,
  }
}

export function filterProblems(
  problems: AnalysisProblem[],
  search: string,
  activeFilter: QuickFilter,
  category: string,
  currentPage: number,
): AnalysisProblem[] {
  return problems.filter((p) => {
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false
    if (activeFilter === 'critical' && p.severity !== 'critical') return false
    if (activeFilter === 'pending' && p.status !== 'pending') return false
    if (activeFilter === 'fixed' && p.status !== 'approved') return false
    if (activeFilter === 'rejected' && p.status !== 'rejected') return false
    if (activeFilter === 'ignored' && p.status !== 'ignored') return false
    if (activeFilter === 'corrected' && p.status !== 'corrected') return false
    if (activeFilter === 'autoFixable' && !p.autoFixable) return false
    if (activeFilter === 'currentPage' && p.page !== currentPage) return false
    if (category !== 'all' && p.category !== category) return false
    return true
  })
}
