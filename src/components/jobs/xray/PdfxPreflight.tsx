import { CheckCircle2, MinusCircle, XCircle, AlertTriangle } from 'lucide-react'
import type { FileProfile } from '@/lib/xray'
import { cn } from '@/lib/utils'

/**
 * Preflight PDF/X-4 (ISO 15930-7): cada exigência do padrão com passa / falha / não se
 * aplica e o motivo. Não substitui um validador certificado, e diz isso.
 */
export function PdfxPreflight({ profile }: { profile: FileProfile }) {
  const report = profile.pdfx4
  if (!report) return null
  if (!report.checks?.length) {
    return (
      <p className="text-xs text-muted-foreground">
        Preflight PDF/X-4 indisponível{report.error ? `: ${report.error}` : ''}. Reanalise o arquivo.
      </p>
    )
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold text-foreground">Preflight {report.standard}</h4>
        <span
          className={cn(
            'rounded px-2 py-0.5 text-xs font-medium',
            report.conforms
              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
              : 'bg-red-500/15 text-red-600 dark:text-red-400',
          )}
        >
          {report.conforms
            ? `Atende${report.warnings ? ` (${report.warnings} aviso${report.warnings > 1 ? 's' : ''})` : ''}`
            : `Não atende: ${report.errors} erro${report.errors > 1 ? 's' : ''}`}
        </span>
      </div>
      <ul className="divide-y divide-border rounded-lg border border-border text-xs">
        {report.checks.map((check) => {
          const Icon =
            check.ok === null ? MinusCircle : check.ok ? CheckCircle2 : check.severity === 'error' ? XCircle : AlertTriangle
          const color =
            check.ok === null
              ? 'text-muted-foreground'
              : check.ok
                ? 'text-emerald-600 dark:text-emerald-400'
                : check.severity === 'error'
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-amber-600 dark:text-amber-400'
          return (
            <li key={check.id} className="flex items-start gap-2 px-3 py-1.5">
              <Icon className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', color)} />
              <span className="flex-1 text-foreground">{check.label}</span>
              <span className="max-w-[45%] text-right text-muted-foreground">{check.detail}</span>
            </li>
          )
        })}
      </ul>
      <p className="text-[11px] text-muted-foreground">
        {report.declared ? `O arquivo se declara ${report.declared}. ` : ''}
        Conferência das exigências do padrão no próprio arquivo; não substitui um validador certificado.
      </p>
    </div>
  )
}
