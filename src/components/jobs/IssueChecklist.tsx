import { useState } from 'react'
import { Check, ChevronDown, CircleAlert, Info, OctagonX, RotateCcw, Undo2, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import type { AnalysisIssue } from '@/services/analysisJobsService'

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

interface IssueChecklistProps {
  issues: AnalysisIssue[]
  onDecide: (issueId: string, status: string, reason?: string) => Promise<void>
  onShowPage: (page: number) => void
  /** Aplica a correção automática oferecida pela ocorrência. */
  onFix: (issue: AnalysisIssue) => Promise<void>
  fixing: boolean
}

export function IssueChecklist({ issues, onDecide, onShowPage, onFix, fixing }: IssueChecklistProps) {
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
}: {
  issue: AnalysisIssue
  informational: boolean
  onDecide: IssueChecklistProps['onDecide']
  onShowPage: IssueChecklistProps['onShowPage']
  onFix: IssueChecklistProps['onFix']
  fixing: boolean
}) {
  const [open, setOpen] = useState(false)
  const [askReason, setAskReason] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const decided = issue.status !== 'pending'

  const decide = async (status: string, why?: string) => {
    setBusy(true)
    try {
      await onDecide(issue.id, status, why)
      setAskReason(false)
      setReason('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <li
      className={cn(
        'rounded-md border border-border bg-card transition-opacity',
        decided && 'opacity-60',
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
            {issue.fix && !decided && (
              <Wand2 className="h-3.5 w-3.5 shrink-0 text-primary" aria-label="Correção automática disponível" />
            )}
          </p>
          <p className="text-sm text-muted-foreground">
            {issue.found_value}
            {issue.expected_value && !informational && (
              <span className="text-content-muted"> · esperado: {issue.expected_value}</span>
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
          {issue.description && <p className="text-content">{issue.description}</p>}
          {issue.recommendation && (
            <p className="text-foreground">
              <span className="font-medium">Como resolver: </span>
              {issue.recommendation}
            </p>
          )}

          {issue.fix && !decided && (
            <div className="flex flex-col gap-2 rounded-md bg-primary/5 p-2.5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">
                {issue.fix.preview ||
                  (issue.fix.target === 'pdf'
                    ? 'Gera uma versão corrigida; o original fica guardado.'
                    : 'Atualiza a ficha do trabalho e reanalisa.')}
              </p>
              <Button size="sm" className="shrink-0" disabled={busy || fixing} onClick={() => onFix(issue)}>
                <Wand2 className="h-4 w-4" />
                {issue.fix.label}
              </Button>
            </div>
          )}

          {!informational &&
            (decided ? (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => decide('pending')}>
                <Undo2 className="h-4 w-4" />
                Desfazer decisão
              </Button>
            ) : askReason ? (
              <div className="space-y-2">
                <Textarea
                  autoFocus
                  rows={2}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Por que aceitar? Ex.: painel visto a 15 m, 120 ppi é suficiente"
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={busy || !reason.trim()}
                    onClick={() => decide('approved', reason.trim())}
                  >
                    Registrar exceção
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setAskReason(false)}>
                    Cancelar
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled={busy} onClick={() => decide('corrected')}>
                  <Check className="h-4 w-4" />
                  Corrigido
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => setAskReason(true)}>
                  Aceitar como exceção
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => decide('rejected')}>
                  <RotateCcw className="h-4 w-4" />
                  Devolver ao cliente
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => decide('ignored')}>
                  Ignorar
                </Button>
              </div>
            ))}
        </div>
      )}
    </li>
  )
}
