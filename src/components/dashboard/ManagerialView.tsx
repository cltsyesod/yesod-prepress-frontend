import { useNavigate } from 'react-router-dom'
import {
  FolderKanban,
  CheckCircle,
  Percent,
  FileCheck,
  Bug,
  CheckCheck,
  Divide,
} from 'lucide-react'
import { IndicatorCard } from './IndicatorCard'
import {
  StatusPieChart,
  CriticalityPieChart,
  RecurringProblemsChart,
  ProfileBarChart,
} from './DashboardCharts'
import type { DashboardData } from '@/services/dashboardService'

interface Props {
  data: DashboardData
}

export function ManagerialView({ data }: Props) {
  const navigate = useNavigate()
  const m = data.managerialMetrics

  const cards = [
    {
      title: 'Total de Projetos',
      value: m.totalProjects,
      icon: FolderKanban,
      onClick: () => navigate('/projects'),
    },
    {
      title: 'Projetos Concluídos',
      value: m.completedProjects,
      icon: CheckCircle,
      onClick: () => navigate('/projects?status=completed'),
    },
    { title: 'Taxa de Aprovação', value: `${m.approvalRate}%`, icon: Percent },
    { title: 'Arquivos Analisados', value: m.analyzedFiles, icon: FileCheck },
    { title: 'Problemas Encontrados', value: m.problemsFound, icon: Bug },
    { title: 'Problemas Corrigidos', value: m.problemsFixed, icon: CheckCheck },
    { title: 'Média Problemas/Projeto', value: m.avgProblemsPerProject, icon: Divide },
  ]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {cards.map((c) => (
          <IndicatorCard key={c.title} {...c} />
        ))}
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <StatusPieChart data={data.chartData.projectsByStatus} />
        <CriticalityPieChart data={data.chartData.problemsByCriticality} />
        <RecurringProblemsChart data={data.chartData.recurringProblems} />
        <ProfileBarChart
          data={data.chartData.projectsByProfile}
          onProfileClick={(name) => navigate(`/projects?profile=${encodeURIComponent(name)}`)}
        />
      </div>
    </div>
  )
}
