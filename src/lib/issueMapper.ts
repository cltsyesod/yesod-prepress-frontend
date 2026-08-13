import type { AnalysisIssue } from '@/services/analysisJobsService'
import type { AnalysisProblem, ProblemStatus, Severity } from '@/types'

function mapSeverity(severity: string): Severity {
  if (severity === 'critical') return 'critical'
  if (severity === 'warning') return 'warning'
  return 'info'
}

function mapStatus(status: string): ProblemStatus {
  if (['pending', 'approved', 'rejected', 'ignored', 'corrected'].includes(status)) {
    return status as ProblemStatus
  }
  return 'pending'
}

function parseCoordinates(coords: string): { x: number; y: number; w: number; h: number } {
  if (!coords) return { x: 0, y: 0, w: 0, h: 0 }
  try {
    const parsed = JSON.parse(coords)
    if (parsed && typeof parsed.x === 'number' && typeof parsed.y === 'number') {
      return { x: parsed.x, y: parsed.y, w: parsed.w || 10, h: parsed.h || 10 }
    }
  } catch {
    /* noop */
  }
  return { x: 0, y: 0, w: 0, h: 0 }
}

export function mapIssueToProblem(issue: AnalysisIssue): AnalysisProblem {
  const marking = parseCoordinates(issue.coordinates)
  return {
    id: issue.id,
    name: issue.title || issue.rule_code || 'Problema detectado',
    severity: mapSeverity(issue.severity),
    category: issue.category || 'Geral',
    page: issue.page || 1,
    location: `Página ${issue.page || 1}`,
    status: mapStatus(issue.status),
    description: issue.description || '',
    technicalRule: issue.rule_code || '',
    foundValue: issue.found_value || '—',
    recommendedValue: issue.expected_value || '—',
    correctionSuggestion: issue.recommendation || '',
    confidence: issue.confidence || 0,
    justification: issue.decision_reason || undefined,
    autoFixable: issue.can_auto_correct || false,
    marking,
  }
}
