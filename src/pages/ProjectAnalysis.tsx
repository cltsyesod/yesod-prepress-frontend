import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { PageHeader } from '@/components/PageHeader'
import { AnalysisTab } from '@/components/projects/AnalysisTab'
import { projectService } from '@/services/projectService'
import { projectFilesService, type ProjectFileRecord } from '@/services/projectFilesService'
import { useRealtime } from '@/hooks/use-realtime'
import { Loader2, FileX } from 'lucide-react'
import type { Project } from '@/types'

export default function ProjectAnalysisPage() {
  const { id } = useParams()
  const [project, setProject] = useState<Project | null>(null)
  const [file, setFile] = useState<ProjectFileRecord | null>(null)
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async () => {
    if (!id) {
      setLoading(false)
      return
    }
    try {
      const p = await projectService.getProject(id)
      setProject(p ?? null)
      try {
        const files = await projectFilesService.listFiles(id)
        const primary =
          files.find((f) => f.is_primary && f.status !== 'removed') || files[0] || null
        setFile(primary)
      } catch {
        setFile(null)
      }
    } catch {
      setProject(null)
    }
    setLoading(false)
  }, [id])

  useEffect(() => {
    loadData()
  }, [loadData])

  useRealtime('project_files', (e) => {
    const recordProject = (e.record as Record<string, unknown>)?.project
    if (typeof recordProject === 'string' && recordProject !== id) return
    loadData()
  })

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 text-slate-400 animate-spin" />
      </div>
    )
  }

  if (!project) {
    return (
      <div>
        <PageHeader
          title="Análise Técnica"
          breadcrumbs={[
            { label: 'Home', href: '/dashboard' },
            { label: 'Projetos', href: '/projects' },
            { label: 'Análise' },
          ]}
        />
        <div className="flex flex-col items-center justify-center py-16 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg">
          <FileX className="h-10 w-10 text-slate-400 mb-2" />
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
            Projeto não encontrado
          </h3>
        </div>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Análise Técnica"
        breadcrumbs={[
          { label: 'Home', href: '/dashboard' },
          { label: 'Projetos', href: '/projects' },
          { label: project.name, href: `/projects/${project.id}` },
          { label: 'Análise' },
        ]}
      />
      <AnalysisTab project={project} file={file} />
    </div>
  )
}
