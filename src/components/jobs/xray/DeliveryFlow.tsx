import { ArrowRight, FileInput, FileOutput, Loader2, Wand2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { megabytes } from '@/lib/xray'
import type { ProjectFile } from '@/types'

type AppliedFix = { id: string; label: string; details: string[] }

/**
 * Do cliente à produção: o arquivo que chegou, o que o sistema fez nele e o arquivo que
 * de fato vai para a produção.
 */
export function DeliveryFlow({
  original,
  delivered,
  fixes,
  correcting,
}: {
  original: ProjectFile | null
  delivered: ProjectFile | null
  fixes: AppliedFix[]
  correcting: boolean
}) {
  const client = original ?? delivered
  const changed = !!delivered?.derived_from
  return (
    <section className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.2fr)_auto_minmax(0,1fr)] md:items-stretch">
      <Step
        icon={FileInput}
        tone="neutral"
        title="Arquivo do cliente"
        lines={client ? [client.original_name, `${client.extension} · ${megabytes(client.size_bytes)}`] : ['—']}
      />
      <Arrow />
      <div className="rounded-lg border border-border bg-card px-3 py-2">
        <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Wand2 className="h-3.5 w-3.5" />
          O que o sistema fez
        </p>
        {correcting ? (
          <p className="flex items-center gap-2 text-sm text-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Aplicando correções…
          </p>
        ) : fixes.length ? (
          <ul className="space-y-0.5 text-sm">
            {fixes.map((fix, i) => (
              <li key={`${fix.id}-${i}`} className="flex items-start gap-2" title={fix.details.join(' · ')}>
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                <span className="text-foreground">{fix.label}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Nada: o arquivo segue como o cliente enviou.</p>
        )}
      </div>
      <Arrow />
      <Step
        icon={FileOutput}
        tone={changed ? 'changed' : 'neutral'}
        title="Vai para a produção"
        lines={
          delivered
            ? [
                delivered.original_name,
                `${delivered.extension} · ${megabytes(delivered.size_bytes)}${changed ? ' · versão corrigida' : ' · igual ao enviado'}`,
              ]
            : ['—']
        }
      />
    </section>
  )
}

function Step({
  icon: Icon,
  title,
  lines,
  tone,
}: {
  icon: typeof FileInput
  title: string
  lines: string[]
  tone: 'neutral' | 'changed'
}) {
  return (
    <div className={cn('rounded-lg border px-3 py-2', tone === 'changed' ? 'border-primary/40 bg-primary/5' : 'border-border bg-card')}>
      <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {title}
      </p>
      <p className="truncate text-sm font-medium text-foreground" title={lines[0]}>
        {lines[0]}
      </p>
      {lines[1] && <p className="text-xs text-muted-foreground">{lines[1]}</p>}
    </div>
  )
}

const Arrow = () => (
  <div className="hidden items-center justify-center md:flex">
    <ArrowRight className="h-4 w-4 text-muted-foreground" />
  </div>
)
