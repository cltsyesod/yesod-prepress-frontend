import type { AnalysisProblem, Project, ProblemStatus } from '@/types'
import { getTemplatesForProfile } from '@/services/analysisTemplates'

const STORAGE_KEY = 'yesod-analysis-problems'

interface StoredData {
  [projectId: string]: AnalysisProblem[]
}

function getStored(): StoredData {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored ? (JSON.parse(stored) as StoredData) : {}
  } catch {
    return {}
  }
}

function saveStored(data: StoredData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    /* noop */
  }
}

function generateProblems(project: Project): AnalysisProblem[] {
  const templates = getTemplatesForProfile(project.productionProfile)
  const locations = ['Superior Esquerda', 'Centro', 'Inferior Direita', 'Lateral Direita']
  return templates.map((t, i) => ({
    id: `prob-${project.id}-${i}`,
    name: t.name,
    severity: t.severity,
    category: t.category,
    page: (i % 3) + 1,
    location: `Página ${(i % 3) + 1}, ${locations[i % locations.length]}`,
    status: 'pending' as ProblemStatus,
    description: t.description,
    technicalRule: t.technicalRule,
    foundValue: t.foundValue,
    recommendedValue: t.recommendedValue,
    correctionSuggestion: t.correctionSuggestion,
    confidence: t.confidence,
    autoFixable: t.autoFixable,
    marking: {
      x: 10 + ((i * 17) % 65),
      y: 12 + ((i * 23) % 55),
      w: 12 + ((i * 3) % 8),
      h: 8 + ((i * 2) % 6),
    },
  }))
}

export const analysisService = {
  getProblems(project: Project): AnalysisProblem[] {
    const stored = getStored()
    if (stored[project.id]) return stored[project.id]
    if (project.issueCount === 0) return []
    const problems = generateProblems(project)
    this.saveProblems(project.id, problems)
    return problems
  },

  saveProblems(projectId: string, problems: AnalysisProblem[]): void {
    const stored = getStored()
    stored[projectId] = problems
    saveStored(stored)
  },

  updateProblemStatus(
    projectId: string,
    problemId: string,
    status: ProblemStatus,
    justification?: string,
  ): AnalysisProblem[] {
    const stored = getStored()
    const problems = stored[projectId] || []
    const updated = problems.map((p) =>
      p.id === problemId ? { ...p, status, justification: justification || p.justification } : p,
    )
    stored[projectId] = updated
    saveStored(stored)
    return updated
  },
}
