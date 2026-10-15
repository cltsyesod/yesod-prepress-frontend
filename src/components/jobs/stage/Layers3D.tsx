import { useEffect, useRef, useState } from 'react'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { renderPage, type Inspection, type LoadedPdf, type Plate } from './usePdf'

const PLATE_LABEL: Record<Plate, string> = {
  images: 'Imagens',
  text: 'Textos',
  vectors: 'Vetores',
  cut: 'Faca',
  color: 'Cor',
  white: 'Branco',
}
const PLATE_COUNT: Record<Plate, ('image' | 'text' | 'path' | 'shading' | 'cut' | 'white')[]> = {
  images: ['image'],
  text: ['text'],
  vectors: ['path', 'shading'],
  cut: ['cut'],
  color: ['image', 'text', 'path', 'shading'],
  white: ['white'],
}
// Gráfica: placas por tipo de objeto. DTF/DTG: as placas de produção, de baixo para cima
// como ficam na peça (tecido → branco → cor), e a faca por cima.
const PRINT_PLATES: Plate[] = ['images', 'text', 'vectors', 'cut']
const TEXTILE_PLATES: Plate[] = ['white', 'color', 'cut']
const VIEWS = [
  { label: 'Inclinada', x: 58, z: -32 },
  { label: 'De frente', x: 0, z: 0 },
  { label: 'De lado', x: 80, z: -88 },
]

/**
 * O arquivo desmontado em placas, uma por tipo de objeto, empilhadas sobre o papel:
 * gire com o mouse para ver de que a página é feita. As placas vêm do arquivo de
 * inspeção (mesmo quadro da página), desenhadas sem o papel branco.
 */
export function Layers3D({
  production,
  inspection,
  page,
  textile = false,
}: {
  production: LoadedPdf
  inspection: Inspection
  page: number
  /** DTF/DTG: placas Branco · Cor · Faca em vez dos tipos de objeto. */
  textile?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [area, setArea] = useState({ width: 0, height: 0 })
  const [rotation, setRotation] = useState({ x: VIEWS[0].x, z: VIEWS[0].z })
  const [gap, setGap] = useState(70)
  const [hidden, setHidden] = useState<Record<string, boolean>>({})
  const [focus, setFocus] = useState<Plate | null>(null)
  const [canvases, setCanvases] = useState<Partial<Record<Plate | 'paper', HTMLCanvasElement>>>({})

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setArea({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const view = production.pages[page - 1]?.view
  const info = inspection.pages[page - 1]
  const wanted = textile ? TEXTILE_PLATES : PRINT_PLATES
  const plates = wanted.filter(
    (plate) =>
      inspection.plates.includes(plate) && PLATE_COUNT[plate].some((kind) => ((info?.counts as Record<string, number>)?.[kind] ?? 0) > 0),
  )
  const width = view ? view[2] - view[0] : 1
  const height = view ? view[3] - view[1] : 1
  const scale = area.width ? Math.min((area.width * 0.55) / width, (area.height * 0.5) / height) : 0

  useEffect(() => {
    if (!view || !scale) return
    let cancelled = false
    const px = Math.min(scale * (window.devicePixelRatio || 1), Math.sqrt(16_000_000 / (width * height)))
    ;(async () => {
      const out: Partial<Record<Plate | 'paper', HTMLCanvasElement>> = {}
      for (const plate of plates) {
        const index = (page - 1) * inspection.plates.length + inspection.plates.indexOf(plate) + 1
        out[plate] = await renderPage(inspection.pdf, index, px, undefined, view, true)
      }
      if (!cancelled) setCanvases(out)
    })().catch(() => null)
    return () => {
      cancelled = true
    }
    // plates deriva de inspection e page
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, scale, inspection, page])

  // Arrastar gira a pilha.
  const drag = useRef<{ x: number; y: number; rx: number; rz: number } | null>(null)
  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, rx: rotation.x, rz: rotation.z }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return
    setRotation({
      x: Math.min(85, Math.max(0, drag.current.rx - (e.clientY - drag.current.y) * 0.3)),
      z: drag.current.rz + (e.clientX - drag.current.x) * 0.3,
    })
  }

  if (!view || !info) return <p className="p-6 text-sm text-muted-foreground">Sem camadas para esta página.</p>
  const w = width * scale
  const h = height * scale

  return (
    <div className="flex h-full min-h-0">
      <div
        ref={ref}
        className="relative min-h-0 flex-1 cursor-grab touch-none select-none overflow-hidden active:cursor-grabbing"
        style={{ perspective: 1800 }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => (drag.current = null)}
      >
        {!scale || !Object.keys(canvases).length ? (
          <Loader2 className="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 animate-spin text-muted-foreground" />
        ) : (
          <div
            className="absolute left-1/2 top-1/2"
            style={{
              width: w,
              height: h,
              marginLeft: -w / 2,
              marginTop: -h / 2,
              transformStyle: 'preserve-3d',
              transform: `rotateX(${rotation.x}deg) rotateZ(${rotation.z}deg) translateZ(${(-plates.length * gap) / 2}px)`,
              transition: drag.current ? undefined : 'transform 0.35s ease',
            }}
          >
            {/* O papel. */}
            <div className="absolute inset-0 border border-border bg-white shadow-2xl" />
            {plates.map((plate, index) => (
              <PlateLayer
                key={plate}
                canvas={canvases[plate]}
                z={(index + 1) * gap}
                label={PLATE_LABEL[plate]}
                dimmed={(focus !== null && focus !== plate) || !!hidden[plate]}
                hidden={!!hidden[plate]}
              />
            ))}
          </div>
        )}
        <p className="pointer-events-none absolute bottom-3 left-3 text-xs text-muted-foreground">Arraste para girar</p>
      </div>

      <div className="w-56 shrink-0 space-y-4 border-l border-border bg-card p-3 text-xs">
        <div className="space-y-1.5">
          <p className="font-semibold uppercase tracking-wide text-muted-foreground">Placas</p>
          {[...plates].reverse().map((plate) => {
            const count = PLATE_COUNT[plate].reduce((n, kind) => n + ((info.counts as Record<string, number>)[kind] ?? 0), 0)
            return (
              <div
                key={plate}
                onMouseEnter={() => setFocus(plate)}
                onMouseLeave={() => setFocus(null)}
                className={cn('flex items-center gap-2 rounded-md px-2 py-1.5', focus === plate && 'bg-accent/60')}
              >
                <button
                  type="button"
                  onClick={() => setHidden((prev) => ({ ...prev, [plate]: !prev[plate] }))}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label={hidden[plate] ? `Mostrar ${PLATE_LABEL[plate]}` : `Esconder ${PLATE_LABEL[plate]}`}
                >
                  {hidden[plate] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
                <span className={cn('flex-1 font-medium', hidden[plate] ? 'text-muted-foreground' : 'text-foreground')}>
                  {PLATE_LABEL[plate]}
                </span>
                <span className="tabular-nums text-muted-foreground">{count}</span>
              </div>
            )
          })}
          <div className="flex items-center gap-2 px-2 py-1.5 text-muted-foreground">
            <span className="h-3.5 w-3.5 rounded-sm border border-border bg-white" />
            <span className="flex-1">{textile ? 'Peça (tecido)' : 'Papel'}</span>
          </div>
        </div>

        <div className="space-y-1.5">
          <p className="font-semibold uppercase tracking-wide text-muted-foreground">Vista</p>
          <div className="flex flex-wrap gap-1">
            {VIEWS.map((v) => (
              <button
                key={v.label}
                type="button"
                onClick={() => setRotation({ x: v.x, z: v.z })}
                className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>

        <label className="block space-y-1.5">
          <span className="font-semibold uppercase tracking-wide text-muted-foreground">Afastamento</span>
          <input type="range" min={0} max={160} value={gap} onChange={(e) => setGap(Number(e.target.value))} className="w-full" />
        </label>

        {info.generatedBleed && (
          <p className="rounded-md bg-muted px-2 py-1.5 text-muted-foreground">
            A sangria em volta foi gerada pelo sistema; cada placa já a inclui.
          </p>
        )}
      </div>
    </div>
  )
}

function PlateLayer({
  canvas,
  z,
  label,
  dimmed,
  hidden,
}: {
  canvas?: HTMLCanvasElement
  z: number
  label: string
  dimmed: boolean
  hidden: boolean
}) {
  const slot = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = slot.current
    if (!el) return
    el.replaceChildren()
    if (canvas) {
      Object.assign(canvas.style, { width: '100%', height: '100%', display: 'block' })
      el.appendChild(canvas)
    }
  }, [canvas])
  return (
    <div
      className="absolute inset-0 transition-opacity"
      style={{ transform: `translateZ(${z}px)`, opacity: hidden ? 0 : dimmed ? 0.15 : 1 }}
    >
      {/* Folha translúcida, como papel vegetal: tinta escura continua legível. */}
      <div className="absolute inset-0 border border-slate-400/60 bg-white/30" />
      <div ref={slot} className="absolute inset-0" />
      <span className="absolute -right-3 top-0 translate-x-full whitespace-nowrap rounded bg-background/90 px-2 py-0.5 text-xs font-semibold text-foreground shadow">
        {label}
      </span>
    </div>
  )
}
