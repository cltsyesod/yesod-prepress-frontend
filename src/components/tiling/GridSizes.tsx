import { Lock, LockOpen } from 'lucide-react'
import { NumberField } from '@/components/tiling/fields'
import { setSizes, sizes, toggleLock, type TilingProjectModel } from '@/domain/tiling'

/** Larguras das colunas e alturas das linhas, digitadas; cada uma pode ser travada. */
export function GridSizes({
  project,
  onChange,
}: {
  project: TilingProjectModel
  onChange: (next: TilingProjectModel) => void
}) {
  const rows = project.grid.ys.length - 1
  return (
    <div className="grid grid-cols-2 gap-3">
      <SizeList
        title="Colunas"
        values={sizes(project.grid.xs)}
        locked={project.grid.lockedColumns}
        prefix="C"
        onCommit={(values) => onChange(setSizes(project, 'vertical', values))}
        onLock={(i) => onChange(toggleLock(project, 'vertical', i))}
      />
      <SizeList
        title="Linhas"
        // As linhas são guardadas de baixo para cima; na tela L1 é a de cima.
        values={sizes(project.grid.ys).reverse()}
        locked={project.grid.lockedRows.map((i) => rows - 1 - i)}
        prefix="L"
        onCommit={(values) => onChange(setSizes(project, 'horizontal', [...values].reverse()))}
        onLock={(i) => onChange(toggleLock(project, 'horizontal', rows - 1 - i))}
      />
    </div>
  )
}

function SizeList({
  title,
  values,
  locked,
  prefix,
  onCommit,
  onLock,
}: {
  title: string
  values: number[]
  locked: number[]
  prefix: string
  onCommit: (values: number[]) => void
  onLock: (index: number) => void
}) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] text-muted-foreground">{title}</p>
      {values.map((value, i) => {
        const last = i === values.length - 1
        return (
          <div key={i} className="flex items-center gap-1">
            <span className="w-6 shrink-0 text-[11px] font-medium tabular-nums text-muted-foreground">
              {prefix}
              {i + 1}
            </span>
            <NumberField
              className="min-w-0 flex-1"
              value={value}
              min={1}
              disabled={last}
              title={last ? 'A última fica com o que sobrar' : undefined}
              onCommit={(v) => v !== undefined && onCommit(values.map((x, j) => (j === i ? v : x)))}
            />
            <button
              type="button"
              className="flex h-7 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
              title={locked.includes(i) ? 'Medida travada: clique para destravar' : 'Travar a medida (não muda ao arrastar as linhas)'}
              disabled={last}
              onClick={() => onLock(i)}
            >
              {locked.includes(i) ? <Lock className="h-3.5 w-3.5 text-foreground" /> : <LockOpen className="h-3.5 w-3.5" />}
            </button>
          </div>
        )
      })}
    </div>
  )
}
