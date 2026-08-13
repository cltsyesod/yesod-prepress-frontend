import { useNavigate } from 'react-router-dom'
import { PageHeader } from '@/components/PageHeader'
import { StatusBadge, SeverityBadge } from '@/components/Badges'
import { Button } from '@/components/ui/button'
import {
  Calendar,
  User,
  Building2,
  FileText,
  Settings2,
  Clock,
  Loader2,
  ArrowRight,
  AlertTriangle,
} from 'lucide-react'
import { formatDate } from '@/lib/utils'
import type { Project } from '@/types'

interface ProjectDetailHeaderProps {
  project: Project
}

interface ContextualAction {
  label: string
  to?: string
  disabled?: boolean
  loading?: boolean
}

function getContextualAction(status: string, id: string): ContextualAction {
  switch (status) {
    case 'draft':
      return { label: 'Continuar configuração', to: '/projects/new' }
    case 'analyzing':
      return { label: 'Analisando...', loading: true }
    case 'needs_review':
      return { label: 'Revisar problemas', to: `/projects/${id}/analysis` }
    case 'approved':
    case 'completed':
      return { label: 'Visualizar relatório', to: `/projects/${id}/report` }
    case 'failed':
      return { label: 'Revisar problemas', to: `/projects/${id}/analysis` }
    case 'pending_analysis':
      return { label: 'Iniciar análise', to: `/projects/${id}/analysis` }
    case 'pending_approval':
      return { label: 'Aguardar aprovação', disabled: true }
    case 'active':
      return { label: 'Ver análise', to: `/projects/${id}/analysis` }
    default:
      return { label: 'Ver análise', to: `/projects/${id}/analysis` }
  }
}

export function ProjectDetailHeader({ project }: ProjectDetailHeaderProps) {
  const navigate = useNavigate()
  const action = getContextualAction(project.status, project.id)

  const metaItems = [
    { icon: Building2, label: 'Cliente', value: project.clientName },
    { icon: FileText, label: 'Pedido', value: project.orderNumber },
    { icon: Settings2, label: 'Perfil', value: project.productionProfile },
    { icon: User, label: 'Responsável', value: project.responsibleName },
    { icon: Calendar, label: 'Prazo', value: formatDate(project.deadline) },
    { icon: Clock, label: 'Atualizado', value: formatDate(project.updatedAt) },
  ]

  return (
    <>
      <PageHeader
        title={project.name}
        breadcrumbs={[
          { label: 'Home', href: '/dashboard' },
          { label: 'Projetos', href: '/projects' },
          { label: project.name },
        ]}
        actions={
          <Button
            onClick={() => action.to && navigate(action.to)}
            disabled={action.disabled || action.loading}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium gap-1.5"
          >
            {action.loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> {action.label}
              </>
            ) : (
              <>
                {action.label} <ArrowRight className="h-4 w-4" />
              </>
            )}
          </Button>
        }
      />
      <div className="bg-card border border-border rounded-lg p-4 mb-4">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <StatusBadge status={project.status} />
          <SeverityBadge severity={project.severity} />
          {project.issueCount > 0 && (
            <span className="text-sm text-muted-foreground flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5" /> {project.issueCount} problema(s)
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {metaItems.map((item) => (
            <div key={item.label} className="flex items-center gap-2">
              <item.icon className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">{item.label}</p>
                <p className="text-sm font-medium text-foreground truncate">{item.value}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
