import { cn } from '@/lib/utils'
import { finalSize, megabytes, minBleed, num, type FileProfile } from '@/lib/xray'

type Row = { label: string; value: (p: FileProfile) => string }

const ROWS: Row[] = [
  { label: 'Tamanho final', value: finalSize },
  { label: 'Páginas', value: (p) => String(p.document?.pages ?? p.pages?.length ?? '—') },
  {
    label: 'Formato final (TrimBox)',
    value: (p) => ((p.pages ?? []).every((pg) => pg.hasTrimBox) ? 'definido' : 'não definido'),
  },
  {
    label: 'Sangria (menor lado)',
    value: (p) => {
      const b = minBleed(p)
      return b ? `${num(Math.min(b.top, b.right, b.bottom, b.left))} mm` : 'sem BleedBox'
    },
  },
  {
    label: 'Menor ppi no tamanho final',
    value: (p) => (p.images?.minFinalPpi != null ? `${num(p.images.minFinalPpi, 0)} ppi` : p.images?.count ? '—' : 'sem imagens'),
  },
  {
    label: 'Faca',
    value: (p) => {
      const die = (p.pages ?? []).find((pg) => pg.dieLine)
      const names = p.colors?.technicalSpots ?? []
      return die ? `sim${names.length ? ` (${names.join(', ')})` : ''}` : 'não'
    },
  },
  { label: 'Cores especiais', value: (p) => (p.colors?.spots.length ? p.colors.spots.join(', ') : 'nenhuma') },
  { label: 'Cor dos vetores', value: (p) => (p.colors ? `CMYK ${p.colors.cmykOperators} · RGB ${p.colors.rgbOperators}` : '—') },
  { label: 'Perfil de saída', value: (p) => p.colors?.outputIntent || 'não declarado' },
  { label: 'Fontes não incorporadas', value: (p) => String(p.fonts?.notEmbedded ?? 0) },
  { label: 'Tamanho do arquivo', value: (p) => megabytes(p.document?.fileBytes) },
]

/** O arquivo do cliente ao lado do que vai para a produção; o que mudou aparece destacado. */
export function CompareTable({ client, delivered }: { client: FileProfile; delivered: FileProfile }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-[13px]">
        <thead className="bg-muted text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-1.5 font-medium">Característica</th>
            <th className="px-3 py-1.5 font-medium">Cliente enviou</th>
            <th className="px-3 py-1.5 font-medium">Vai para a produção</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => {
            const before = row.value(client)
            const after = row.value(delivered)
            const changed = before !== after
            return (
              <tr key={row.label} className="border-t border-border">
                <td className="px-3 py-1.5 text-muted-foreground">{row.label}</td>
                <td className={cn('px-3 py-1.5 tabular-nums', changed ? 'text-muted-foreground line-through decoration-muted-foreground/50' : 'text-foreground')}>
                  {before}
                </td>
                <td className={cn('px-3 py-1.5 tabular-nums', changed ? 'font-medium text-primary' : 'text-foreground')}>
                  {changed && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-primary align-middle" />}
                  {after}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
