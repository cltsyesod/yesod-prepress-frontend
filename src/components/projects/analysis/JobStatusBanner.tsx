import {
  Clock,
  Loader2,
  Download,
  FileCheck,
  FileSearch,
  Image,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  XCircle,
  RotateCcw,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import type { AnalysisJob } from '@/services/analysisJobsService'

const STATUS_INFO: Record<
  string,
  { label: string; color: string; icon: typeof Clock; spin?: boolean }
> = {
  queued: {
    label: 'Na fila',
    color: 'text-slate-600 bg-slate-100 dark:text-slate-400 dark:bg-slate-800',
    icon: Clock,
  },
  preparing: {
    label: 'Preparando',
    color: 'text-blue-600 bg-blue-100 dark:text-blue-400 dark:bg-blue-950',
    icon: Loader2,
    spin: true,
  },
  downloading: {
    label: 'Baixando arquivo',
    color: 'text-blue-600 bg-blue-100 dark:text-blue-400 dark:bg-blue-950',
    icon: Download,
  },
  validating: {
    label: 'Validando PDF',
    color: 'text-blue-600 bg-blue-100 dark:text-blue-400 dark:bg-blue-950',
    icon: FileCheck,
  },
  extracting: {
    label: 'Extraindo informações',
    color: 'text-blue-600 bg-blue-100 dark:text-blue-400 dark:bg-blue-950',
    icon: FileSearch,
  },
  analyzing: {
    label: 'Analisando',
    color: 'text-blue-600 bg-blue-100 dark:text-blue-400 dark:bg-blue-950',
    icon: Loader2,
    spin: true,
  },
  generating_preview: {
    label: 'Gerando preview',
    color: 'text-blue-600 bg-blue-100 dark:text-blue-400 dark:bg-blue-950',
    icon: Image,
  },
  completed: {
    label: 'Concluído',
    color: 'text-green-600 bg-green-100 dark:text-green-400 dark:bg-green-950',
    icon: CheckCircle2,
  },
  completed_with_warnings: {
    label: 'Concluído com alertas',
    color: 'text-amber-600 bg-amber-100 dark:text-amber-400 dark:bg-amber-950',
    icon: AlertTriangle,
  },
  failed: {
    label: 'Falhou',
    color: 'text-red-600 bg-red-100 dark:text-red-400 dark:bg-red-950',
    icon: AlertCircle,
  },
  cancelled: {
    label: 'Cancelado',
    color: 'text-slate-600 bg-slate-100 dark:text-slate-400 dark:bg-slate-800',
    icon: XCircle,
  },
}

interface JobStatusBannerProps {
  job: AnalysisJob
  actionError?: string | null
  onCancel?: () => void
  onRetry?: () => void
}

export function JobStatusBanner({ job, actionError, onCancel, onRetry }: JobStatusBannerProps) {
  const info = STATUS_INFO[job.status] || STATUS_INFO.queued
  const Icon = info.icon
  const isActive = !['completed', 'completed_with_warnings', 'failed', 'cancelled'].includes(
    job.status,
  )

  const fmt = (ts: string) => {
    if (!ts) return null
    return new Date(ts).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div className="bg-card border border-border rounded-lg p-4 mb-3">
      <div className="flex items-center gap-3 mb-2">
        <div className={cn('p-1.5 rounded-full', info.color)}>
          <Icon className={cn('h-4 w-4', info.spin && isActive && 'animate-spin')} />
        </div>
        <span className="text-sm font-semibold text-foreground">{info.label}</span>
        {job.current_step && (
          <span className="text-xs text-muted-foreground">· {job.current_step}</span>
        )}
        {job.retry_count > 0 && (
          <span className="text-xs text-muted-foreground">· Tentativa {job.retry_count}</span>
        )}
      </div>
      {job.progress > 0 && (
        <div className="mb-2">
          <Progress value={job.progress} className="h-2" />
          <span className="text-xs text-muted-foreground mt-1 block">{job.progress}%</span>
        </div>
      )}
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        {fmt(job.started_at) && <span>Início: {fmt(job.started_at)}</span>}
        {fmt(job.completed_at) && <span>Término: {fmt(job.completed_at)}</span>}
        {fmt(job.updated) && <span>Atualizado: {fmt(job.updated)}</span>}
      </div>
      {job.error_message && (
        <div className="mt-2 p-2 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded text-xs text-red-600 dark:text-red-400">
          {job.error_code && <span className="font-medium">{job.error_code}: </span>}
          {job.error_message}
        </div>
      )}
      {actionError && (
        <div className="mt-2 p-2 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded text-xs text-red-600 dark:text-red-400">
          {actionError}
        </div>
      )}
      {(isActive || job.status === 'failed') && (onCancel || onRetry) && (
        <div className="flex gap-2 mt-3">
          {isActive && onCancel && (
            <Button size="sm" variant="outline" onClick={onCancel} className="h-7 text-xs gap-1">
              <X className="h-3 w-3" /> Cancelar
            </Button>
          )}
          {job.status === 'failed' && onRetry && (
            <Button size="sm" variant="outline" onClick={onRetry} className="h-7 text-xs gap-1">
              <RotateCcw className="h-3 w-3" /> Tentar novamente
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
