import {
  FileText,
  AlertTriangle,
  AlertCircle,
  Info,
  Clock,
  CheckCircle2,
  CheckCheck,
} from 'lucide-react'
import type { AnalysisCounts } from '@/lib/analysisHelpers'
import { cn } from '@/lib/utils'
import type { Project, ProjectStatus } from '@/types'

const STATUS_LABELS: Record<ProjectStatus, string> = {
  active: 'Ativo',
  completed: 'Concluído',
  paused: 'Pausado',
  archived: 'Arquivado',
  pending_analysis: 'Aguardando análise',
  pending_approval: 'Aguardando aprovação',
  approved: 'Aprovado',
  failed: 'Falhou',
  draft: 'Rascunho',
  analyzing: 'Em análise',
  needs_review: 'Requer revisão',
}

const STATUS_BADGE: Record<string, string> = {
  analyzing: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30',
  pending_analysis: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30',
  pending_approval:
    'bg-purple-500/15 text-purple-600 dark:text-purple-400 border border-purple-500/30',
  approved: 'bg-green-500/15 text-green-600 dark:text-green-400 border border-green-500/30',
  failed: 'bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30',
  needs_review: 'bg-orange-500/15 text-orange-600 dark:text-orange-400 border border-orange-500/30',
}

interface CountBadge {
  label: string
  value: number
  icon: typeof AlertTriangle
  color: string
}

interface AnalysisHeaderProps {
  project: Project
  counts: AnalysisCounts
}

export function AnalysisHeader({ project, counts }: AnalysisHeaderProps) {
  const statusLabel = STATUS_LABELS[project.status] || project.status
  const statusClass =
    STATUS_BADGE[project.status] || 'bg-muted text-muted-foreground border border-border'

  const badges: CountBadge[] = [
    { label: 'Total', value: counts.total, icon: FileText, color: 'text-foreground' },
    {
      label: 'Crítico',
      value: counts.critical,
      icon: AlertCircle,
      color: 'text-red-600 dark:text-red-400',
    },
    {
      label: 'Atenção',
      value: counts.warning,
      icon: AlertTriangle,
      color: 'text-amber-600 dark:text-amber-400',
    },
    {
      label: 'Informativo',
      value: counts.info,
      icon: Info,
      color: 'text-blue-600 dark:text-blue-400',
    },
    {
      label: 'Pendente',
      value: counts.pending,
      icon: Clock,
      color: 'text-orange-600 dark:text-orange-400',
    },
    {
      label: 'Aprovado',
      value: counts.fixed,
      icon: CheckCircle2,
      color: 'text-green-600 dark:text-green-400',
    },
    {
      label: 'Corrigido',
      value: counts.corrected,
      icon: CheckCheck,
      color: 'text-teal-600 dark:text-teal-400',
    },
  ]

  return (
    <div className="bg-card border border-border rounded-lg p-4 mb-3">
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-semibold text-foreground truncate">
            {project.filename || project.name}
          </span>
        </div>
        <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">v1.0</span>
        <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
          {project.productionProfile}
        </span>
        <span className={cn('text-xs font-medium px-2 py-0.5 rounded', statusClass)}>
          {statusLabel}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {badges.map((badge) => (
          <div
            key={badge.label}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted/50 border border-border/50"
          >
            <badge.icon className={cn('h-3.5 w-3.5', badge.color)} />
            <span className="text-xs text-muted-foreground">{badge.label}</span>
            <span className={cn('text-sm font-bold', badge.color)}>{badge.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
