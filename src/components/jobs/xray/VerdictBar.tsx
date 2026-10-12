import { CheckCircle2, CircleAlert, Loader2, OctagonX, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { TONE_CLASS, toneOf } from '@/lib/xray'
import type { AnalysisIssue } from '@/services/analysisJobsService'

/**
 * Veredito do trabalho num relance: pode ir para produção, precisa de decisão ou está
 * bloqueado, com a contagem por cor e o atalho para as correções automáticas.
 */
export function VerdictBar({
  issues,
  autoFixes,
  onFixAll,
  fixing,
}: {
  issues: AnalysisIssue[]
  autoFixes: number
  onFixAll: () => void
  fixing: boolean
}) {
  const tone = toneOf(issues)
  const pending = issues.filter((i) => i.status === 'pending')
  const blocked = pending.filter((i) => i.severity === 'critical').length
  const decision = pending.filter((i) => i.severity === 'warning').length
  const info = issues.filter((i) => i.severity === 'informational').length
  const actionable = issues.filter((i) => i.severity !== 'informational')
  const decided = actionable.length - pending.filter((i) => i.severity !== 'informational').length

  const headline =
    tone === 'blocked'
      ? { icon: OctagonX, title: 'Não pode ir para produção', text: 'Há pontos que bloqueiam o arquivo.' }
      : tone === 'decision'
        ? { icon: CircleAlert, title: 'Precisa da sua decisão', text: 'O arquivo pode seguir depois que você decidir os pontos abaixo.' }
        : { icon: CheckCircle2, title: 'Pronto para produção', text: actionable.length ? 'Todos os pontos foram decididos.' : 'Nenhum problema encontrado.' }
  const style = TONE_CLASS[tone]
  const Icon = headline.icon

  return (
    <section className={cn('flex flex-col gap-3 rounded-lg border p-4 lg:flex-row lg:items-center', style.border, style.soft)}>
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <Icon className={cn('mt-0.5 h-7 w-7 shrink-0', style.text)} />
        <div className="min-w-0">
          <p className={cn('text-lg font-semibold leading-tight', style.text)}>{headline.title}</p>
          <p className="text-sm text-muted-foreground">{headline.text}</p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <Count tone="blocked" value={blocked} label="bloqueiam" />
            <Count tone="decision" value={decision} label="para decidir" />
            <Count tone="info" value={info} label="informações" />
            {actionable.length > 0 && <Count tone="ok" value={decided} label={`de ${actionable.length} decididos`} />}
          </div>
        </div>
      </div>
      {autoFixes > 0 && (
        <div className="flex shrink-0 items-center gap-3 rounded-md border border-primary/30 bg-card px-3 py-2">
          <div className="text-sm">
            <p className="font-medium text-foreground">
              {autoFixes} {autoFixes === 1 ? 'correção automática' : 'correções automáticas'}
            </p>
            <p className="text-xs text-muted-foreground">Gera uma versão corrigida; o original fica guardado.</p>
          </div>
          <Button size="sm" onClick={onFixAll} disabled={fixing}>
            {fixing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
            Corrigir tudo
          </Button>
        </div>
      )}
    </section>
  )
}

function Count({ tone, value, label }: { tone: keyof typeof TONE_CLASS; value: number; label: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5', value ? 'text-foreground' : 'text-muted-foreground')}>
      <span className={cn('h-2.5 w-2.5 rounded-full', TONE_CLASS[tone].dot, !value && 'opacity-40')} />
      <b className="font-semibold tabular-nums">{value}</b> {label}
    </span>
  )
}
