import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  Clock,
  Cpu,
  HardDrive,
  Layers,
  Loader2,
  Scissors,
  Users,
  Wand2,
} from 'lucide-react'
import { useAuth } from '@/hooks/use-auth'
import { useRealtime } from '@/hooks/use-realtime'
import { useTeam } from '@/hooks/use-team'
import { getErrorMessage } from '@/lib/supabase/errors'
import { cn } from '@/lib/utils'
import { DUE_TONE, PRIORITY_RANK, STAGES, daysUntil, dueLabel, priorityOf, stageOf } from '@/lib/job-meta'
import { dashboardService, type DashboardStats } from '@/services/dashboardService'
import { jobsService, type Job, type JobStage } from '@/services/jobsService'

const PERIODS = [7, 30, 90]
const STORAGE_LIMIT = 1024 ** 3 // plano gratuito da Supabase
const STALE_HOURS = 48
// Etapas em que o trabalho espera alguém da pré-impressão (ou o cliente).
const WAITING_ON_US: JobStage[] = ['waiting', 'blocked', 'decision', 'failed', 'ready']

// Série dupla validada para daltonismo (claro e escuro): entradas × enviados ao RIP.
const IN_BAR = 'bg-[#2563eb] dark:bg-[#4a8cf7]'
const OUT_BAR = 'bg-[#ea7a0c] dark:bg-[#cc6d14]'

type Reason = { key: string; label: string; rank: number; tone: string }

/** O motivo mais urgente para olhar o trabalho agora (ou null se está em dia). */
function attentionReason(job: Job): Reason | null {
  if (job.stage === 'sent') return null
  const days = job.dueDate ? daysUntil(job.dueDate) : null
  if (days !== null && days < 0)
    return { key: 'late', label: `Atrasado ${-days}d`, rank: 0, tone: 'bg-red-500/15 text-red-600 dark:text-red-400' }
  if (job.stage === 'failed')
    return { key: 'failed', label: 'Análise falhou', rank: 1, tone: 'bg-rose-500/15 text-rose-700 dark:text-rose-400' }
  if (days === 0)
    return { key: 'today', label: 'Vence hoje', rank: 2, tone: 'bg-orange-500/15 text-orange-700 dark:text-orange-400' }
  if (job.stage === 'blocked')
    return { key: 'blocked', label: 'Bloqueado', rank: 3, tone: 'bg-red-500/15 text-red-600 dark:text-red-400' }
  if (job.priority === 'urgente')
    return { key: 'urgent', label: 'Urgente', rank: 4, tone: 'bg-red-500/15 text-red-600 dark:text-red-400' }
  const idleHours = job.lastActivity ? (Date.now() - new Date(job.lastActivity).getTime()) / 3_600_000 : 0
  if (job.stage && WAITING_ON_US.includes(job.stage) && idleHours > STALE_HOURS)
    return {
      key: 'stale',
      label: `Parado ${Math.floor(idleHours / 24)}d`,
      rank: 5,
      tone: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
    }
  if (days !== null && days <= 1 && job.stage !== 'ready')
    return { key: 'soon', label: 'Vence amanhã', rank: 6, tone: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' }
  return null
}

const within = (iso: string | null | undefined, days: number) =>
  !!iso && Date.now() - new Date(iso).getTime() <= days * 86_400_000

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

const fmt = (n: number, digits = 0) => n.toLocaleString('pt-BR', { maximumFractionDigits: digits })

function duration(hours: number) {
  if (hours < 1) return `${Math.round(hours * 60)} min`
  if (hours < 48) return `${fmt(hours, 1)} h`
  return `${fmt(hours / 24, 1)} dias`
}

/**
 * Painel da pré-impressão: o fluxo agora, o que precisa de atenção, o ritmo do período,
 * a qualidade dos arquivos que chegam, a equipe e a saúde do sistema. Tudo clicável
 * leva ao trabalho; os números vêm do banco e se atualizam sozinhos.
 */
export default function DashboardPage() {
  const { user, membership } = useAuth()
  const { members, nameOf } = useTeam()
  const [days, setDays] = useState(30)
  const [mine, setMine] = useState(false)
  const [jobs, setJobs] = useState<Job[]>([])
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [storage, setStorage] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const [list, numbers, bytes] = await Promise.all([
        jobsService.listJobs(),
        dashboardService.stats(days),
        dashboardService.storageBytes().catch(() => null),
      ])
      setJobs(list)
      setStats(numbers)
      setStorage(bytes)
      setError('')
    } catch (err) {
      setError(getErrorMessage(err))
    }
    setLoading(false)
  }, [days])

  useEffect(() => {
    load()
  }, [load])
  useRealtime('projects', () => load(), true)
  useRealtime('analysis_jobs', () => load(), true)

  const scoped = useMemo(() => (mine ? jobs.filter((j) => j.assigneeId === user?.id) : jobs), [jobs, mine, user?.id])
  const active = scoped.filter((j) => j.stage !== 'sent')

  const stageCount = (stage: JobStage) =>
    stage === 'sent'
      ? scoped.filter((j) => j.stage === 'sent' && within(j.sentToRipAt, days)).length
      : active.filter((j) => j.stage === stage).length

  const attention = active
    .map((job) => ({ job, reason: attentionReason(job) }))
    .filter((x): x is { job: Job; reason: Reason } => x.reason !== null)
    .sort(
      (a, b) =>
        a.reason.rank - b.reason.rank ||
        PRIORITY_RANK[a.job.priority] - PRIORITY_RANK[b.job.priority] ||
        (a.job.dueDate ?? '9999').localeCompare(b.job.dueDate ?? '9999'),
    )

  const deadlines = {
    late: active.filter((j) => j.dueDate && daysUntil(j.dueDate) < 0).length,
    today: active.filter((j) => j.dueDate && daysUntil(j.dueDate) === 0).length,
    soon: active.filter((j) => j.dueDate && daysUntil(j.dueDate) > 0 && daysUntil(j.dueDate) <= 3).length,
    none: active.filter((j) => !j.dueDate).length,
  }

  const sentInPeriod = scoped.filter((j) => j.stage === 'sent' && within(j.sentToRipAt, days))
  const createdInPeriod = scoped.filter((j) => within(j.createdAt, days))
  const leadHours = sentInPeriod.length
    ? sentInPeriod.reduce(
        (sum, j) => sum + (new Date(j.sentToRipAt!).getTime() - new Date(j.createdAt).getTime()) / 3_600_000,
        0,
      ) / sentInPeriod.length
    : null

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* ---- Cabeçalho e período ---- */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Painel da pré-impressão</h1>
          <p className="text-sm text-muted-foreground">
            {membership?.orgName} · {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
            Só os meus
          </label>
          <div className="flex rounded-lg bg-muted p-0.5" role="tablist" aria-label="Período">
            {PERIODS.map((p) => (
              <button
                key={p}
                type="button"
                role="tab"
                aria-selected={days === p}
                onClick={() => setDays(p)}
                className={cn(
                  'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                  days === p ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {p} dias
              </button>
            ))}
          </div>
        </div>
      </header>

      {error && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          Não foi possível carregar o painel: {error}
        </p>
      )}

      {/* ---- 1. O fluxo agora ---- */}
      <Card title="O fluxo agora" subtitle={`${active.length} trabalhos em andamento`}>
        <FlowBar counts={STAGES.filter((s) => s.id !== 'sent').map((s) => ({ stage: s, n: stageCount(s.id) }))} />
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
          {STAGES.map((stage) => (
            <Link
              key={stage.id}
              to="/trabalhos"
              className="rounded-lg border border-border p-3 transition-colors hover:bg-accent/50"
              title={stage.hint}
            >
              <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                <span className={cn('h-2 w-2 rounded-full', stage.dot)} />
                {stage.label}
              </span>
              <span className="mt-1 block text-2xl font-semibold tabular-nums text-foreground">{stageCount(stage.id)}</span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {stage.id === 'sent' ? `nos últimos ${days} dias` : stage.hint}
              </span>
            </Link>
          ))}
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {/* ---- 2. Precisa de atenção ---- */}
        <Card
          title="Precisa de atenção"
          subtitle={attention.length ? `${attention.length} trabalhos` : 'nada urgente agora'}
          icon={AlertTriangle}
        >
          {attention.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhum trabalho atrasado, bloqueado ou parado. 👌
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {attention.slice(0, 10).map(({ job, reason }) => {
                const due = dueLabel(job.dueDate)
                const stage = stageOf(job.stage)
                return (
                  <li key={job.id}>
                    <Link to={`/trabalhos/${job.id}`} className="flex items-center gap-3 py-2.5 hover:bg-accent/40">
                      <span className={cn('w-28 shrink-0 rounded px-2 py-0.5 text-center text-xs font-semibold', reason.tone)}>
                        {reason.label}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">{job.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {[job.clientName, nameOf(job.assigneeId) || 'sem responsável'].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      {stage && (
                        <span className={cn('hidden items-center gap-1.5 text-xs sm:flex', stage.text)}>
                          <span className={cn('h-1.5 w-1.5 rounded-full', stage.dot)} />
                          {stage.label}
                        </span>
                      )}
                      {due && <span className={cn('w-24 text-right text-xs', DUE_TONE[due.tone])}>{due.text}</span>}
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
          {attention.length > 10 && (
            <Link to="/trabalhos" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              Ver todos na fila <ArrowRight className="h-3 w-3" />
            </Link>
          )}
        </Card>

        {/* ---- Prazos ---- */}
        <Card title="Prazos" subtitle="trabalhos em andamento" icon={CalendarClock}>
          <div className="grid grid-cols-2 gap-2">
            <Kpi label="Atrasados" value={deadlines.late} tone={deadlines.late ? 'text-red-600 dark:text-red-400' : undefined} />
            <Kpi label="Vencem hoje" value={deadlines.today} tone={deadlines.today ? 'text-orange-600 dark:text-orange-400' : undefined} />
            <Kpi label="Próximos 3 dias" value={deadlines.soon} />
            <Kpi label="Sem prazo" value={deadlines.none} hint="defina o prazo na ficha" />
          </div>
          <div className="mt-4 space-y-2 border-t border-border pt-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Prioridade</p>
            {(['urgente', 'alta'] as const).map((p) => {
              const n = active.filter((j) => j.priority === p).length
              const meta = priorityOf(p)
              return (
                <div key={p} className="flex items-center justify-between text-sm">
                  <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', meta.className)}>{meta.label}</span>
                  <span className="tabular-nums font-semibold text-foreground">{n}</span>
                </div>
              )
            })}
          </div>
        </Card>
      </div>

      {/* ---- 3. Ritmo do período ---- */}
      <Card title="Ritmo" subtitle={`últimos ${days} dias`} icon={Clock}>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <div className="grid grid-cols-2 gap-2 self-start">
            <Kpi label="Entraram" value={createdInPeriod.length} />
            <Kpi label="Enviados ao RIP" value={sentInPeriod.length} />
            <Kpi
              label="Do arquivo ao RIP"
              text={leadHours === null ? '—' : duration(leadHours)}
              hint="tempo médio, entrada até o envio"
            />
            <Kpi
              label="Análise"
              text={stats?.analyses.avg_seconds ? `${fmt(stats.analyses.avg_seconds, 1)} s` : '—'}
              hint={`${stats?.analyses.total ?? 0} análises · ${plural(stats?.analyses.failed ?? 0, 'falhou', 'falharam')}`}
            />
          </div>
          <FlowChart jobs={scoped} days={Math.min(days, 30)} />
        </div>
      </Card>

      {/* ---- 4. Qualidade dos arquivos que chegam ---- */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Problemas mais comuns" subtitle="em quantos trabalhos aparecem" icon={AlertTriangle}>
          {stats?.topRules.length ? (
            <BarList
              items={stats.topRules.map((r) => ({
                label: r.title,
                value: r.jobs,
                detail: `${r.occurrences} ocorrências`,
                tone: r.severity === 'critical' ? 'bloqueia' : undefined,
              }))}
            />
          ) : (
            <Empty>Nenhum problema no período.</Empty>
          )}
        </Card>

        <Card title="Clientes" subtitle="quem mais manda arquivo com problema" icon={Users}>
          {stats?.clients.length ? (
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="pb-2 font-medium">Cliente</th>
                  <th className="pb-2 text-right font-medium">Trabalhos</th>
                  <th className="pb-2 text-right font-medium">Com bloqueio</th>
                  <th className="pb-2 text-right font-medium">Problemas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border tabular-nums">
                {stats.clients.map((c) => (
                  <tr key={c.client}>
                    <td className="max-w-[12rem] truncate py-1.5 text-foreground">{c.client}</td>
                    <td className="py-1.5 text-right">{c.jobs}</td>
                    <td className={cn('py-1.5 text-right', c.jobs_with_blockers && 'font-semibold text-red-600 dark:text-red-400')}>
                      {c.jobs_with_blockers}
                    </td>
                    <td className="py-1.5 text-right text-muted-foreground">{c.problems}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty>Nenhum trabalho no período.</Empty>
          )}
        </Card>

        <Card title="Decisões do operador" subtitle="o que foi feito com cada ponto" icon={Wand2}>
          <DecisionBar decisions={stats?.decisions ?? {}} />
        </Card>

        <Card title="Correções automáticas" subtitle="aplicadas pelo sistema no período" icon={Wand2}>
          {stats?.fixes.length ? (
            <BarList items={stats.fixes.map((f) => ({ label: f.label, value: f.n }))} />
          ) : (
            <Empty>Nenhuma correção aplicada no período.</Empty>
          )}
        </Card>
      </div>

      {/* ---- 5. Equipe ---- */}
      <Card title="Equipe" subtitle="trabalhos por responsável" icon={Users}>
        <table className="w-full text-sm">
          <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="pb-2 font-medium">Pessoa</th>
              <th className="pb-2 text-right font-medium">Em andamento</th>
              <th className="pb-2 text-right font-medium">Para decidir</th>
              <th className="pb-2 text-right font-medium">Atrasados</th>
              <th className="pb-2 text-right font-medium">No RIP ({days}d)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border tabular-nums">
            {[...members.filter((m) => m.active).map((m) => ({ id: m.userId as string | null, name: m.name })), { id: null, name: 'Sem responsável' }].map(
              (person) => {
                const own = jobs.filter((j) => (j.assigneeId ?? null) === person.id)
                const going = own.filter((j) => j.stage !== 'sent')
                if (!person.id && !own.length) return null
                return (
                  <tr key={person.id ?? 'none'}>
                    <td className={cn('py-1.5', person.id ? 'text-foreground' : 'text-muted-foreground')}>{person.name}</td>
                    <td className="py-1.5 text-right">{going.length}</td>
                    <td className="py-1.5 text-right">{going.filter((j) => j.stage === 'decision' || j.stage === 'blocked').length}</td>
                    <td className="py-1.5 text-right">
                      {(() => {
                        const late = going.filter((j) => j.dueDate && daysUntil(j.dueDate) < 0).length
                        return <span className={cn(late && 'font-semibold text-red-600 dark:text-red-400')}>{late}</span>
                      })()}
                    </td>
                    <td className="py-1.5 text-right">{own.filter((j) => j.stage === 'sent' && within(j.sentToRipAt, days)).length}</td>
                  </tr>
                )
              },
            )}
          </tbody>
        </table>
      </Card>

      {/* ---- 6. Produção e sistema ---- */}
      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
        <Card title="Montagem" icon={Layers}>
          <Kpi label="Montagens" value={stats?.nesting.runs ?? 0} />
          <p className="mt-2 text-xs text-muted-foreground">
            {fmt((stats?.nesting.length_mm ?? 0) / 1000, 1)} m de material
            {stats?.nesting.efficiency != null && ` · aproveitamento médio ${fmt(stats.nesting.efficiency, 1)}%`}
          </p>
        </Card>
        <Card title="Painéis" icon={Scissors}>
          <Kpi label="Exportações" value={stats?.tiling.exports ?? 0} />
        </Card>
        <Card title="Analisador" icon={Cpu}>
          <Kpi
            label="Travadas agora"
            value={stats?.analyses.stuck ?? 0}
            tone={stats?.analyses.stuck ? 'text-red-600 dark:text-red-400' : undefined}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            {plural(stats?.analyses.failed ?? 0, 'falha', 'falhas')} em {stats?.analyses.total ?? 0} análises
          </p>
        </Card>
        <Card title="Armazenamento" icon={HardDrive}>
          {storage === null ? (
            <Empty>—</Empty>
          ) : (
            <>
              <Kpi label="Usado" text={`${fmt(storage / 1024 ** 2, 1)} MB`} />
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                <div
                  className={cn('h-full rounded-full', storage / STORAGE_LIMIT > 0.8 ? 'bg-red-500' : 'bg-primary')}
                  style={{ width: `${Math.max(1, Math.min(100, (storage / STORAGE_LIMIT) * 100))}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {fmt((storage / STORAGE_LIMIT) * 100, 1)}% de 1 GB (plano gratuito)
              </p>
            </>
          )}
        </Card>
      </div>

      <p className="text-xs text-muted-foreground">
        Atualizado {formatDistanceToNow(new Date(), { addSuffix: true, locale: ptBR })}, e de novo a cada mudança.
      </p>
    </div>
  )
}

function Card({
  title,
  subtitle,
  icon: Icon,
  children,
}: {
  title: string
  subtitle?: string
  icon?: typeof Clock
  children: ReactNode
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <header className="mb-3 flex items-baseline gap-2">
        {Icon && <Icon className="h-4 w-4 self-center text-muted-foreground" />}
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {subtitle && <span className="text-xs text-muted-foreground">{subtitle}</span>}
      </header>
      {children}
    </section>
  )
}

function Kpi({ label, value, text, hint, tone }: { label: string; value?: number; text?: string; hint?: string; tone?: string }) {
  return (
    <div className="rounded-lg bg-muted/40 p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn('text-2xl font-semibold tabular-nums text-foreground', tone)}>{text ?? fmt(value ?? 0)}</p>
      {hint && <p className="truncate text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="py-4 text-center text-sm text-muted-foreground">{children}</p>
}

/** Barra única com o peso de cada etapa no que está em andamento (rótulos ao lado). */
function FlowBar({ counts }: { counts: { stage: (typeof STAGES)[number]; n: number }[] }) {
  const total = counts.reduce((s, c) => s + c.n, 0)
  if (!total) return <Empty>Nenhum trabalho em andamento.</Empty>
  return (
    <div className="flex h-3 gap-0.5 overflow-hidden rounded-full" role="img" aria-label="Trabalhos por etapa">
      {counts
        .filter((c) => c.n > 0)
        .map((c) => (
          <div
            key={c.stage.id}
            className={cn('h-full first:rounded-l-full last:rounded-r-full', c.stage.dot)}
            style={{ width: `${(c.n / total) * 100}%` }}
            title={`${c.stage.label}: ${c.n}`}
          />
        ))}
    </div>
  )
}

/** Entradas × enviados ao RIP por dia: duas séries, uma escala, legenda escrita. */
function FlowChart({ jobs, days }: { jobs: Job[]; days: number }) {
  const buckets = useMemo(() => {
    const out: { key: string; label: string; in: number; out: number }[] = []
    const today = new Date()
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
      const key = d.toISOString().slice(0, 10)
      out.push({ key, label: d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }), in: 0, out: 0 })
    }
    const index = new Map(out.map((b, i) => [b.key, i]))
    const dayKey = (iso: string) => {
      const d = new Date(iso)
      return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().slice(0, 10)
    }
    for (const job of jobs) {
      const a = index.get(dayKey(job.createdAt))
      if (a !== undefined) out[a].in++
      if (job.sentToRipAt) {
        const b = index.get(dayKey(job.sentToRipAt))
        if (b !== undefined) out[b].out++
      }
    }
    return out
  }, [jobs, days])
  const max = Math.max(1, ...buckets.map((b) => Math.max(b.in, b.out)))
  const step = Math.ceil(days / 6)

  return (
    <div>
      <div className="mb-2 flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className={cn('h-2.5 w-2.5 rounded-sm', IN_BAR)} /> Entraram
        </span>
        <span className="flex items-center gap-1.5">
          <span className={cn('h-2.5 w-2.5 rounded-sm', OUT_BAR)} /> Enviados ao RIP
        </span>
        <span className="ml-auto tabular-nums">máx. {max} por dia</span>
      </div>
      <div className="flex h-36 items-end gap-1 border-b border-border">
        {buckets.map((b) => (
          <div
            key={b.key}
            className="group relative flex h-full flex-1 items-end justify-center gap-px"
            title={`${b.label}: ${b.in} entraram, ${b.out} enviados ao RIP`}
          >
            <div className={cn('w-1/2 max-w-[10px] rounded-t-[3px]', IN_BAR)} style={{ height: `${(b.in / max) * 100}%` }} />
            <div className={cn('w-1/2 max-w-[10px] rounded-t-[3px]', OUT_BAR)} style={{ height: `${(b.out / max) * 100}%` }} />
            <div className="pointer-events-none absolute inset-0 rounded bg-foreground/5 opacity-0 group-hover:opacity-100" />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1 text-[10px] tabular-nums text-muted-foreground">
        {buckets.map((b, i) => (
          <span key={b.key} className="flex-1 text-center">
            {i % step === 0 || i === buckets.length - 1 ? b.label : ''}
          </span>
        ))}
      </div>
    </div>
  )
}

/** Barras horizontais de uma série só (magnitude): rótulo e valor em texto. */
function BarList({ items }: { items: { label: string; value: number; detail?: string; tone?: string }[] }) {
  const max = Math.max(1, ...items.map((i) => i.value))
  return (
    <ul className="space-y-2.5">
      {items.map((item) => (
        <li key={item.label} title={item.detail}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-foreground">
              {item.label}
              {item.tone && (
                <span className="ml-1.5 rounded bg-red-500/15 px-1 text-[10px] font-semibold uppercase text-red-600 dark:text-red-400">
                  {item.tone}
                </span>
              )}
            </span>
            <span className="shrink-0 tabular-nums font-semibold text-foreground">{item.value}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${(item.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

const DECISIONS: { key: 'pending' | 'corrected' | 'approved' | 'rejected' | 'ignored'; label: string; bar: string }[] = [
  { key: 'corrected', label: 'Corrigidos', bar: 'bg-emerald-500' },
  { key: 'approved', label: 'Aceitos como exceção', bar: 'bg-sky-500' },
  { key: 'rejected', label: 'Devolvidos ao cliente', bar: 'bg-orange-500' },
  { key: 'ignored', label: 'Ignorados', bar: 'bg-slate-400' },
  { key: 'pending', label: 'Sem decisão', bar: 'bg-muted-foreground/30' },
]

/** Para onde foram os pontos analisados: barra empilhada com legenda e números. */
function DecisionBar({ decisions }: { decisions: DashboardStats['decisions'] }) {
  const total = DECISIONS.reduce((s, d) => s + (decisions[d.key] ?? 0), 0)
  if (!total) return <Empty>Nenhum ponto analisado no período.</Empty>
  return (
    <div className="space-y-3">
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-full">
        {DECISIONS.filter((d) => decisions[d.key]).map((d) => (
          <div
            key={d.key}
            className={cn('h-full first:rounded-l-full last:rounded-r-full', d.bar)}
            style={{ width: `${((decisions[d.key] ?? 0) / total) * 100}%` }}
            title={`${d.label}: ${decisions[d.key]}`}
          />
        ))}
      </div>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        {DECISIONS.map((d) => (
          <li key={d.key} className="flex items-center gap-2">
            <span className={cn('h-2.5 w-2.5 shrink-0 rounded-sm', d.bar)} />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{d.label}</span>
            <span className="tabular-nums font-semibold text-foreground">{decisions[d.key] ?? 0}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
