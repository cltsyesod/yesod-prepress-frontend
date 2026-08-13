import type { ActivityEvent, Project } from '@/types'

const STORAGE_KEY = 'yesod-activities'

function getStored(): Record<string, ActivityEvent[]> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored ? JSON.parse(stored) : {}
  } catch {
    return {}
  }
}

function saveStored(data: Record<string, ActivityEvent[]>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    /* noop */
  }
}

const STATUS_LABELS: Record<string, string> = {
  active: 'Ativo',
  completed: 'Concluído',
  paused: 'Pausado',
  archived: 'Arquivado',
  pending_analysis: 'Aguardando Análise',
  pending_approval: 'Aguardando Aprovação',
  approved: 'Aprovado',
  failed: 'Falhou',
  draft: 'Rascunho',
  analyzing: 'Analisando',
  needs_review: 'Requer Revisão',
}

function generateFromProject(project: Project): ActivityEvent[] {
  const events: ActivityEvent[] = []
  const baseTime = new Date(project.createdAt).getTime()
  let n = 0

  const mk = (type: ActivityEvent['type'], message: string, offsetMin: number): ActivityEvent => ({
    id: `act-${project.id}-${n++}`,
    type,
    projectId: project.id,
    userId: project.responsibleId,
    message,
    timestamp: new Date(baseTime + offsetMin * 60000).toISOString(),
  })

  events.push(mk('upload', `Projeto criado por ${project.responsibleName}`, 0))

  if (project.productionProfile) {
    events.push(
      mk('status_change', `Perfil de produção selecionado: ${project.productionProfile}`, 1),
    )
  }

  if (project.filename) {
    events.push(mk('upload', `Arquivo enviado: ${project.filename}`, 2))
  }

  const hasAnalysis = !['draft', 'pending_analysis'].includes(project.status)
  if (hasAnalysis) {
    events.push(mk('analysis', 'Análise técnica iniciada', 3))
    events.push(
      mk(
        'analysis',
        project.issueCount > 0
          ? `Análise concluída com ${project.issueCount} problema(s) encontrado(s)`
          : 'Análise concluída sem problemas',
        5,
      ),
    )
  }

  if (
    ['approved', 'completed', 'pending_approval', 'failed', 'needs_review'].includes(project.status)
  ) {
    events.push(
      mk(
        'status_change',
        `Status alterado para: ${STATUS_LABELS[project.status] || project.status}`,
        6,
      ),
    )
  }

  return events
}

export const activityService = {
  listActivities(projectId: string, project?: Project): ActivityEvent[] {
    const stored = getStored()
    if (stored[projectId]) {
      return [...stored[projectId]].sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      )
    }
    if (project) {
      const generated = generateFromProject(project)
      this.saveActivities(projectId, generated)
      return generated.sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      )
    }
    return []
  },

  saveActivities(projectId: string, activities: ActivityEvent[]): void {
    const stored = getStored()
    stored[projectId] = activities
    saveStored(stored)
  },

  addActivity(projectId: string, activity: ActivityEvent): void {
    const stored = getStored()
    if (!stored[projectId]) {
      stored[projectId] = []
    }
    stored[projectId].unshift(activity)
    saveStored(stored)
  },
}
