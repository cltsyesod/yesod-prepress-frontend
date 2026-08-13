import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { ProjectFilters } from '@/components/projects/ProjectFilters'
import { ProjectsTable } from '@/components/projects/ProjectsTable'
import { ProjectCards } from '@/components/projects/ProjectCards'
import { ProjectsSkeleton } from '@/components/projects/ProjectsSkeleton'
import { Button } from '@/components/ui/button'
import { Plus, FolderOpen, SearchX } from 'lucide-react'
import { projectService } from '@/services/projectService'
import type { Project, FilterState, SortOption } from '@/types'

const DEFAULT_FILTERS: FilterState = {
  search: '',
  status: 'all',
  client: 'all',
  responsible: 'all',
  severity: 'all',
  profile: 'all',
  period: 'all',
  fileType: 'all',
}

const PAGE_SIZE = 10
const SEVERITY_ORDER: Record<string, number> = { critical: 0, warning: 1, info: 2, none: 3 }

export default function ProjectsPage() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [searchParams] = useSearchParams()
  const [filters, setFilters] = useState<FilterState>(() => ({
    ...DEFAULT_FILTERS,
    status: searchParams.get('status') || 'all',
    client: searchParams.get('client') || 'all',
    responsible: searchParams.get('responsible') || 'all',
    severity: searchParams.get('severity') || 'all',
    profile: searchParams.get('profile') || 'all',
    period: searchParams.get('period') || 'all',
  }))
  const [sort, setSort] = useState<SortOption>('recent')
  const [view, setView] = useState<'table' | 'card'>(() => {
    const saved = localStorage.getItem('yesod_project_view')
    return saved === 'card' || saved === 'table' ? saved : 'table'
  })
  const [page, setPage] = useState(1)

  useEffect(() => {
    projectService.listProjects().then((data) => {
      setProjects(data)
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    localStorage.setItem('yesod_project_view', view)
  }, [view])
  useEffect(() => {
    setPage(1)
  }, [filters, sort])

  const handleFilterChange = (key: keyof FilterState, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }))
  }
  const handleClear = () => {
    setFilters(DEFAULT_FILTERS)
  }

  const filteredProjects = useMemo(() => {
    let result = [...projects]
    const q = filters.search.trim().toLowerCase()
    if (q) {
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.clientName.toLowerCase().includes(q) ||
          p.filename.toLowerCase().includes(q) ||
          p.orderNumber.toLowerCase().includes(q),
      )
    }
    if (filters.status !== 'all') result = result.filter((p) => p.status === filters.status)
    if (filters.client !== 'all') result = result.filter((p) => p.clientId === filters.client)
    if (filters.responsible !== 'all')
      result = result.filter((p) => p.responsibleId === filters.responsible)
    if (filters.severity !== 'all') result = result.filter((p) => p.severity === filters.severity)
    if (filters.profile !== 'all')
      result = result.filter((p) => p.productionProfile === filters.profile)
    if (filters.fileType !== 'all') result = result.filter((p) => p.fileType === filters.fileType)
    if (filters.period !== 'all') {
      const days: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 }
      const cutoff = Date.now() - (days[filters.period] || 0) * 86400000
      result = result.filter((p) => new Date(p.createdAt).getTime() >= cutoff)
    }
    switch (sort) {
      case 'recent':
        result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        break
      case 'oldest':
        result.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        break
      case 'deadline':
        result.sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime())
        break
      case 'name':
        result.sort((a, b) => a.name.localeCompare(b.name))
        break
      case 'severity':
        result.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
        break
    }
    return result
  }, [projects, filters, sort])

  const totalPages = Math.ceil(filteredProjects.length / PAGE_SIZE)
  const paginatedProjects = filteredProjects.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const startIdx = filteredProjects.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const endIdx = Math.min(page * PAGE_SIZE, filteredProjects.length)

  if (loading) {
    return (
      <div>
        <PageHeader
          title="Projetos"
          breadcrumbs={[{ label: 'Home', href: '/dashboard' }, { label: 'Projetos' }]}
        />
        <ProjectsSkeleton />
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Projetos"
        breadcrumbs={[{ label: 'Home', href: '/dashboard' }, { label: 'Projetos' }]}
        actions={
          <Button
            onClick={() => navigate('/projects/new')}
            className="navy-gradient text-white text-xs font-medium gap-1.5 transition-all hover:brightness-125"
          >
            <Plus className="h-4 w-4" /> Novo projeto
          </Button>
        }
      />

      {projects.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title="Nenhum projeto ainda"
          description="Crie seu primeiro projeto para começar a gerenciar e analisar arquivos de pré-impressão."
          actionLabel="Criar primeiro projeto"
          onAction={() => navigate('/projects/new')}
        />
      ) : (
        <>
          <ProjectFilters
            filters={filters}
            onFilterChange={handleFilterChange}
            onClear={handleClear}
            sort={sort}
            onSortChange={setSort}
            view={view}
            onViewChange={setView}
          />
          {filteredProjects.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center bg-[#182233] border border-[#2A374A] rounded-lg mt-4">
              <div className="p-3 bg-[#1E293B] rounded-full mb-3 text-slate-400">
                <SearchX className="h-8 w-8" />
              </div>
              <h3 className="text-base font-semibold text-slate-200 mb-1">
                Nenhum projeto encontrado
              </h3>
              <p className="text-sm text-slate-400 max-w-sm mb-4">
                Tente ajustar os filtros ou limpar os critérios de busca.
              </p>
              <Button onClick={handleClear} variant="outline" className="text-xs">
                Limpar filtros
              </Button>
            </div>
          ) : (
            <>
              <div className="mt-4">
                {view === 'table' ? (
                  <ProjectsTable projects={paginatedProjects} />
                ) : (
                  <ProjectCards projects={paginatedProjects} />
                )}
              </div>
              <div className="flex items-center justify-between mt-4 text-xs text-slate-400">
                <span>
                  Mostrando {startIdx}-{endIdx} de {filteredProjects.length}
                </span>
                {totalPages > 1 && (
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page === 1}
                      onClick={() => setPage((p) => p - 1)}
                      className="h-7 text-xs"
                    >
                      Anterior
                    </Button>
                    <span className="px-2">
                      Página {page} de {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page === totalPages}
                      onClick={() => setPage((p) => p + 1)}
                      className="h-7 text-xs"
                    >
                      Próxima
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
