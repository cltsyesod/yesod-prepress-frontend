import { cn } from '@/lib/utils'

interface StatusBadgeProps {
  status: 'active' | 'completed' | 'paused' | 'archived' | string
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const map: Record<string, { label: string; className: string }> = {
    active: {
      label: 'Ativo',
      className: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30',
    },
    completed: {
      label: 'Concluído',
      className: 'bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/30',
    },
    paused: {
      label: 'Pausado',
      className: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
    },
    archived: {
      label: 'Arquivado',
      className: 'bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-500/30',
    },
    pending_analysis: {
      label: 'Aguardando Análise',
      className: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
    },
    pending_approval: {
      label: 'Aguardando Aprovação',
      className: 'bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30',
    },
    approved: {
      label: 'Aprovado',
      className: 'bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/30',
    },
    failed: {
      label: 'Falhou',
      className: 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30',
    },
    draft: {
      label: 'Rascunho',
      className: 'bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-500/30',
    },
    analyzing: {
      label: 'Analisando',
      className: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30',
    },
    needs_review: {
      label: 'Requer Revisão',
      className: 'bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30',
    },
  }

  const current = map[status] || {
    label: status,
    className: 'bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-500/30',
  }

  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border',
        current.className,
      )}
    >
      {current.label}
    </span>
  )
}

interface SeverityBadgeProps {
  severity: 'critical' | 'warning' | 'info'
}

export function SeverityBadge({ severity }: SeverityBadgeProps) {
  const map: Record<string, { label: string; className: string }> = {
    critical: {
      label: 'Crítico',
      className: 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30',
    },
    warning: {
      label: 'Atenção',
      className: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
    },
    info: {
      label: 'Informativo',
      className: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30',
    },
    none: {
      label: 'Sem issues',
      className: 'bg-slate-500/10 text-slate-600 dark:text-slate-500 border-slate-500/30',
    },
  }

  const current = map[severity] || map.none

  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border',
        current.className,
      )}
    >
      {current.label}
    </span>
  )
}
