import { useEffect, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { PageHeader } from '@/components/PageHeader'
import { ProjectDetailHeader } from '@/components/projects/ProjectDetailHeader'
import { OverviewTab } from '@/components/projects/OverviewTab'
import { FilesTab } from '@/components/projects/FilesTab'
import { ActivitiesTab } from '@/components/projects/ActivitiesTab'
import { VersionsTab } from '@/components/projects/VersionsTab'
import { AnalysisTab } from '@/components/projects/AnalysisTab'
import { ReportTab } from '@/components/projects/ReportTab'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { FolderX, AlertCircle, RotateCcw } from 'lucide-react'
import { projectService } from '@/services/projectService'
import type { Project } from '@/types'

export default function ProjectDetailPage() {
  const { id } = useParams()
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const loadProject = useCallback(async () => {
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
  }, [id])

  useEffect(() => {
    loadProject()
  }, [loadProject])

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
        <div className="space-y-4">
          <Skeleton className="h-24 w-full rounded-lg" />
          <Skeleton className="h-10 w-full rounded-lg" />
          <Skeleton className="h-64 w-full rounded-lg" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div>
        <PageHeader
          title="Erro"
          breadcrumbs={[
            { label: 'Home', href: '/dashboard' },
            { label: 'Projetos', href: '/projects' },
          ]}
        />
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center bg-white border border-slate-200 rounded-lg">
          <div className="p-3 bg-red-50 rounded-full mb-3 text-red-500">
            <AlertCircle className="h-8 w-8" />
          </div>
          <h3 className="text-base font-semibold text-slate-800 mb-1">Erro ao carregar projeto</h3>
          <p className="text-sm text-slate-500 max-w-sm mb-4">
            Ocorreu um erro ao carregar os dados do projeto.
          </p>
          <Button onClick={loadProject} variant="outline" className="text-xs gap-1.5">
            <RotateCcw className="h-3.5 w-3.5" /> Tentar novamente
          </Button>
        </div>
      </div>
    )
  }

  if (!project) {
    return (
      <div>
        <PageHeader
          title="Projeto não encontrado"
          breadcrumbs={[
            { label: 'Home', href: '/dashboard' },
            { label: 'Projetos', href: '/projects' },
          ]}
        />
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center bg-white border border-slate-200 rounded-lg">
          <div className="p-3 bg-slate-100 rounded-full mb-3 text-slate-500">
            <FolderX className="h-8 w-8" />
          </div>
          <h3 className="text-base font-semibold text-slate-800 mb-1">Projeto não encontrado</h3>
          <p className="text-sm text-slate-500 max-w-sm mb-4">
            O projeto solicitado não existe ou foi removido.
          </p>
          <Link to="/projects">
            <Button className="bg-blue-600 hover:bg-blue-700 text-white text-xs">
              Voltar para projetos
            </Button>
          </Link>
        </div>
      </div>
    )
  }

  const analysisSummary =
    project.issueCount > 0
      ? `Arquivo analisado com ${project.issueCount} problema(s) encontrado(s). Verifique a aba de análise técnica para detalhes.`
      : 'Arquivo analisado sem problemas. Projeto pronto para a próxima etapa.'

  return (
    <div>
      <ProjectDetailHeader project={project} />
      <Tabs defaultValue="overview">
        <TabsList className="mb-4">
          <TabsTrigger value="overview" className="text-xs">
            Visão Geral
          </TabsTrigger>
          <TabsTrigger value="analysis" className="text-xs">
            Análise Técnica
          </TabsTrigger>
          <TabsTrigger value="files" className="text-xs">
            Arquivos
          </TabsTrigger>
          <TabsTrigger value="versions" className="text-xs">
            Versões
          </TabsTrigger>
          <TabsTrigger value="activities" className="text-xs">
            Atividades
          </TabsTrigger>
          <TabsTrigger value="report" className="text-xs">
            Relatório
          </TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <OverviewTab project={project} analysisSummary={analysisSummary} />
        </TabsContent>
        <TabsContent value="analysis">
          <AnalysisTab project={project} />
        </TabsContent>
        <TabsContent value="files">
          <FilesTab project={project} />
        </TabsContent>
        <TabsContent value="versions">
          <VersionsTab project={project} />
        </TabsContent>
        <TabsContent value="activities">
          <ActivitiesTab project={project} />
        </TabsContent>
        <TabsContent value="report">
          <ReportTab project={project} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
