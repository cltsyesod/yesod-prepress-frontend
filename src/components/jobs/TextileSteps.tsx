import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, ChevronRight, CircleDashed, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { nestingService, type NestingRun } from '@/services/nestingService'
import type { AnalysisIssue } from '@/services/analysisJobsService'
import type { JobTicket } from '@/services/jobsService'
import type { ProductionProfile } from '@/types'

type State = 'done' | 'todo' | 'waiting'

interface Step {
  title: string
  state: State
  text: string
  action?: React.ReactNode
}

const luminance = (hex?: string) => {
  const v = (hex ?? '').replace('#', '')
  if (v.length !== 6) return null
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * O caminho de uma estampa: arte conferida → base branca → posição na peça (DTG) ou
 * folha (DTF) → enviada ao RIP. Cada etapa diz se está feita e leva à ação.
 */
export function TextileSteps({
  jobId,
  profile,
  ticket,
  analysed,
  analysing,
  issues,
  whiteApplied,
  sentToRipAt,
  busy,
  onGenerateWhite,
  onShowWhite,
  onSendToRip,
}: {
  jobId: string
  profile: ProductionProfile
  ticket: JobTicket
  analysed: boolean
  analysing: boolean
  issues: AnalysisIssue[]
  whiteApplied: boolean
  sentToRipAt: string | null
  busy: boolean
  onGenerateWhite: () => void
  onShowWhite: () => void
  onSendToRip: (sent: boolean) => void
}) {
  const dtf = profile.technology === 'dtf'
  const t = profile.textile ?? {}
  const [sheets, setSheets] = useState<NestingRun[] | null>(null)
  useEffect(() => {
    if (!dtf) return
    nestingService
      .runsForProject(jobId)
      .then((runs) => setSheets(runs.filter((r) => r.params?.dtfProfileId)))
      .catch(() => setSheets([]))
  }, [dtf, jobId, sentToRipAt])

  const pending = issues.filter((i) => i.status === 'pending' && i.severity !== 'informational')
  const blocking = pending.filter((i) => i.severity === 'critical').length
  const whiteIssue = issues.find((i) => i.rule_code === 'TEXTILE_WHITE_BASE')
  const lum = luminance(ticket.dtg?.garmentColor)
  const lightNoWhite = !dtf && lum !== null && lum >= 128 && t.whiteLight === 'none'

  const art: Step = analysing
    ? { title: 'Arte conferida', state: 'waiting', text: 'analisando…' }
    : !analysed
      ? { title: 'Arte conferida', state: 'todo', text: 'sem análise' }
      : pending.length
        ? {
            title: 'Arte conferida',
            state: 'todo',
            text: `${pending.length} ponto(s) para decidir${blocking ? `, ${blocking} impeditivo(s)` : ''}`,
            action: (
              <a href="#issues" className="text-xs font-medium text-primary hover:underline">
                Ver
              </a>
            ),
          }
        : { title: 'Arte conferida', state: 'done', text: 'sem pendências' }

  let white: Step
  if (t.whiteMode === 'rip') white = { title: 'Base branca', state: 'done', text: 'feita pelo RIP' }
  else if (lightNoWhite) white = { title: 'Base branca', state: 'done', text: 'peça clara: sem branco (perfil)' }
  else if (whiteApplied)
    white = {
      title: 'Base branca',
      state: 'done',
      text: 'gerada',
      action: (
        <button type="button" onClick={onShowWhite} className="text-xs font-medium text-primary hover:underline">
          Ver na peça
        </button>
      ),
    }
  else if (t.whiteMode === 'from_file')
    white = {
      title: 'Base branca',
      state: whiteIssue?.severity === 'critical' ? 'todo' : analysed ? 'done' : 'waiting',
      text: whiteIssue?.severity === 'critical' ? 'a arte não trouxe o branco' : 'vem na arte',
    }
  else if (whiteIssue?.fix)
    white = {
      title: 'Base branca',
      state: 'todo',
      text: 'a gerar',
      action: (
        <Button size="sm" className="h-7" disabled={busy} onClick={onGenerateWhite}>
          Gerar
        </Button>
      ),
    }
  else white = { title: 'Base branca', state: 'todo', text: whiteIssue ? whiteIssue.found_value || whiteIssue.title : 'defina no perfil' }

  const last = sheets?.[0]
  const place: Step = dtf
    ? last
      ? { title: 'Folha DTF', state: 'done', text: `na folha "${last.name || 'sem nome'}"` }
      : {
          title: 'Folha DTF',
          state: sheets === null ? 'waiting' : 'todo',
          text: `${ticket.dtf?.copies ?? 1} cópia(s) a montar`,
          action: (
            <Link to="/textil/folha" className="text-xs font-medium text-primary hover:underline">
              Montar
            </Link>
          ),
        }
    : ticket.dtg?.template
      ? { title: 'Posição na peça', state: 'done', text: ticket.dtg.template }
      : {
          title: 'Posição na peça',
          state: 'todo',
          text: 'escolha o gabarito',
          action: (
            <a href="#dtg-placement" className="text-xs font-medium text-primary hover:underline">
              Posicionar
            </a>
          ),
        }

  const ready = art.state === 'done' && white.state === 'done' && place.state === 'done'
  const rip: Step = sentToRipAt
    ? {
        title: 'Enviada ao RIP',
        state: 'done',
        text: new Date(sentToRipAt).toLocaleDateString('pt-BR'),
        action: (
          <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => onSendToRip(false)}>
            desfazer
          </button>
        ),
      }
    : dtf
      ? { title: 'Enviada ao RIP', state: 'todo', text: 'marcada junto com a folha' }
      : {
          title: 'Enviada ao RIP',
          state: 'todo',
          text: ready ? 'pronta' : 'falta concluir as etapas',
          action: (
            <Button size="sm" variant="outline" className="h-7" disabled={!ready || busy} onClick={() => onSendToRip(true)}>
              Marcar
            </Button>
          ),
        }

  const steps = [art, white, place, rip]
  return (
    <ol className="grid gap-2 rounded-xl border border-border bg-card p-2 sm:grid-cols-2 xl:grid-cols-4" aria-label="Etapas da estampa">
      {steps.map((step, i) => {
        const Icon = step.state === 'done' ? CheckCircle2 : step.state === 'waiting' ? Loader2 : CircleDashed
        return (
          <li key={step.title} className="flex items-center gap-2 rounded-lg px-2 py-1.5">
            <Icon
              className={cn(
                'h-5 w-5 shrink-0',
                step.state === 'done' ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground',
                step.state === 'waiting' && 'animate-spin',
              )}
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">
                {i + 1}. {step.title}
              </p>
              <p className="truncate text-xs text-muted-foreground">{step.text}</p>
            </div>
            {step.action}
            {i < steps.length - 1 && <ChevronRight className="hidden h-4 w-4 text-muted-foreground xl:block" />}
          </li>
        )
      })}
    </ol>
  )
}
