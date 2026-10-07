import { cn } from '@/lib/utils'
import { jobState, type Job, type JobState } from '@/services/jobsService'

const STYLES: Record<JobState, { label: string; className: string }> = {
  analyzing: { label: 'Analisando', className: 'bg-blue-500/15 text-blue-600 dark:text-blue-400' },
  blocked: { label: 'Bloqueado', className: 'bg-red-500/15 text-red-600 dark:text-red-400' },
  review: { label: 'Revisar', className: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
  ready: { label: 'Pronto', className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
  failed: { label: 'Falhou', className: 'bg-red-500/15 text-red-600 dark:text-red-400' },
  waiting: { label: 'Sem análise', className: 'bg-muted text-muted-foreground' },
}

export function JobStateBadge({ job }: { job: Job }) {
  const state = jobState(job)
  const style = STYLES[state]
  const progress = job.latestAnalysis?.progress ?? 0
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium',
        style.className,
      )}
    >
      {style.label}
      {state === 'analyzing' && progress > 0 && <span>{progress}%</span>}
      {(state === 'blocked' || state === 'review') && <span>· {job.issueCount}</span>}
    </span>
  )
}
