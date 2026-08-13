import { useState, useEffect, useMemo } from 'react'
import { PageHeader } from '@/components/PageHeader'
import { DashboardSkeleton } from '@/components/dashboard/DashboardSkeleton'
import { DashboardFilters } from '@/components/dashboard/DashboardFilters'
import { OperationalView } from '@/components/dashboard/OperationalView'
import { ManagerialView } from '@/components/dashboard/ManagerialView'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { projectService } from '@/services/projectService'
import { computeDashboardData, DEFAULT_DASHBOARD_FILTERS } from '@/services/dashboardService'
import type { DashboardFilters as FilterState } from '@/services/dashboardService'
import type { Project } from '@/types'

export default function DashboardPage() {
  const [allProjects, setAllProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState<FilterState>(DEFAULT_DASHBOARD_FILTERS)
  const [view, setView] = useState<'operational' | 'managerial'>('operational')

  useEffect(() => {
    const load = async () => {
      const projects = await projectService.listProjects()
      setAllProjects(projects)
      setLoading(false)
    }
    load()
  }, [])

  useEffect(() => {
    const handleStorage = () => {
      projectService.listProjects().then(setAllProjects)
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  const data = useMemo(() => computeDashboardData(allProjects, filters), [allProjects, filters])

  const profileOptions = useMemo(() => {
    const profiles = [...new Set(allProjects.map((p) => p.productionProfile))].sort()
    return [
      { value: 'all', label: 'Todos os perfis' },
      ...profiles.map((p) => ({ value: p, label: p })),
    ]
  }, [allProjects])

  const handleFilterChange = (key: keyof FilterState, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }))
  }

  const handleClear = () => setFilters(DEFAULT_DASHBOARD_FILTERS)

  if (loading) return <DashboardSkeleton />

  return (
    <div>
      <PageHeader
        title="Visão Geral"
        breadcrumbs={[{ label: 'Home', href: '/dashboard' }, { label: 'Visão Geral' }]}
      />

      <DashboardFilters
        filters={filters}
        onFilterChange={handleFilterChange}
        onClear={handleClear}
        profileOptions={profileOptions}
      />

      <Tabs
        value={view}
        onValueChange={(v) => setView(v as 'operational' | 'managerial')}
        className="mt-4"
      >
        <TabsList>
          <TabsTrigger value="operational" className="text-sm">
            Operacional
          </TabsTrigger>
          <TabsTrigger value="managerial" className="text-sm">
            Gerencial
          </TabsTrigger>
        </TabsList>
        <TabsContent value="operational">
          <OperationalView data={data} />
        </TabsContent>
        <TabsContent value="managerial">
          <ManagerialView data={data} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
