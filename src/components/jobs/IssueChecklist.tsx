import { useEffect, useRef, useState } from 'react'
import {
  Check,
  ChevronDown,
  CircleAlert,
  Info,
  Loader2,
  OctagonX,
  Send,
  ShieldCheck,
  Undo2,
  Wand2,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { solutionsFor, type Solution } from '@/lib/issue-solutions'
import type { AnalysisIssue, IssueFix } from '@/services/analysisJobsService'

// Níveis do manual de preflight: bloqueante, decisão do operador e informação.
const GROUPS = [
  {
    severity: 'critical',
    title: 'Bloqueia a produção',
    icon: OctagonX,
    tone: 'text-red-600 dark:text-red-400',
  },
  {
    severity: 'warning',
    title: 'Precisa de decisão',
    icon: CircleAlert,
    tone: 'text-amber-600 dark:text-amber-400',
  },
  {
    severity: 'informational',
    title: 'Informações do arquivo',
    icon: Info,
    tone: 'text-blue-600 dark:text-blue-400',
  },
] as const

const DECISIONS: Record<string, string> = {
  approved: 'Aceito como exceção',
  corrected: 'Corrigido',
  ignored: 'Ignorado',
  rejected: 'Devolvido ao cliente',
}

// Cada tipo de saída tem a sua cor e o seu verbo, iguais em todas as ocorrências.
const KIND: Record<Solution['kind'], { icon: LucideIcon; action: string; tone: string }> = {
  fix: { icon: Wand2, action: 'Aplicar', tone: 'bg-primary/10 text-primary' },
  client: { icon: Send, action: 'Pedir ao cliente', tone: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' },
  accept: { icon: ShieldCheck, action: 'Aceitar', tone: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
}

// Sem catálogo para a regra: as saídas de sempre, sem texto pronto.
const GENERIC: Solution[] = [
  { kind: 'client', title: 'Pedir ao cliente', text: 'Devolve o ponto com o pedido abaixo.', request: '' },
  { kind: 'accept', title: 'Aceitar como exceção', text: 'Segue assim, com o motivo registrado.', reason: '' },
]

interface IssueChecklistProps {
  issues: AnalysisIssue[]
  onDecide: (issueId: string, status: string, reason?: string) => Promise<void>
  onShowPage: (page: number) => void
  /** Aplica uma correção (a da ocorrência ou uma do catálogo). */
  onFix: (issue: AnalysisIssue, fix?: IssueFix) => Promise<void>
  fixing: boolean
  /** Ocorrência escolhida no raio-x: abre e rola até ela. */
  focusId?: string | null
}

export function IssueChecklist({ issues, onDecide, onShowPage, onFix, fixing, focusId }: IssueChecklistProps) {
  if (!issues.length) {
    return (
      <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-6 text-center">
        <Check className="mx-auto mb-2 h-6 w-6 text-emerald-600" />
        <p className="font-medium text-foreground">Nenhum problema encontrado</p>
        <p className="text-sm text-muted-foreground">
          O arquivo atende à ficha do trabalho e ao perfil de produção.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {GROUPS.map((group) => {
        const items = issues.filter((i) => i.severity === group.severity)
        if (!items.length) return null
        const pending = items.filter((i) => i.status === 'pending').length
        const Icon = group.icon
        return (
          <section key={group.severity} className="space-y-2">
            <h2 className={cn('flex items-center gap-2 text-sm font-semibold', group.tone)}>
              <Icon className="h-4 w-4" />
              {group.title}
              <span className="font-normal text-muted-foreground">
                {group.severity === 'informational'
                  ? `(${items.length})`
                  : `(${pending} de ${items.length} pendentes)`}
              </span>
            </h2>
            <ul className="space-y-2">
              {items.map((issue) => (
                <IssueItem
                  key={issue.id}
                  issue={issue}
                  informational={group.severity === 'informational'}
                  onDecide={onDecide}
                  onShowPage={onShowPage}
                  onFix={onFix}
                  fixing={fixing}
                  focused={focusId === issue.id}
                />
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

function IssueItem({
  issue,
  informational,
  onDecide,
  onShowPage,
  onFix,
  fixing,
  focused,
}: {
  issue: AnalysisIssue
  informational: boolean
  onDecide: IssueChecklistProps['onDecide']
  onShowPage: IssueChecklistProps['onShowPage']
  onFix: IssueChecklistProps['onFix']
  fixing: boolean
  focused?: boolean
}) {
  const [open, setOpen] = useState(!!focused)
  const ref = useRef<HTMLLIElement>(null)
  useEffect(() => {
    if (!focused) return
    setOpen(true)
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [focused])
  const [busy, setBusy] = useState(false)
  const decided = issue.status !== 'pending'
  const catalogue = solutionsFor(issue)
  const solutions = informational ? catalogue.filter((s) => s.kind === 'fix') : catalogue.length ? catalogue : GENERIC
  const hasFix = solutions.some((s) => s.kind === 'fix')

  const decide = async (status: string, why?: string) => {
    setBusy(true)
    try {
      await onDecide(issue.id, status, why)
    } finally {
      setBusy(false)
    }
  }

  return (
    <li
      ref={ref}
      className={cn(
        'rounded-lg border border-border bg-card transition-opacity',
        decided && 'opacity-60',
        focused && 'ring-2 ring-primary/50',
      )}
    >
      <button
        className="flex w-full items-start gap-3 px-3 py-2.5 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 font-medium text-foreground">
            {issue.title}
            {hasFix && !decided && (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                <Wand2 className="h-3 w-3" />
                corrigível
              </span>
            )}
          </p>
          <p className="text-sm text-muted-foreground">
            {issue.found_value}
            {issue.expected_value && !informational && (
              <span className="text-muted-foreground/80"> · esperado: {issue.expected_value}</span>
            )}
          </p>
          {decided && (
            <p className="mt-1 text-xs font-medium text-foreground">
              {DECISIONS[issue.status] ?? issue.status}
              {issue.decision_reason && ` — ${issue.decision_reason}`}
            </p>
          )}
        </div>
        {issue.page > 0 && (
          <span
            role="link"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation()
              onShowPage(issue.page)
            }}
            onKeyDown={(e) => e.key === 'Enter' && onShowPage(issue.page)}
            className="shrink-0 rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
          >
            pág. {issue.page}
          </span>
        )}
        <ChevronDown
          className={cn('mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div className="space-y-3 border-t border-border px-3 py-3 text-sm">
          {issue.description && <p className="text-muted-foreground">{issue.description}</p>}
          {informational && !solutions.length && issue.recommendation && (
            <p className="text-foreground">{issue.recommendation}</p>
          )}

          {decided ? (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => decide('pending')}>
              <Undo2 className="h-4 w-4" />
              Desfazer decisão
            </Button>
          ) : (
            solutions.length > 0 && (
              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Como resolver</p>
                <ol className="space-y-2">
                  {solutions.map((solution, index) => (
                    <SolutionRow
                      key={`${solution.kind}-${index}`}
                      solution={solution}
                      disabled={busy || fixing}
                      onFix={(fix) => onFix(issue, fix)}
                      onDecide={decide}
                    />
                  ))}
                </ol>
                {!informational && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-xs text-muted-foreground">
                    <button type="button" disabled={busy} onClick={() => decide('corrected')} className="hover:text-foreground">
                      <Check className="mr-1 inline h-3.5 w-3.5" />
                      Já corrigi fora do sistema
                    </button>
                    <button type="button" disabled={busy} onClick={() => decide('ignored')} className="hover:text-foreground">
                      Ignorar este ponto
                    </button>
                  </div>
                )}
              </div>
            )
          )}
        </div>
      )}
    </li>
  )
}

/** Uma saída: o que faz, e o botão. Pedir e aceitar abrem o texto pronto para editar. */
function SolutionRow({
  solution,
  disabled,
  onFix,
  onDecide,
}: {
  solution: Solution
  disabled: boolean
  onFix: (fix: IssueFix) => Promise<void>
  onDecide: (status: string, why?: string) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const [running, setRunning] = useState(false)
  const style = KIND[solution.kind]
  const Icon = style.icon

  const start = async () => {
    if (solution.kind === 'fix') {
      setRunning(true)
      try {
        await onFix(solution.fix)
      } finally {
        setRunning(false)
      }
      return
    }
    setText(solution.kind === 'client' ? solution.request : solution.reason)
    setEditing(true)
  }

  const confirm = async () => {
    await onDecide(solution.kind === 'client' ? 'rejected' : 'approved', text.trim())
    setEditing(false)
  }

  return (
    <li className="rounded-md border border-border bg-background/40 p-2.5">
      <div className="flex items-start gap-3">
        <span className={cn('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md', style.tone)}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">{solution.title}</p>
          <p className="text-xs text-muted-foreground">{solution.text}</p>
        </div>
        {!editing && (
          <Button
            size="sm"
            variant={solution.kind === 'fix' ? 'default' : 'outline'}
            className="shrink-0"
            disabled={disabled}
            onClick={start}
          >
            {running && <Loader2 className="h-4 w-4 animate-spin" />}
            {style.action}
          </Button>
        )}
      </div>
      {editing && (
        <div className="mt-2 space-y-2 pl-10">
          <Textarea
            autoFocus
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={solution.kind === 'client' ? 'O que o cliente precisa fazer' : 'Por que aceitar'}
          />
          <p className="text-[11px] text-muted-foreground">
            {solution.kind === 'client'
              ? 'Este pedido entra na mensagem ao cliente.'
              : 'O motivo fica registrado no trabalho.'}
          </p>
          <div className="flex gap-2">
            <Button size="sm" disabled={disabled || !text.trim()} onClick={confirm}>
              {solution.kind === 'client' ? 'Devolver ao cliente' : 'Registrar exceção'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </li>
  )
}
