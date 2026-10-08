import { NumberField } from '@/components/tiling/fields'
import { type Edge, type Edges } from '@/domain/tiling'

const LABELS: Record<Edge, string> = { top: 'Cima', right: 'Direita', bottom: 'Baixo', left: 'Esquerda' }

/**
 * Valor por borda (mm), em cruz em volta do painel. Com `placeholder`, campo vazio = usa o
 * padrão do projeto (o padrão aparece apagado no campo).
 */
export function EdgesInput({
  value,
  placeholder,
  onChange,
}: {
  value: Partial<Edges>
  placeholder?: Edges
  onChange: (edge: Edge, value: number | undefined) => void
}) {
  const cell = (edge: Edge) => (
    <NumberField
      unit=""
      title={LABELS[edge]}
      value={value[edge]}
      allowEmpty={!!placeholder}
      placeholder={placeholder ? String(Math.round(placeholder[edge] * 10) / 10).replace('.', ',') : '0'}
      onCommit={(v) => onChange(edge, placeholder ? v : (v ?? 0))}
    />
  )
  return (
    <div className="grid grid-cols-[1fr_1fr_1fr] items-center gap-1">
      <span />
      {cell('top')}
      <span />
      {cell('left')}
      <div className="mx-auto flex h-7 w-full items-center justify-center rounded-sm border border-dashed border-muted-foreground/50 text-[10px] text-muted-foreground">
        mm
      </div>
      {cell('right')}
      <span />
      {cell('bottom')}
      <span />
    </div>
  )
}
