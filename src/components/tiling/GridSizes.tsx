import { useEffect, useState } from 'react'
import { Lock, LockOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { setSizes, sizes, toggleLock, type TilingProjectModel } from '@/domain/tiling'

/** Larguras das colunas e alturas das linhas, digitadas; cada uma pode ser travada. */
export function GridSizes({
  project,
  onChange,
}: {
  project: TilingProjectModel
  onChange: (next: TilingProjectModel) => void
}) {
  return (
    <div className="space-y-3">
      <SizeList
        label="Colunas (da esquerda para a direita)"
        values={sizes(project.grid.xs)}
        locked={project.grid.lockedColumns}
        prefix="C"
        onCommit={(values) => onChange(setSizes(project, 'vertical', values))}
        onLock={(i) => onChange(toggleLock(project, 'vertical', i))}
      />
      <SizeList
        label="Linhas (de cima para baixo)"
        // As linhas são guardadas de baixo para cima; na tela L1 é a de cima.
        values={sizes(project.grid.ys).reverse()}
        locked={project.grid.lockedRows.map((i) => project.grid.ys.length - 2 - i)}
        prefix="L"
        onCommit={(values) => onChange(setSizes(project, 'horizontal', [...values].reverse()))}
        onLock={(i) => onChange(toggleLock(project, 'horizontal', project.grid.ys.length - 2 - i))}
      />
      <p className="text-xs text-muted-foreground">
        A última coluna/linha fica com o que sobrar. Travadas não mudam ao arrastar as linhas.
      </p>
    </div>
  )
}

function SizeList({
  label,
  values,
  locked,
  prefix,
  onCommit,
  onLock,
}: {
  label: string
  values: number[]
  locked: number[]
  prefix: string
  onCommit: (values: number[]) => void
  onLock: (index: number) => void
}) {
  const [draft, setDraft] = useState(values.map((v) => String(Math.round(v * 10) / 10)))
  useEffect(() => setDraft(values.map((v) => String(Math.round(v * 10) / 10))), [values.join('|')]) // eslint-disable-line react-hooks/exhaustive-deps

  const commit = () => {
    const parsed = draft.map((v) => Number(v.replace(',', '.')))
    if (parsed.every((v) => Number.isFinite(v) && v > 0)) onCommit(parsed)
  }

  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {draft.map((value, i) => (
          <div key={i} className="flex items-center gap-1">
            <span className="w-7 shrink-0 text-xs text-muted-foreground">
              {prefix}
              {i + 1}
            </span>
            <Input
              className="h-8 px-2"
              inputMode="decimal"
              value={value}
              disabled={i === draft.length - 1}
              onChange={(e) => setDraft((d) => d.map((v, j) => (j === i ? e.target.value : v)))}
              onBlur={commit}
              onKeyDown={(e) => e.key === 'Enter' && commit()}
            />
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 shrink-0"
              title={locked.includes(i) ? 'Destravar' : 'Travar a medida'}
              onClick={() => onLock(i)}
            >
              {locked.includes(i) ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5 text-muted-foreground" />}
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}
