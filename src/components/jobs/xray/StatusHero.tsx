import { ArrowRight, CheckCircle2, CircleAlert, Download, Loader2, MessageSquareText, OctagonX, Send, Undo2, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { TONE_CLASS, toneOf } from '@/lib/xray'
import { fileSize } from '@/lib/xray-facts'
import type { AnalysisIssue } from '@/services/analysisJobsService'
import type { ProjectFile } from '@/types'

type AppliedFix = { id: string; label: string; details: string[] }

const HEADLINE = {
  blocked: { icon: OctagonX, title: 'Não pode ir para produção', text: 'Há pontos que impedem a impressão deste arquivo.' },
  decision: { icon: CircleAlert, title: 'Aguarda a sua decisão', text: 'O arquivo pode seguir assim que você decidir os pontos em aberto.' },
  ready: { icon: CheckCircle2, title: 'Pronto para produção', text: 'Tudo conferido ou decidido.' },
  sent: { icon: Send, title: 'Enviado ao RIP', text: 'A pré-impressão deste trabalho terminou.' },
}

/**
 * O topo da tela do trabalho: a situação em uma frase, quanto já foi decidido, o próximo
 * passo sugerido e o caminho do arquivo (cliente → sistema → produção).
 */
export function StatusHero({
  issues,
  autoFixes,
  fixing,
  correcting,
  original,
  delivered,
  fixes,
  downloadUrl,
  onFixAll,
  onMessage,
  onShowPending,
  sentToRip,
  onSendToRip,
}: {
  issues: AnalysisIssue[]
  autoFixes: number
  fixing: boolean
  correcting: boolean
  original: ProjectFile | null
  delivered: ProjectFile | null
  fixes: AppliedFix[]
  downloadUrl: string
  onFixAll: () => void
  onMessage: () => void
  onShowPending: () => void
  /** Quando e por quem foi enviado ao RIP (fim da pré-impressão). */
  sentToRip: { at: string; by: string } | null
  onSendToRip: (sent: boolean) => void
}) {
  const state = toneOf(issues)
  const key = sentToRip ? 'sent' : state === 'blocked' ? 'blocked' : state === 'decision' ? 'decision' : 'ready'
  const style = TONE_CLASS[key === 'ready' || key === 'sent' ? 'ok' : state]
  const head = HEADLINE[key]
  const Icon = head.icon

  const actionable = issues.filter((i) => i.severity !== 'informational')
  // Uma fatia por ponto: vermelho/amarelo enquanto em aberto, verde quando decidido.
  const slices = [...actionable].sort((a, b) => Number(a.status === 'pending') - Number(b.status === 'pending'))
  const decided = actionable.filter((i) => i.status !== 'pending').length
  const blocked = actionable.filter((i) => i.status === 'pending' && i.severity === 'critical').length
  const open = actionable.length - decided
  const info = issues.length - actionable.length

  const client = original ?? delivered
  const changed = !!delivered?.derived_from

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="space-y-4 p-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full', style.soft)}>
            <Icon className={cn('h-5 w-5', style.text)} />
          </div>
          <div className="min-w-0 flex-1 space-y-2.5">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-foreground">{head.title}</h2>
              <p className="text-sm text-muted-foreground">
                {sentToRip
                  ? `Em ${new Date(sentToRip.at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}${sentToRip.by ? ` por ${sentToRip.by}` : ''}.`
                  : head.text}
              </p>
            </div>
            {actionable.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex h-2 gap-1" aria-hidden>
                  {slices.map((issue) => (
                    <span
                      key={issue.id}
                      className={cn(
                        'flex-1 rounded-full',
                        issue.status !== 'pending' ? 'bg-emerald-500' : issue.severity === 'critical' ? 'bg-red-500' : 'bg-amber-500',
                      )}
                    />
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  <b className="font-semibold text-foreground">{decided}</b> de {actionable.length} pontos decididos
                  {blocked > 0 && <> · <span className={TONE_CLASS.blocked.text}>{blocked} bloqueiam</span></>}
                  {open - blocked > 0 && <> · <span className={TONE_CLASS.decision.text}>{open - blocked} para decidir</span></>}
                  {info > 0 && <> · {info} {info === 1 ? 'informação' : 'informações'}</>}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Próximo passo: o que mais adianta o trabalho agora. */}
        <div className="flex flex-col gap-2 [&>*]:w-full">
          {autoFixes > 0 && (
            <Button onClick={onFixAll} disabled={fixing || correcting} className="justify-start">
              {fixing || correcting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
              Aplicar {autoFixes} {autoFixes === 1 ? 'correção automática' : 'correções automáticas'}
            </Button>
          )}
          {open > 0 && (
            <Button variant="outline" onClick={onShowPending} className="justify-start">
              Decidir {open} {open === 1 ? 'ponto' : 'pontos'}
            </Button>
          )}
          {state === 'blocked' && (
            <Button variant="ghost" onClick={onMessage} className="justify-start">
              <MessageSquareText className="h-4 w-4" />
              Mensagem ao cliente
            </Button>
          )}
          {key === 'ready' && (
            <Button onClick={() => onSendToRip(true)} className="justify-start">
              <Send className="h-4 w-4" />
              Enviar ao RIP
            </Button>
          )}
          {key === 'sent' && (
            <Button variant="ghost" onClick={() => onSendToRip(false)} className="justify-start">
              <Undo2 className="h-4 w-4" />
              Desfazer envio ao RIP
            </Button>
          )}
          {(key === 'ready' || key === 'sent') && downloadUrl && (
            <Button asChild variant="outline">
              <a href={downloadUrl} target="_blank" rel="noreferrer">
                <Download className="h-4 w-4" />
                Baixar arquivo final
              </a>
            </Button>
          )}
        </div>
      </div>

      {/* Caminho do arquivo, numa linha. */}
      {client && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border bg-muted/40 px-4 py-2.5 text-xs">
          <span className="text-muted-foreground">Cliente enviou</span>
          <span className="font-medium text-foreground">{client.original_name}</span>
          <span className="text-muted-foreground">{fileSize(client.size_bytes)}</span>
          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
          {correcting ? (
            <span className="flex items-center gap-1.5 text-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> aplicando correções
            </span>
          ) : changed ? (
            <span className="text-foreground" title={fixes.map((f) => f.label).join(' · ')}>
              <Wand2 className="mr-1 inline h-3.5 w-3.5 text-primary" />
              {fixes.length} {fixes.length === 1 ? 'correção aplicada' : 'correções aplicadas'}
            </span>
          ) : (
            <span className="text-muted-foreground">sem alterações</span>
          )}
          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">Vai para a produção</span>
          <span className={cn('font-medium', changed ? 'text-primary' : 'text-foreground')}>
            {changed ? delivered?.original_name : 'o mesmo arquivo'}
          </span>
          {changed && <span className="text-muted-foreground">{fileSize(delivered?.size_bytes)}</span>}
        </div>
      )}
    </section>
  )
}
