import { Input } from '@/components/ui/input'
import { EDGES, type Edge, type Edges } from '@/domain/tiling'

const LABELS: Record<Edge, string> = { top: 'Cima', right: 'Direita', bottom: 'Baixo', left: 'Esquerda' }

const parse = (value: string): number | undefined => {
  if (value.trim() === '') return undefined
  const n = Number(value.replace(',', '.'))
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

/**
 * Valor por borda (mm). Com `placeholder`, campo vazio = usa o padrão do projeto
 * (o padrão aparece apagado no campo).
 */
export function EdgesInput({
  value,
  placeholder,
  onChange,
  disabled,
}: {
  value: Partial<Edges>
  placeholder?: Edges
  onChange: (edge: Edge, value: number | undefined) => void
  disabled?: Partial<Record<Edge, boolean>>
}) {
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {EDGES.map((edge) => (
        <label key={edge} className="space-y-0.5">
          <span className="block text-[11px] text-muted-foreground">{LABELS[edge]}</span>
          <Input
            className="h-8 px-2"
            inputMode="decimal"
            disabled={disabled?.[edge]}
            value={value[edge] ?? ''}
            placeholder={placeholder ? String(Math.round(placeholder[edge] * 10) / 10) : '0'}
            onChange={(e) => onChange(edge, parse(e.target.value))}
          />
        </label>
      ))}
    </div>
  )
}
