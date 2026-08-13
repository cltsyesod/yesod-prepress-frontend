import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { FolderX, AlertCircle, RotateCcw } from 'lucide-react'
import { ReportTab } from '@/components/projects/ReportTab'
import { projectService } from '@/services/projectService'
import type { Project } from '@/types'

export default function ProjectReportPage() {
  const { id } = useParams()
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError(false)
      try {
        const p = await projectService.getProject(id || '')
        setProject(p)
      } catch {
        setError(true)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id])

  if (loading) {
    return (
      <div>
        <PageHeader
          title="Carregando..."
          breadcrumbs={[
            { label: 'Home', href: '/dashboard' },
            { label: 'Projetos', href: '/projects' },
            { label: '...' },
          ]}
        />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    )
  }

  if (error || !project) {
    return (
      <div>
        <PageHeader
          title={error ? 'Erro' : 'Projeto não encontrado'}
          breadcrumbs={[
            { label: 'Home', href: '/dashboard' },
            { label: 'Projetos', href: '/projects' },
          ]}
        />
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center bg-[#182233] border border-[#2A374A] rounded-lg">
          <div className="p-3 bg-red-500/10 rounded-full mb-3 text-red-400">
            {error ? <AlertCircle className="h-8 w-8" /> : <FolderX className="h-8 w-8" />}
          </div>
          <h3 className="text-base font-semibold text-slate-200 mb-1">
            {error ? 'Erro ao carregar' : 'Projeto não encontrado'}
          </h3>
          <p className="text-sm text-slate-400 max-w-sm mb-4">
            {error
              ? 'Ocorreu um erro ao carregar os dados do projeto.'
              : 'O projeto solicitado não existe ou foi removido.'}
          </p>
          {error ? (
            <Button
              onClick={() => window.location.reload()}
              variant="outline"
              className="text-xs gap-1.5"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Tentar novamente
            </Button>
          ) : (
            <Link to="/projects">
              <Button className="bg-blue-600 hover:bg-blue-700 text-white text-xs">
                Voltar para projetos
              </Button>
            </Link>
          )}
        </div>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title={`Relatório — ${project.name}`}
        breadcrumbs={[
          { label: 'Home', href: '/dashboard' },
          { label: 'Projetos', href: '/projects' },
          { label: project.name, href: `/projects/${project.id}` },
          { label: 'Relatório' },
        ]}
      />
      <ReportTab project={project} />
    </div>
  )
}
