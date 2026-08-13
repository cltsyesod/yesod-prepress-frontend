import { useNavigate } from 'react-router-dom'
import { FileSearch, Loader2, RefreshCw, Clock, AlertTriangle, CalendarClock } from 'lucide-react'
import { IndicatorCard } from './IndicatorCard'
import { AttentionList } from './AttentionList'
import { ActivitiesFeed } from './ActivitiesFeed'
import type { DashboardData } from '@/services/dashboardService'

interface Props {
  data: DashboardData
}

export function OperationalView({ data }: Props) {
  const navigate = useNavigate()
  const m = data.operationalMetrics

  const cards = [
    {
      title: 'Aguardando Análise',
      value: m.awaitingAnalysis,
      icon: FileSearch,
      onClick: () => navigate('/projects?status=pending_analysis'),
    },
    {
      title: 'Em Análise',
      value: m.inAnalysis,
      icon: Loader2,
      onClick: () => navigate('/projects?status=analyzing'),
    },
    {
      title: 'Requerem Revisão',
      value: m.needsRevision,
      icon: RefreshCw,
      onClick: () => navigate('/projects?status=needs_review'),
    },
    {
      title: 'Aguardando Aprovação',
      value: m.awaitingApproval,
      icon: Clock,
      onClick: () => navigate('/projects?status=pending_approval'),
    },
    {
      title: 'Problemas Críticos Pendentes',
      value: m.criticalPendingProblems,
      icon: AlertTriangle,
      accent: true,
      onClick: () => navigate('/projects?severity=critical'),
    },
    {
      title: 'Prazos Próximos ou Vencidos',
      value: m.upcomingOrOverdueDeadlines,
      icon: CalendarClock,
    },
  ]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {cards.map((c) => (
          <IndicatorCard key={c.title} {...c} />
        ))}
      </div>
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <AttentionList projects={data.attentionProjects} />
        </div>
        <div>
          <ActivitiesFeed activities={data.recentActivities} />
        </div>
      </div>
    </div>
  )
}
