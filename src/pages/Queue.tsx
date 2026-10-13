import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Loader2, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { NewJobPanel } from '@/components/jobs/NewJobPanel'
import { JobStateBadge } from '@/components/jobs/JobStateBadge'
import { useRealtime } from '@/hooks/use-realtime'
import { getErrorMessage } from '@/lib/supabase/errors'
import { cn } from '@/lib/utils'
import { useAuth } from '@/hooks/use-auth'
import { useTeam } from '@/hooks/use-team'
import { DUE_TONE, dueLabel, priorityOf } from '@/lib/job-meta'
import { jobState, jobsService, type Job, type JobState } from '@/services/jobsService'

type FilterKey = 'all' | 'action' | 'client' | 'ready' | 'sent'

const FILTERS: { key: FilterKey; label: string; states: JobState[] }[] = [
  { key: 'action', label: 'Precisam de ação', states: ['blocked', 'review', 'failed'] },
  { key: 'client', label: 'Com o cliente', states: ['returned'] },
  { key: 'ready', label: 'Prontos', states: ['ready'] },
  { key: 'sent', label: 'No RIP', states: ['sent'] },
  { key: 'all', label: 'Todos', states: [] },
]

export default function QueuePage() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<FilterKey>('all')
  const [mine, setMine] = useState(false)
  const { user } = useAuth()
  const { nameOf } = useTeam()

  const load = useCallback(async () => {
    try {
      setJobs(await jobsService.listJobs())
      setError('')
    } catch (err) {
      setError(getErrorMessage(err))
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Status ao vivo enquanto o analisador trabalha.
  useRealtime('analysis_jobs', () => load(), true)
  useRealtime('projects', () => load(), true)

  const visible = useMemo(() => {
    const states = FILTERS.find((f) => f.key === filter)?.states ?? []
    const q = query.trim().toLowerCase()
    return jobs.filter(
      (job) =>
        (!states.length || states.includes(jobState(job))) &&
        (!mine || job.assigneeId === user?.id) &&
        (!q || `${job.name} ${job.clientName} ${nameOf(job.assigneeId)}`.toLowerCase().includes(q)),
    )
    // nameOf muda quando a equipe carrega
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, filter, query, mine, user?.id])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Fila de trabalho</h1>
        <p className="text-sm text-muted-foreground">
          Envie o arquivo do cliente; o preflight roda sozinho e aponta o que precisa de ação.
        </p>
      </div>

      <NewJobPanel />

      <section className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-1 rounded-md bg-muted p-1">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={cn(
                  'rounded px-3 py-1.5 text-sm transition-colors',
                  filter === f.key
                    ? 'bg-background font-medium text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
            Só os meus
          </label>
          <div className="relative sm:w-64">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Buscar trabalho, cliente ou responsável"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <p className="rounded-md border border-destructive/40 p-4 text-sm text-destructive">
            Não foi possível carregar os trabalhos: {error}
          </p>
        ) : visible.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            {jobs.length === 0
              ? 'Nenhum trabalho ainda. Solte um PDF acima para começar.'
              : 'Nenhum trabalho neste filtro.'}
          </p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
            {visible.map((job) => (
              <li key={job.id}>
                <Link
                  to={`/trabalhos/${job.id}`}
                  className="flex flex-col gap-2 px-4 py-3 transition-colors hover:bg-accent/50 sm:flex-row sm:items-center sm:gap-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-foreground">{job.name}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {[job.clientName, job.latestAnalysis?.current_step].filter(Boolean).join(' · ') ||
                        'Sem análise'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 sm:justify-end">
                    <JobMetaLine job={job} assignee={nameOf(job.assigneeId)} />
                    <JobStateBadge job={job} />
                    <span className="w-28 text-right text-xs text-muted-foreground">
                      {job.updatedAt &&
                        formatDistanceToNow(new Date(job.updatedAt), { addSuffix: true, locale: ptBR })}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

/** Prazo, prioridade e responsável na linha da fila. */
function JobMetaLine({ job, assignee }: { job: Job; assignee: string }) {
  const due = job.sentToRipAt ? null : dueLabel(job.dueDate)
  const priority = priorityOf(job.priority)
  return (
    <span className="flex items-center gap-2 text-xs">
      {job.priority !== 'normal' && (
        <span className={cn('rounded px-1.5 py-0.5 font-medium', priority.className)}>{priority.label}</span>
      )}
      {due && <span className={DUE_TONE[due.tone]}>{due.text}</span>}
      {assignee && <span className="max-w-[9rem] truncate text-muted-foreground">{assignee}</span>}
    </span>
  )
}
