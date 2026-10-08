import { Gauge } from 'lucide-react'
import type { JobMetrics } from '@/services/analysisJobsService'

const STEP_LABELS: Record<string, string> = {
  download: 'download',
  corrections: 'conversão/correções',
  analysis: 'análise',
  build: 'geração dos arquivos',
  upload: 'envio',
}

const seconds = (value: number) => `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s`
const megabytes = (bytes: number) => `${(bytes / 1_048_576).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`

/** Desempenho de um processamento: tempo total e por etapa, tamanhos e memória. */
export function JobMetricsLine({ metrics, className }: { metrics?: JobMetrics | null; className?: string }) {
  if (!metrics || metrics.totalSeconds === undefined) return null
  const steps = Object.entries(metrics.seconds ?? {})
    .filter(([, v]) => v > 0)
    .map(([key, v]) => `${STEP_LABELS[key] ?? key} ${seconds(v)}`)
  const sizes =
    metrics.sourceBytes !== undefined
      ? `arquivo ${megabytes(metrics.sourceBytes)}${metrics.outputBytes ? ` → gerado ${megabytes(metrics.outputBytes)}` : ''}`
      : ''
  return (
    <p
      className={className ?? 'flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground'}
      title="Medido no analisador: ajuda a acompanhar o desempenho do sistema"
    >
      <Gauge className="h-3.5 w-3.5" />
      <span>
        Processado em <b className="font-medium text-foreground">{seconds(metrics.totalSeconds)}</b>
        {steps.length ? ` (${steps.join(' · ')})` : ''}
      </span>
      {sizes && <span>· {sizes}</span>}
      {metrics.panels ? <span>· {metrics.panels} painéis</span> : null}
      {metrics.peakMemoryMb ? <span>· memória até {Math.round(metrics.peakMemoryMb)} MB</span> : null}
    </p>
  )
}
