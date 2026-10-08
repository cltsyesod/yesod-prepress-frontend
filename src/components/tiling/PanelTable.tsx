import { ROTATION_LABEL } from '@/components/tiling/TileInspector'
import { fmtSize } from '@/components/tiling/fields'
import type { Issue, TileGeometry } from '@/domain/tiling'
import { cn } from '@/lib/utils'

/** Todos os painéis numa tabela: o que cada um cobre, imprime e ocupa, e se está pronto. */
export function PanelTable({
  tiles,
  issues,
  selected,
  onSelect,
}: {
  tiles: TileGeometry[]
  issues: Issue[]
  selected: string[]
  onSelect: (key: string, additive: boolean) => void
}) {
  const problems = (id: string) => issues.filter((i) => i.tile === id)
  return (
    <table className="w-full border-separate border-spacing-0 text-xs">
      <thead className="sticky top-0 z-10 bg-muted text-left text-[11px] font-medium text-muted-foreground">
        <tr>
          {['Nº', 'Posição', 'Arquivo', 'Área', 'Instalação', 'Cobre (mm)', 'Impresso (mm)', 'Físico (mm)', 'Na mídia', 'Situação'].map((h, i) => (
            <th key={h} className={cn('whitespace-nowrap border-b border-border px-2 py-1.5 font-medium', i >= 5 && i <= 7 && 'text-right')}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {tiles.map((t) => {
          const list = problems(t.id)
          const error = list.find((i) => i.severity === 'error')
          const warning = list.find((i) => i.severity === 'warning')
          const isSelected = selected.includes(t.key)
          return (
            <tr
              key={t.key}
              onClick={(e) => onSelect(t.key, e.shiftKey || e.ctrlKey || e.metaKey)}
              className={cn(
                'cursor-pointer tabular-nums',
                isSelected ? 'bg-primary/10' : 'hover:bg-accent/60',
                !t.enabled && 'text-muted-foreground',
              )}
            >
              <td className="border-b border-border px-2 py-1 font-semibold">{t.enabled ? String(t.number).padStart(2, '0') : '—'}</td>
              <td className="border-b border-border px-2 py-1">{t.id}</td>
              <td className="max-w-[220px] truncate border-b border-border px-2 py-1" title={t.name}>
                {t.enabled ? t.name : ''}
              </td>
              <td className="max-w-[140px] truncate border-b border-border px-2 py-1">{t.zone || ''}</td>
              <td className="border-b border-border px-2 py-1">{t.install ? `${t.install}º` : ''}</td>
              <td className="border-b border-border px-2 py-1 text-right">{fmtSize(t.logical)}</td>
              <td className="border-b border-border px-2 py-1 text-right">{t.enabled ? fmtSize(t.print) : ''}</td>
              <td className="border-b border-border px-2 py-1 text-right font-medium">{t.enabled ? fmtSize(t.physical) : ''}</td>
              <td className="whitespace-nowrap border-b border-border px-2 py-1">{t.enabled ? ROTATION_LABEL[t.rotation] : ''}</td>
              <td className="whitespace-nowrap border-b border-border px-2 py-1">
                {!t.enabled ? (
                  <Status tone="muted">Não imprime</Status>
                ) : error ? (
                  <Status tone="error" title={error.message}>Erro</Status>
                ) : warning ? (
                  <Status tone="warning" title={warning.message}>Aviso</Status>
                ) : (
                  <Status tone="ok">Pronto</Status>
                )}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function Status({ tone, title, children }: { tone: 'ok' | 'error' | 'warning' | 'muted'; title?: string; children: string }) {
  return (
    <span className="inline-flex items-center gap-1.5" title={title}>
      <span
        className={cn(
          'h-2 w-2 rounded-full',
          tone === 'ok' && 'bg-emerald-500',
          tone === 'error' && 'bg-destructive',
          tone === 'warning' && 'bg-amber-500',
          tone === 'muted' && 'bg-muted-foreground/40',
        )}
      />
      {children}
    </span>
  )
}
