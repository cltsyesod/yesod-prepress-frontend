import type {
  Project,
  ProjectVersion,
  VersionStatus,
  VersionHistoryEntry,
  AddVersionData,
} from '@/types'

const STORAGE_KEY = 'yesod-versions'

function getStored(): Record<string, ProjectVersion[]> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored ? JSON.parse(stored) : {}
  } catch {
    return {}
  }
}

function saveStored(data: Record<string, ProjectVersion[]>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    /* noop */
  }
}

function makeHistoryEntry(
  status: VersionStatus,
  note: string,
  userId: string,
  ts: string,
): VersionHistoryEntry {
  return {
    id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    status,
    note,
    timestamp: ts,
    userId,
  }
}

function generateInitialVersions(project: Project): ProjectVersion[] {
  const versions: ProjectVersion[] = []
  const count = project.issueCount > 0 ? 2 : 1
  const baseTime = new Date(project.createdAt).getTime()

  for (let i = 1; i <= count; i++) {
    const isLast = i === count
    const ts = new Date(baseTime + (i - 1) * 86400000).toISOString()
    const ts2 = new Date(baseTime + i * 86400000).toISOString()
    const critical =
      i === 1
        ? Math.max(1, Math.floor(project.issueCount * 0.4))
        : Math.max(0, Math.floor(project.issueCount * 0.2))
    const warning =
      i === 1
        ? Math.max(1, Math.floor(project.issueCount * 0.3))
        : Math.max(0, Math.floor(project.issueCount * 0.15))
    const approved = i === 1 ? 0 : Math.floor(project.issueCount * 0.3)
    const pending = Math.max(0, project.issueCount - approved)
    const lastStatus: VersionStatus = project.issueCount > 0 ? 'requer_revisao' : 'aprovada'

    const history: VersionHistoryEntry[] = [
      makeHistoryEntry('em_analise', 'Versão adicionada', project.responsibleId, ts),
    ]
    if (isLast) {
      history.push(
        makeHistoryEntry(
          lastStatus,
          project.issueCount > 0 ? 'Análise identificou problemas' : 'Arquivo aprovado na análise',
          project.responsibleId,
          ts2,
        ),
      )
    } else {
      history.push(
        makeHistoryEntry('substituida', 'Substituída por nova versão', project.responsibleId, ts2),
      )
    }

    versions.push({
      id: `ver-${project.id}-${i}`,
      projectId: project.id,
      versionNumber: i,
      fileName: i === 1 ? project.filename : project.filename.replace(/(\.[^.]+)$/, `_v${i}$1`),
      format: project.fileType,
      size: project.fileSize + (i - 1) * 50000,
      createdAt: ts,
      responsibleId: project.responsibleId,
      responsibleName: project.responsibleName,
      origin: i === 1 ? 'cliente' : 'revisao',
      comment:
        i === 1
          ? 'Versão inicial enviada pelo cliente'
          : 'Revisão após correções identificadas na análise técnica',
      status: isLast ? lastStatus : 'substituida',
      isCurrent: isLast,
      problemSummary: { critical, warning, info: i === 1 ? 2 : 1, approved, pending },
      history,
      changes:
        i === 1
          ? []
          : [
              'Correção de resolução de imagem na página 3',
              'Conversão de objetos RGB para CMYK',
              'Adição de marcas de corte e sangria',
            ],
    })
  }
  return versions
}

export const versionService = {
  getVersions(projectId: string, project?: Project): ProjectVersion[] {
    const stored = getStored()
    if (stored[projectId]) return stored[projectId]
    if (project) {
      const generated = generateInitialVersions(project)
      this.saveVersions(projectId, generated)
      return generated
    }
    return []
  },

  saveVersions(projectId: string, versions: ProjectVersion[]): void {
    const stored = getStored()
    stored[projectId] = versions
    saveStored(stored)
  },

  addVersion(projectId: string, data: AddVersionData, project: Project): ProjectVersion {
    const versions = this.getVersions(projectId, project)
    const nextNumber =
      versions.length > 0 ? Math.max(...versions.map((v) => v.versionNumber)) + 1 : 1
    const now = new Date().toISOString()
    const newVersion: ProjectVersion = {
      id: `ver-${projectId}-${nextNumber}`,
      projectId,
      versionNumber: nextNumber,
      fileName: data.fileName,
      format: data.format,
      size: data.size,
      createdAt: now,
      responsibleId: data.responsibleId,
      responsibleName: data.responsibleName,
      origin: 'revisao',
      comment: data.comment,
      status: 'em_analise',
      isCurrent: false,
      problemSummary: { critical: 0, warning: 0, info: 0, approved: 0, pending: 0 },
      history: [makeHistoryEntry('em_analise', 'Versão adicionada', data.responsibleId, now)],
      changes: [
        `Novo arquivo: ${data.fileName}`,
        ...(data.comment ? [`Comentário: ${data.comment}`] : []),
      ],
    }
    const updated = [...versions, newVersion]
    this.saveVersions(projectId, updated)
    return newVersion
  },

  setCurrentVersion(projectId: string, versionId: string): ProjectVersion[] {
    const versions = getStored()[projectId] || []
    const updated = versions.map((v) => {
      if (v.id === versionId) return { ...v, isCurrent: true }
      if (v.isCurrent) return { ...v, isCurrent: false, status: 'substituida' as VersionStatus }
      return v
    })
    this.saveVersions(projectId, updated)
    return updated
  },

  getVersion(projectId: string, versionId: string): ProjectVersion | null {
    const versions = getStored()[projectId] || []
    return versions.find((v) => v.id === versionId) || null
  },
}
