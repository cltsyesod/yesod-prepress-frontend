import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, ImageIcon, Loader2, PenTool, Scissors, Search, Type, X, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { renderPage, type Box, type InspectedObject, type Inspection, type LoadedPdf, type ObjectKind, type Plate } from './usePdf'

const MM = 72 / 25.4
const MARGIN = 40
const SELECT = '#06b6d4'

/** Grupos da lista, na ordem do painel; cada um corresponde a uma placa. */
const GROUPS: { plate: Plate; label: string; icon: LucideIcon; kinds: ObjectKind[] }[] = [
  { plate: 'images', label: 'Imagens', icon: ImageIcon, kinds: ['image'] },
  { plate: 'text', label: 'Textos', icon: Type, kinds: ['text'] },
  { plate: 'vectors', label: 'Vetores', icon: PenTool, kinds: ['path', 'shading'] },
  { plate: 'cut', label: 'Faca', icon: Scissors, kinds: ['cut'] },
]
const ROWS_PER_GROUP = 150

/**
 * Estrutura do arquivo, como o painel de camadas de um programa de desenho: o que há na
 * página (imagens, textos, vetores, faca), onde está, o tamanho real e o que importa para
 * a pré-impressão. Selecionar mostra o objeto na arte; o filtro mostra só um tipo.
 * Só inspeção: nada aqui altera o arquivo.
 */
export function StructureView({
  production,
  inspection,
  page,
  fileScale,
  zoom,
}: {
  production: LoadedPdf
  inspection: Inspection
  page: number
  fileScale: number
  zoom: number
}) {
  const info = inspection.pages[page - 1]
  const view = production.pages[page - 1]?.view
  const [only, setOnly] = useState<Plate | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({ images: true, text: true, vectors: false, cut: true })
  const viewportRef = useRef<HTMLDivElement>(null)
  const [area, setArea] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setArea({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  useEffect(() => setSelected(null), [page])

  const objects = useMemo(() => info?.objects ?? [], [info])
  const byId = useMemo(() => new Map(objects.map((o) => [o.id, o])), [objects])
  const current = selected ? byId.get(selected) : undefined

  const scale = view && area.width ? Math.max(0.01, Math.min((area.width - MARGIN * 2) / (view[2] - view[0]), (area.height - MARGIN * 2) / (view[3] - view[1]))) * zoom : 0

  // A página inteira, ou só a placa escolhida (do arquivo de inspeção, no mesmo quadro).
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null)
  useEffect(() => {
    if (!view || !scale) return
    let cancelled = false
    const dpr = window.devicePixelRatio || 1
    const px = Math.min(scale * dpr, Math.sqrt(40_000_000 / ((view[2] - view[0]) * (view[3] - view[1]))))
    const source = only ? inspection.pdf : production
    const index = only ? (page - 1) * inspection.plates.length + inspection.plates.indexOf(only) + 1 : page
    renderPage(source, index, px, undefined, view)
      .then((c) => !cancelled && setCanvas(c))
      .catch(() => null)
    return () => {
      cancelled = true
    }
  }, [view, scale, only, page, production, inspection])

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

  if (!info || !view) {
    return <p className="p-6 text-sm text-muted-foreground">Sem estrutura para esta página.</p>
  }

  const toView = (b: Box) => [(b[0] - view[0]) * scale, (view[3] - b[3]) * scale, (b[2] - b[0]) * scale, (b[3] - b[1]) * scale]
  const sizeMm = (b: Box) => `${fmt(((b[2] - b[0]) / MM) * fileScale)} × ${fmt(((b[3] - b[1]) / MM) * fileScale)} mm`
  const matches = (o: InspectedObject) => {
    if (!query.trim()) return true
    const q = query.trim().toLowerCase()
    return [o.text, o.font, o.layer, o.colorSpace].some((v) => v?.toLowerCase().includes(q))
  }

  // Clique na arte: o menor objeto (do tipo filtrado) sob o cursor.
  const pick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = view[0] + (e.clientX - rect.left) / scale
    const y = view[3] - (e.clientY - rect.top) / scale
    const kinds = only ? GROUPS.find((g) => g.plate === only)!.kinds : null
    const hit = objects
      .filter((o) => (!kinds || kinds.includes(o.kind)) && x >= o.box[0] && x <= o.box[2] && y >= o.box[1] && y <= o.box[3])
      .sort((a, b) => area2(a.box) - area2(b.box))[0]
    setSelected(hit?.id ?? null)
    if (hit) {
      const group = GROUPS.find((g) => g.kinds.includes(hit.kind))!
      setOpen((prev) => ({ ...prev, [group.plate]: true }))
      requestAnimationFrame(() => document.getElementById(`obj-${hit.id}`)?.scrollIntoView({ block: 'nearest' }))
    }
  }

  const highlight = [hovered, selected].filter(Boolean).map((id) => byId.get(id!)).filter(Boolean) as InspectedObject[]

  return (
    <div className="flex h-full min-h-0">
      {/* Painel de objetos. */}
      <div className="flex w-72 shrink-0 flex-col border-r border-border bg-card">
        <div className="space-y-2 border-b border-border p-2.5">
          <div className="flex flex-wrap gap-1">
            <Chip active={!only} onClick={() => setOnly(null)}>
              Tudo
            </Chip>
            {GROUPS.map((g) => {
              const count = g.kinds.reduce((n, k) => n + (info.counts[k] ?? 0), 0)
              return (
                <Chip key={g.plate} active={only === g.plate} disabled={!count} onClick={() => setOnly(only === g.plate ? null : g.plate)}>
                  Só {g.label.toLowerCase()}
                </Chip>
              )
            })}
          </div>
          <label className="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar texto, fonte, camada"
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
            />
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto py-1 text-xs">
          {GROUPS.map((group) => {
            const items = objects.filter((o) => group.kinds.includes(o.kind) && matches(o))
            const total = group.kinds.reduce((n, k) => n + (info.counts[k] ?? 0), 0)
            if (!total) return null
            const Icon = group.icon
            const isOpen = open[group.plate] || !!query
            return (
              <div key={group.plate}>
                <button
                  type="button"
                  onClick={() => setOpen((prev) => ({ ...prev, [group.plate]: !isOpen }))}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 font-semibold text-foreground hover:bg-accent/50"
                >
                  <ChevronRight className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', isOpen && 'rotate-90')} />
                  <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                  {group.label}
                  <span className="ml-auto font-normal tabular-nums text-muted-foreground">{total}</span>
                </button>
                {isOpen &&
                  items.slice(0, ROWS_PER_GROUP).map((o) => (
                    <button
                      key={o.id}
                      id={`obj-${o.id}`}
                      type="button"
                      onClick={() => setSelected(selected === o.id ? null : o.id)}
                      onMouseEnter={() => setHovered(o.id)}
                      onMouseLeave={() => setHovered(null)}
                      className={cn(
                        'flex w-full items-center gap-2 py-1 pl-9 pr-2.5 text-left hover:bg-accent/50',
                        selected === o.id && 'bg-cyan-500/15 text-foreground',
                      )}
                    >
                      <Swatch o={o} />
                      <span className="min-w-0 flex-1 truncate">{label(o)}</span>
                      <Flag o={o} fileScale={fileScale} />
                    </button>
                  ))}
                {isOpen && items.length > ROWS_PER_GROUP && (
                  <p className="py-1 pl-9 text-muted-foreground">
                    + {items.length - ROWS_PER_GROUP} — clique na arte ou busque para achar
                  </p>
                )}
                {isOpen && total > items.length && !query && (
                  <p className="py-1 pl-9 text-muted-foreground">Arquivo muito grande: lista parcial</p>
                )}
              </div>
            )
          })}
          {info.generatedBleed && (
            <p className="mx-2.5 mt-2 rounded-md bg-muted px-2 py-1.5 text-muted-foreground">
              A sangria em volta foi gerada pelo sistema a partir da borda da arte; os objetos aparecem uma vez.
            </p>
          )}
        </div>

        {current && <Details o={current} fileScale={fileScale} sizeMm={sizeMm} onClose={() => setSelected(null)} />}
      </div>

      {/* A arte, com a seleção. */}
      <div ref={viewportRef} className="relative min-h-0 flex-1 overflow-auto" style={{ backgroundImage: 'radial-gradient(hsl(var(--border)) 1px, transparent 1px)', backgroundSize: '18px 18px' }}>
        {!scale ? (
          <Loader2 className="m-auto mt-10 h-6 w-6 animate-spin text-muted-foreground" />
        ) : (
          <div className="flex min-h-full min-w-full w-max items-center justify-center">
            <div
              className="relative shrink-0 cursor-crosshair"
              style={{ width: (view[2] - view[0]) * scale, height: (view[3] - view[1]) * scale, margin: MARGIN }}
              onClick={pick}
            >
              <div ref={slot} className="h-full w-full shadow-lg" />
              <svg className="pointer-events-none absolute inset-0 overflow-visible" width="100%" height="100%" aria-hidden>
                {highlight.map((o, i) => {
                  const [x, y, w, h] = toView(o.box)
                  const strong = o.id === selected
                  return (
                    <g key={`${o.id}-${i}`}>
                      <rect x={x} y={y} width={Math.max(w, 1)} height={Math.max(h, 1)} fill={strong ? 'rgba(6,182,212,0.12)' : 'none'} stroke={SELECT} strokeWidth={strong ? 2 : 1} strokeDasharray={strong ? '' : '4 3'} />
                      {strong && (
                        <text x={x} y={Math.max(y - 6, 10)} fontSize={11} fill={SELECT} fontWeight={600}>
                          {sizeMm(o.box)}
                        </text>
                      )}
                    </g>
                  )
                })}
              </svg>
            </div>
          </div>
        )}
        {only && (
          <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-background/90 px-2.5 py-1 text-xs font-medium text-foreground shadow">
            Mostrando só: {GROUPS.find((g) => g.plate === only)?.label.toLowerCase()}
          </span>
        )}
      </div>
    </div>
  )
}

function Chip({ active, disabled, onClick, children }: { active: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors disabled:opacity-40',
        active ? 'border-primary bg-primary/15 text-primary' : 'border-border text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

const rgb = (c?: number[] | null) => (c ? `rgb(${c[0]},${c[1]},${c[2]})` : undefined)

function Swatch({ o }: { o: InspectedObject }) {
  if (o.kind === 'image') return <ImageIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
  if (o.kind === 'text') return <Type className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
  return (
    <span
      className="h-3 w-3 shrink-0 rounded-sm border border-border"
      style={{ background: rgb(o.fill) ?? 'transparent', boxShadow: o.stroke ? `inset 0 0 0 2px ${rgb(o.stroke)}` : undefined }}
    />
  )
}

function label(o: InspectedObject) {
  switch (o.kind) {
    case 'text':
      return o.text ? `"${o.text}"` : 'Texto'
    case 'image':
      return o.px ? `Imagem ${o.px[0]} × ${o.px[1]} px` : 'Imagem'
    case 'cut':
      return `Faca${o.layer ? ` (${o.layer})` : ''}`
    case 'shading':
      return 'Degradê'
    default:
      return o.fill && o.stroke ? 'Vetor com contorno' : o.stroke ? 'Contorno' : 'Vetor'
  }
}

/** O alerta que importa em cada tipo, na própria linha. */
function Flag({ o, fileScale }: { o: InspectedObject; fileScale: number }) {
  if (o.kind === 'image' && o.ppi) {
    const ppi = Math.round(o.ppi / fileScale)
    return <span className="shrink-0 tabular-nums text-muted-foreground">{ppi} ppi</span>
  }
  if (o.kind === 'text' && o.embedded === false) {
    return <span className="shrink-0 text-amber-500">não incorp.</span>
  }
  return null
}

function Details({
  o,
  fileScale,
  sizeMm,
  onClose,
}: {
  o: InspectedObject
  fileScale: number
  sizeMm: (b: Box) => string
  onClose: () => void
}) {
  const rows: [string, string][] = [
    ['Tamanho final', sizeMm(o.box)],
    ['Posição', `${fmt((o.box[0] / MM) * fileScale)} , ${fmt((o.box[1] / MM) * fileScale)} mm`],
  ]
  if (o.layer) rows.push(['Camada', o.layer])
  if (o.kind === 'image') {
    if (o.px) rows.push(['Pixels', `${o.px[0]} × ${o.px[1]}`])
    if (o.ppi) rows.push(['Resolução final', `${Math.round(o.ppi / fileScale)} ppi`])
    if (o.colorSpace) rows.push(['Espaço de cor', o.colorSpace])
  }
  if (o.kind === 'text') {
    if (o.text) rows.push(['Texto', o.text])
    if (o.font) rows.push(['Fonte', `${o.font}${o.embedded === false ? ' (não incorporada)' : o.embedded ? ' (incorporada)' : ''}`])
    if (o.sizePt) rows.push(['Corpo', `${fmt(o.sizePt * fileScale)} pt no tamanho final`])
  }
  if (o.kind === 'path' || o.kind === 'cut') {
    if (o.fill) rows.push(['Preenchimento', 'sim'])
    if (o.stroke) rows.push(['Contorno', `${fmt((o.strokeWidthPt ?? 0) * fileScale)} pt`])
  }
  return (
    <div className="border-t border-border bg-muted/40 p-2.5 text-xs">
      <div className="mb-1.5 flex items-center gap-2">
        <Swatch o={o} />
        <span className="min-w-0 flex-1 truncate font-semibold text-foreground">{label(o)}</span>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Fechar">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <dl className="space-y-0.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="min-w-0 truncate text-right font-medium tabular-nums text-foreground" title={v}>
              {v}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

const area2 = (b: Box) => (b[2] - b[0]) * (b[3] - b[1])
const fmt = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: n < 100 ? 1 : 0 })
