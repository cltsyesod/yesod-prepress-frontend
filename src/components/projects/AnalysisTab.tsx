import { useState, useMemo } from 'react'
import { Loader2, CheckCircle2, FileX, AlertCircle, Image as ImageIcon } from 'lucide-react'
import { ProblemList } from './analysis/ProblemList'
import { QuickFilters, type QuickFilter } from './analysis/QuickFilters'
import { AnalysisHeader } from './analysis/AnalysisHeader'
import { NoAnalysisState } from './analysis/NoAnalysisState'
import { JobStatusBanner } from './analysis/JobStatusBanner'
import { useAnalysisJob } from '@/hooks/use-analysis-job'
import { mapIssueToProblem } from '@/lib/issueMapper'
import { calculateCounts, calculateFilterCounts, filterProblems } from '@/lib/analysisHelpers'
import { activityService } from '@/services/activityService'
import type { Project, ProblemStatus, ActivityEvent } from '@/types'
import type { ProjectFileRecord } from '@/services/projectFilesService'

interface AnalysisTabProps {
  project: Project
  file: ProjectFileRecord | null
}

const FINAL_STATES = ['completed', 'completed_with_warnings', 'failed', 'cancelled']

export function AnalysisTab({ project, file }: AnalysisTabProps) {
  const fileId = file?.id ?? null
  const {
    job,
    issues,
    loading,
    starting,
    error,
    actionError,
    startAnalysis,
    cancelAnalysis,
    retryAnalysis,
    updateIssueStatus,
  } = useAnalysisJob(fileId)

  const [search, setSearch] = useState('')
  const [activeFilter, setActiveFilter] = useState<QuickFilter>('all')
  const [category, setCategory] = useState('all')
  const [selectedProblemId, setSelectedProblemId] = useState<string | null>(null)
  const [viewRequest, setViewRequest] = useState<{ page: number; key: number } | null>(null)
  const [currentPage, setCurrentPage] = useState(1)

  const problems = useMemo(() => issues.map(mapIssueToProblem), [issues])
  const counts = useMemo(() => calculateCounts(problems), [problems])
  const filterCounts = useMemo(
    () => calculateFilterCounts(problems, counts, currentPage),
    [problems, counts, currentPage],
  )
  const categories = useMemo(() => [...new Set(problems.map((p) => p.category))], [problems])
  const filteredProblems = useMemo(
    () => filterProblems(problems, search, activeFilter, category, currentPage),
    [problems, search, activeFilter, category, currentPage],
  )

  const sortedProblems = useMemo(() => {
    const severityOrder: Record<string, number> = { critical: 0, warning: 1, info: 2, none: 3 }
    return [...filteredProblems].sort((a, b) => {
      const sa = severityOrder[a.severity] ?? 3
      const sb = severityOrder[b.severity] ?? 3
      if (sa !== sb) return sa - sb
      if (a.page !== b.page) return a.page - b.page
      return a.name.localeCompare(b.name)
    })
  }, [filteredProblems])

  const hasProfile = !!(project.profileId || project.productionProfile)

  const handleStart = () => {
    if (!hasProfile) return
    const profileId = project.profileId || project.productionProfile!
    startAnalysis(profileId)
    const event: ActivityEvent = {
      id: `act-${project.id}-${Date.now()}`,
      type: 'analysis',
      projectId: project.id,
      userId: project.responsibleId,
      message: 'Análise técnica iniciada',
      timestamp: new Date().toISOString(),
    }
    activityService.addActivity(project.id, event)
  }

  const handleAction = async (problemId: string, status: ProblemStatus, justification?: string) => {
    try {
      await updateIssueStatus(problemId, status, justification)
      const problem = problems.find((p) => p.id === problemId)
      if (problem) {
        const labels: Record<ProblemStatus, string> = {
          pending: 'Pendente',
          approved: 'Aprovado',
          rejected: 'Rejeitado',
          ignored: 'Ignorado',
          corrected: 'Corrigido',
        }
        activityService.addActivity(project.id, {
          id: `act-${project.id}-${Date.now()}`,
          type: 'comment',
          projectId: project.id,
          userId: project.responsibleId,
          message: `Problema "${problem.name}" marcado como ${labels[status]}`,
          timestamp: new Date().toISOString(),
        })
      }
    } catch {
      /* error handled by hook via actionError */
    }
  }

  const handleViewInFile = (problemId: string) => {
    const problem = problems.find((p) => p.id === problemId)
    if (problem) {
      setSelectedProblemId(problemId)
      setViewRequest({ page: problem.page, key: Date.now() })
    }
  }

  const handleSelect = (problemId: string) => {
    setSelectedProblemId(problemId)
    const problem = problems.find((p) => p.id === problemId)
    if (problem) {
      setViewRequest({ page: problem.page, key: Date.now() })
    }
  }

  if (!file) {
    return (
      <div className="flex flex-col items-center justify-center py-16 bg-card border border-border rounded-lg">
        <FileX className="h-10 w-10 text-muted-foreground mb-2" />
        <h3 className="text-sm font-semibold text-foreground">Nenhum arquivo enviado</h3>
        <p className="text-xs text-muted-foreground mt-1 text-center max-w-sm">
          Envie um arquivo PDF na aba "Arquivos" para iniciar a análise técnica.
        </p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 bg-card border border-border rounded-lg">
        <Loader2 className="h-6 w-6 text-primary animate-spin mr-2" />
        <span className="text-sm text-muted-foreground">Carregando análise...</span>
      </div>
    )
  }

  if (error && !job) {
    return (
      <div className="flex flex-col items-center justify-center py-16 bg-card border border-border rounded-lg">
        <AlertCircle className="h-10 w-10 text-red-500 mb-2" />
        <h3 className="text-sm font-semibold text-foreground">Erro ao carregar análise</h3>
        <p className="text-xs text-muted-foreground mt-1 mb-4 text-center max-w-sm">{error}</p>
      </div>
    )
  }

  if (!job) {
    return (
      <div>
        {error && (
          <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-3 mb-3">
            <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}
        <NoAnalysisState
          file={file}
          project={project}
          starting={starting}
          disabled={!hasProfile}
          disabledReason={!hasProfile ? 'Nenhum perfil de produção selecionado' : undefined}
          onStart={handleStart}
        />
      </div>
    )
  }

  const isFinal = FINAL_STATES.includes(job.status)
  const hasIssues = problems.length > 0

  if (job.status === 'failed') {
    return (
      <div>
        <AnalysisHeader project={project} counts={counts} />
        <JobStatusBanner job={job} actionError={actionError} onRetry={retryAnalysis} />
      </div>
    )
  }

  if (job.status === 'cancelled') {
    return (
      <div>
        <JobStatusBanner job={job} />
        <div className="mt-3">
          <NoAnalysisState
            file={file}
            project={project}
            starting={starting}
            disabled={!hasProfile}
            disabledReason={!hasProfile ? 'Nenhum perfil de produção selecionado' : undefined}
            onStart={handleStart}
          />
        </div>
      </div>
    )
  }

  if (isFinal && !hasIssues) {
    return (
      <div>
        <AnalysisHeader project={project} counts={counts} />
        <JobStatusBanner job={job} />
        <div className="flex flex-col items-center justify-center py-16 bg-card border border-border rounded-lg mt-3">
          <CheckCircle2 className="h-10 w-10 text-green-500 mb-2" />
          <h3 className="text-sm font-semibold text-foreground">
            Nenhum problema foi identificado pelas verificações executadas.
          </h3>
          <p className="text-xs text-muted-foreground mt-1 text-center max-w-sm">
            O preview técnico será disponibilizado após o processamento pelo analisador.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div>
      {error && (
        <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-3 mb-3">
          <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}
      <AnalysisHeader project={project} counts={counts} />
      <JobStatusBanner
        job={job}
        actionError={actionError}
        onCancel={!isFinal ? cancelAnalysis : undefined}
      />
      {hasIssues && (
        <>
          <QuickFilters
            search={search}
            onSearchChange={setSearch}
            activeFilter={activeFilter}
            onFilterChange={setActiveFilter}
            category={category}
            categories={categories}
            onCategoryChange={setCategory}
            currentPage={currentPage}
            counts={filterCounts}
          />
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-3">
            <div className="min-h-[480px]">
              <div
                className="flex flex-col items-center justify-center h-full bg-card border border-border rounded-lg"
                style={{ minHeight: '480px' }}
              >
                <ImageIcon className="h-8 w-8 text-muted-foreground mb-2" />
                <p className="text-xs text-muted-foreground text-center max-w-xs px-4">
                  O preview técnico será disponibilizado após o processamento pelo analisador.
                </p>
              </div>
            </div>
            <div>
              <ProblemList
                problems={sortedProblems}
                selectedProblemId={selectedProblemId}
                onAction={handleAction}
                onViewInFile={handleViewInFile}
                onSelect={handleSelect}
              />
            </div>
          </div>
        </>
      )}
      {!hasIssues && !isFinal && (
        <div className="flex flex-col items-center justify-center py-8 bg-card border border-border rounded-lg">
          <ImageIcon className="h-8 w-8 text-muted-foreground mb-2" />
          <p className="text-xs text-muted-foreground text-center max-w-sm">
            O preview técnico será disponibilizado após o processamento pelo analisador.
          </p>
        </div>
      )}
    </div>
  )
}
