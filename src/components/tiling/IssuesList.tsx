import { AlertTriangle, CircleCheck, XCircle } from 'lucide-react'
import type { Issue } from '@/domain/tiling'
import { cn } from '@/lib/utils'

/** Problemas do projeto: erros bloqueiam a exportação, avisos não. Clique leva ao painel. */
export function IssuesList({ issues, onSelectTile }: { issues: Issue[]; onSelectTile: (id: string) => void }) {
  if (!issues.length) {
    return (
      <p className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
        <CircleCheck className="h-4 w-4 text-emerald-600" />
        Nenhum problema: o projeto pode ser exportado.
      </p>
    )
  }
  const sorted = [...issues].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1))
  return (
    <ul className="text-xs">
      {sorted.map((issue, i) => (
        <li key={i}>
          <button
            type="button"
            disabled={!issue.tile}
            onClick={() => issue.tile && onSelectTile(issue.tile)}
            className={cn(
              'flex w-full items-start gap-2 border-b border-border px-3 py-1.5 text-left',
              issue.tile && 'hover:bg-accent/60',
            )}
          >
            {issue.severity === 'error' ? (
              <XCircle className="mt-px h-3.5 w-3.5 shrink-0 text-destructive" />
            ) : (
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-amber-500" />
            )}
            <span className="w-14 shrink-0 font-medium text-muted-foreground">{issue.tile ?? 'Projeto'}</span>
            <span className="text-foreground">{issue.message}</span>
            <span className="ml-auto shrink-0 pl-2 text-[11px] text-muted-foreground">
              {issue.severity === 'error' ? 'bloqueia a exportação' : 'aviso'}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
