import { useMemo, useRef, useState } from 'react'
import { Copy, RotateCcw, RotateCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ManualPlacement, NestingRun } from '@/services/nestingService'

type Point = [number, number]

/** Contorno girado em torno da origem (mesma conta do analisador). */
function rotated(ring: Point[], degrees: number): Point[] {
  const a = (degrees * Math.PI) / 180
  const c = Math.cos(a)
  const s = Math.sin(a)
  return ring.map(([x, y]) => [x * c - y * s, x * s + y * c])
}

function bounds(ring: Point[]) {
  const xs = ring.map((p) => p[0])
  const ys = ring.map((p) => p[1])
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
}

/** Contorno na posição da peça: canto inferior esquerdo da peça girada em (x, y). */
export function placedRing(ring: Point[], p: Pick<ManualPlacement, 'rotation' | 'xMm' | 'yMm'>): Point[] {
  const r = rotated(ring, p.rotation)
  const b = bounds(r)
  return r.map(([x, y]) => [x - b.minX + p.xMm, y - b.minY + p.yMm])
}

/**
 * Edição da folha à mão: mover (arrastar ou setas), girar, duplicar e apagar peças. A tela
 * só avisa sobreposições pelo retângulo de cada peça; quem confere a geometria real
 * (contorno, espaçamento e margens) é o analisador ao gerar a folha, e ele recusa com a
 * lista do que corrigir em vez de ajustar sozinho.
 */
export function SheetEditor({
  run,
  onApply,
  onCancel,
  busy,
}: {
  run: NestingRun
  onApply: (placements: ManualPlacement[]) => void
  onCancel: () => void
  busy: boolean
}) {
  const result = run.result ?? {}
  const shapes = (result.shapes ?? {}) as Record<string, Point[]>
  const material = run.params.material
  const step = run.params.rotation?.allow ? run.params.rotation.stepDegrees || 90 : 90
  const gap = material.gapMm ?? 0
  const margin = material.marginMm ?? 0
  const [pieces, setPieces] = useState<ManualPlacement[]>(() =>
    (result.placements ?? []).map(({ key, copy, sheet, rotation, xMm, yMm }) => ({ key, copy, sheet, rotation, xMm, yMm })),
  )
  const [sheet, setSheet] = useState(1)
  const [selected, setSelected] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<{ index: number; startX: number; startY: number; x: number; y: number } | null>(null)
  const labels = new Map(run.items.map((i) => [i.fileId, i.label]))
  const labelOf = (key: string) => labels.get(key.split('#')[0]) ?? key

  const sheets = Math.max(1, ...pieces.map((p) => p.sheet))
  const placed = useMemo(
    () => pieces.map((p) => ({ p, ring: placedRing(shapes[p.key] ?? [], p) })),
    [pieces, shapes],
  )
  const onSheet = placed.map((item, index) => ({ ...item, index })).filter((item) => item.p.sheet === sheet)
  const length =
    material.lengthMm ??
    Math.max(100, ...onSheet.map((item) => bounds(item.ring).maxY + margin + 20))

  // Avisos da tela: fora da área útil, ou retângulos mais perto que o espaçamento.
  const problems = useMemo(() => {
    const bad = new Set<number>()
    const boxes = onSheet.map((item) => ({ index: item.index, b: bounds(item.ring) }))
    for (const { index, b } of boxes) {
      if (b.minX < margin - 0.05 || b.maxX > material.widthMm - margin + 0.05 || b.minY < margin - 0.05) bad.add(index)
      if (material.lengthMm && b.maxY > material.lengthMm - margin + 0.05) bad.add(index)
    }
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i].b
        const c = boxes[j].b
        const apart = a.maxX + gap <= c.minX + 0.05 || c.maxX + gap <= a.minX + 0.05 || a.maxY + gap <= c.minY + 0.05 || c.maxY + gap <= a.minY + 0.05
        if (!apart) {
          bad.add(boxes[i].index)
          bad.add(boxes[j].index)
        }
      }
    }
    return bad
  }, [onSheet, margin, gap, material.widthMm, material.lengthMm])

  const update = (index: number, patch: Partial<ManualPlacement>) =>
    setPieces((list) => list.map((p, i) => (i === index ? { ...p, ...patch } : p)))
  const toMm = (dxPx: number, dyPx: number) => {
    const svg = svgRef.current
    if (!svg) return [0, 0]
    const scale = material.widthMm / svg.getBoundingClientRect().width
    return [dxPx * scale, -dyPx * scale]
  }
  const nudge = (dx: number, dy: number) => {
    if (selected === null) return
    const p = pieces[selected]
    update(selected, { xMm: round(p.xMm + dx), yMm: round(p.yMm + dy) })
  }
  const duplicate = () => {
    if (selected === null) return
    const p = pieces[selected]
    const copy = Math.max(...pieces.filter((q) => q.key === p.key).map((q) => q.copy)) + 1
    const b = bounds(placedRing(shapes[p.key] ?? [], p))
    // Ao lado (ou acima, se não couber): o operador ajusta depois.
    const right = b.maxX + gap
    const next =
      right + (b.maxX - b.minX) <= material.widthMm - margin
        ? { ...p, copy, xMm: round(right) }
        : { ...p, copy, yMm: round(b.maxY + gap) }
    setPieces((list) => [...list, next])
    setSelected(pieces.length)
  }
  const remove = () => {
    if (selected === null) return
    setPieces((list) => list.filter((_, i) => i !== selected))
    setSelected(null)
  }

  const sel = selected !== null ? pieces[selected] : null
  const count = new Map<string, number>()
  for (const p of pieces) count.set(labelOf(p.key), (count.get(labelOf(p.key)) ?? 0) + 1)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {sheets > 1 && (
          <div className="flex items-center gap-1">
            {Array.from({ length: sheets }, (_, i) => (
              <Button key={i} size="sm" variant={sheet === i + 1 ? 'default' : 'outline'} className="h-7 px-2" onClick={() => setSheet(i + 1)}>
                Folha {i + 1}
              </Button>
            ))}
          </div>
        )}
        <Button size="sm" variant="outline" className="h-7" disabled={!sel} onClick={() => sel && update(selected!, { rotation: (sel.rotation - step + 360) % 360 })}>
          <RotateCcw className="mr-1 h-3.5 w-3.5" /> {step}°
        </Button>
        <Button size="sm" variant="outline" className="h-7" disabled={!sel} onClick={() => sel && update(selected!, { rotation: (sel.rotation + step) % 360 })}>
          <RotateCw className="mr-1 h-3.5 w-3.5" /> {step}°
        </Button>
        <Button size="sm" variant="outline" className="h-7" disabled={!sel} onClick={duplicate}>
          <Copy className="mr-1 h-3.5 w-3.5" /> Duplicar
        </Button>
        <Button size="sm" variant="outline" className="h-7" disabled={!sel} onClick={remove}>
          <Trash2 className="mr-1 h-3.5 w-3.5" /> Apagar
        </Button>
        {sel && (
          <span className="flex items-center gap-1 text-muted-foreground">
            X
            <input className="h-7 w-20 rounded border border-border bg-background px-1 tabular-nums" type="number" step="0.1" value={sel.xMm} onChange={(e) => update(selected!, { xMm: Number(e.target.value) })} />
            Y
            <input className="h-7 w-20 rounded border border-border bg-background px-1 tabular-nums" type="number" step="0.1" value={sel.yMm} onChange={(e) => update(selected!, { yMm: Number(e.target.value) })} />
            mm · setas movem 1 mm (Shift: 10 mm)
          </span>
        )}
      </div>

      <div
        className="max-h-[65vh] overflow-auto rounded-lg border border-border bg-muted p-2 outline-none"
        tabIndex={0}
        onKeyDown={(e) => {
          const d = e.shiftKey ? 10 : 1
          const moves: Record<string, [number, number]> = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, d], ArrowDown: [0, -d] }
          if (moves[e.key]) {
            e.preventDefault()
            nudge(...moves[e.key])
          }
          if (e.key === 'Delete') remove()
        }}
      >
        <svg
          ref={svgRef}
          viewBox={`0 ${-length} ${material.widthMm} ${length}`}
          className="w-full bg-background"
          style={{ aspectRatio: `${material.widthMm} / ${length}` }}
          onPointerMove={(e) => {
            const d = drag.current
            if (!d) return
            const [dx, dy] = toMm(e.clientX - d.startX, e.clientY - d.startY)
            update(d.index, { xMm: round(d.x + dx), yMm: round(d.y + dy) })
          }}
          onPointerUp={() => (drag.current = null)}
          onPointerLeave={() => (drag.current = null)}
        >
          {/* Área útil (dentro da margem) */}
          <rect x={margin} y={-(length - margin)} width={material.widthMm - 2 * margin} height={length - 2 * margin} fill="none" stroke="#94a3b8" strokeDasharray="4 3" strokeWidth={0.6} />
          {onSheet.map(({ p, ring, index }) => (
            <polygon
              key={index}
              points={ring.map(([x, y]) => `${x},${-y}`).join(' ')}
              fill={problems.has(index) ? '#ef4444' : index === selected ? '#2563eb' : '#64748b'}
              fillOpacity={index === selected ? 0.55 : 0.35}
              stroke={problems.has(index) ? '#b91c1c' : '#334155'}
              strokeWidth={0.5}
              className="cursor-move"
              onPointerDown={(e) => {
                ;(e.target as Element).setPointerCapture?.(e.pointerId)
                setSelected(index)
                drag.current = { index, startX: e.clientX, startY: e.clientY, x: p.xMm, y: p.yMm }
              }}
            >
              <title>{`${labelOf(p.key)} #${p.copy + 1}`}</title>
            </polygon>
          ))}
        </svg>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>{[...count].map(([label, n]) => `${label}: ${n}`).join(' · ')}</span>
        {problems.size > 0 && <span className="text-red-600 dark:text-red-400">{problems.size} peça(s) fora da área ou perto demais (em vermelho)</span>}
      </div>
      <div className="flex gap-2">
        <Button onClick={() => onApply(pieces)} disabled={busy || pieces.length === 0}>
          Gerar folha com estas posições
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        O analisador confere o contorno real, o espaçamento de {gap} mm e as margens antes de gerar; se algo não couber,
        a montagem é recusada com a lista do que ajustar.
      </p>
    </div>
  )
}

const round = (v: number) => Math.round(v * 10) / 10
