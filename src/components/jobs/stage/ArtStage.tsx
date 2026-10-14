import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Columns2,
  Eye,
  Shirt,
  FileInput,
  Layers,
  Layers3,
  ListTree,
  Loader2,
  Maximize,
  Minimize,
  Minus,
  Plus,
  ScanSearch,
  SplitSquareHorizontal,
  Wand2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { Layers3D } from './Layers3D'
import { StructureView } from './StructureView'
import { renderPage, union, useInspection, usePdf, type Box, type LoadedPdf, type PdfLayer } from './usePdf'

const MM = 72 / 25.4
const MARGIN = 40 // px em volta da arte: guias e medidas ficam aqui, nunca sobre a arte
const DIFF = [6, 182, 212] // ciano: o que mudou (magenta fica para a faca real)

const GUIDES = {
  bleed: { label: 'Sangria', color: '#3b82f6' },
  trim: { label: 'Formato final', color: '#22c55e' },
} as const

type Mode = 'production' | 'white' | 'client' | 'side' | 'curtain' | 'diff' | 'structure' | 'layers3d'
type WhiteView = 'color' | 'white' | 'garment'

const MODES: { id: Mode; label: string; icon: typeof Eye; compare?: boolean; inspect?: boolean; white?: boolean; hint: string }[] = [
  { id: 'production', label: 'Produção', icon: Eye, hint: 'O arquivo que vai para a produção' },
  { id: 'white', label: 'Base branca', icon: Shirt, white: true, hint: 'DTF/DTG: a cor, só o branco e a estampa na peça' },
  { id: 'client', label: 'Cliente', icon: FileInput, compare: true, hint: 'O arquivo como o cliente enviou' },
  { id: 'side', label: 'Lado a lado', icon: Columns2, compare: true, hint: 'Cliente e produção na mesma escala' },
  { id: 'curtain', label: 'Cortina', icon: SplitSquareHorizontal, compare: true, hint: 'Arraste a linha: cliente à esquerda, produção à direita' },
  { id: 'diff', label: 'O que mudou', icon: ScanSearch, compare: true, hint: 'Em ciano, tudo o que o sistema mudou no arquivo' },
  { id: 'structure', label: 'Estrutura', icon: ListTree, inspect: true, hint: 'Os objetos do arquivo: selecionar, medir e ver só um tipo' },
  { id: 'layers3d', label: 'Camadas 3D', icon: Layers3, inspect: true, hint: 'O arquivo desmontado em placas, por tipo de objeto' },
]

type AppliedFix = { id: string; label: string; details: string[] }

export interface StageFile {
  url: string
  name: string
  /** Imagem ainda não convertida em PDF: só mostrada, sem guias. */
  image?: boolean
}

/**
 * A mesa de trabalho: a arte em destaque, com as guias de pré-impressão e as medidas
 * reais por fora dela, e a comparação com o arquivo do cliente (lado a lado, cortina
 * ou só as diferenças). As correções nunca movem a arte, então os dois arquivos são
 * desenhados no mesmo espaço do PDF: o mesmo ponto cai no mesmo pixel.
 */
export function ArtStage({
  production,
  client,
  page,
  onPageChange,
  fileScale = 1,
  changes,
  correcting,
  inspectionUrl,
  whiteRequest = 0,
}: {
  production: StageFile | null
  /** Arquivo do cliente em PDF, quando difere do de produção. */
  client: StageFile | null
  page: number
  onPageChange: (page: number) => void
  /** Escala do arquivo (1:N → N), para as medidas no tamanho final. */
  fileScale?: number
  changes: AppliedFix[]
  correcting: boolean
  /** Arquivo de inspeção (placas + mapa de objetos) do arquivo de produção, se houver. */
  inspectionUrl: string | null
  /** Muda para a vista da base branca quando ela existe (cada novo número é um pedido). */
  whiteRequest?: number
}) {
  const stageRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const prod = usePdf(production && !production.image ? production.url : null)
  const orig = usePdf(client && !client.image ? client.url : null)
  const comparable = !!orig.pdf && !!prod.pdf
  const insp = useInspection(inspectionUrl)

  const [mode, setMode] = useState<Mode>('production')
  const [zoom, setZoom] = useState(1)
  const [guides, setGuides] = useState(true)
  const [layers, setLayers] = useState<PdfLayer[]>([])
  const [curtain, setCurtain] = useState(0.5)
  const [area, setArea] = useState({ width: 0, height: 0 })
  const [fullscreen, setFullscreen] = useState(false)
  const [whiteView, setWhiteView] = useState<WhiteView>('garment')
  const [garment, setGarment] = useState('#1f2937')
  // Placa da base branca gerada pelo sistema (vem no arquivo de inspeção).
  const whitePlate = insp.inspection?.white?.find((w) => w.page === current)
  const whiteLayer = insp.inspection?.white?.length ? true : false
  useEffect(() => {
    if (whiteRequest && whiteLayer) setMode('white')
  }, [whiteRequest, whiteLayer])

  useEffect(() => setLayers(prod.pdf?.layers ?? []), [prod.pdf])
  // Modo que depende de algo que não existe (arquivo do cliente, inspeção): volta à produção.
  const inspecting = mode === 'structure' || mode === 'layers3d'
  useEffect(() => {
    const spec = MODES.find((m) => m.id === mode)
    if ((spec?.compare && !comparable) || (spec?.inspect && !insp.inspection) || (spec?.white && !whiteLayer)) setMode('production')
  }, [comparable, insp.inspection, mode, whiteLayer])

  // A área da arte é recriada ao sair das vistas de inspeção: observa de novo.
  useEffect(() => {
    const element = viewportRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setArea({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(element)
    return () => observer.disconnect()
  }, [inspecting])

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === stageRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const pageCount = prod.pdf?.doc.numPages ?? 0
  const current = Math.min(Math.max(page, 1), pageCount || 1)
  const prodPage = prod.pdf?.pages[current - 1]
  const origPage = orig.pdf?.pages[current - 1]

  // Quadros a desenhar (espaço do PDF) e a escala comum que cabe na área.
  const layout = useMemo(() => {
    if (!prodPage || !area.width || mode === 'structure' || mode === 'layers3d') return null
    const frames: { key: 'prod' | 'orig'; box: Box }[] = []
    if (mode === 'production' || mode === 'white' || !origPage) frames.push({ key: 'prod', box: prodPage.view })
    else if (mode === 'client') frames.push({ key: 'orig', box: origPage.view })
    else if (mode === 'side') frames.push({ key: 'orig', box: origPage.view }, { key: 'prod', box: prodPage.view })
    else frames.push({ key: 'prod', box: union(prodPage.view, origPage.view) })
    const widths = frames.reduce((sum, f) => sum + f.box[2] - f.box[0], 0)
    const height = Math.max(...frames.map((f) => f.box[3] - f.box[1]))
    const fit = Math.min(
      (area.width - MARGIN * 2 * frames.length) / widths,
      (area.height - MARGIN * 2) / height,
    )
    return { frames, scale: Math.max(fit, 0.01) * zoom }
  }, [prodPage, origPage, mode, area.width, area.height, zoom])

  // Desenha (ou compara) as páginas do quadro na escala atual.
  const [canvases, setCanvases] = useState<Record<string, HTMLCanvasElement | null>>({})
  const [diffShare, setDiffShare] = useState<number | null>(null)
  const [drawing, setDrawing] = useState(false)
  useEffect(() => {
    if (!layout || !prod.pdf) return
    let cancelled = false
    setDrawing(true)
    const dpr = window.devicePixelRatio || 1
    // Telas muito grandes estouram a memória do navegador: limita a resolução.
    const area = layout.frames.reduce((sum, f) => sum + (f.box[2] - f.box[0]) * (f.box[3] - f.box[1]), 0)
    const px = Math.min(layout.scale * dpr, Math.sqrt(40_000_000 / Math.max(area, 1)))
    ;(async () => {
      const out: Record<string, HTMLCanvasElement | null> = {}
      const draw = (pdf: LoadedPdf, frame: Box, withLayers: boolean) =>
        renderInto(pdf, current, px, frame, withLayers ? layers : undefined)
      if (mode === 'white') {
        const frame = layout.frames[0].box
        const color = await renderPage(prod.pdf!, current, px, layers, frame, true)
        out.prod = composeWhite(color, whitePlate, frame, px, whiteView, garment)
      } else if (mode === 'curtain' || mode === 'diff') {
        const frame = layout.frames[0].box
        const [a, b] = await Promise.all([draw(prod.pdf!, frame, true), draw(orig.pdf!, frame, false)])
        if (mode === 'curtain') {
          out.prod = a
          out.orig = b
        } else {
          const result = difference(a, b)
          out.prod = result.canvas
          if (!cancelled) setDiffShare(result.share)
        }
      } else {
        for (const frame of layout.frames) {
          out[frame.key] = await draw(frame.key === 'prod' ? prod.pdf! : orig.pdf!, frame.box, frame.key === 'prod')
        }
      }
      if (!cancelled) {
        setCanvases(out)
        setDrawing(false)
      }
    })().catch(() => !cancelled && setDrawing(false))
    return () => {
      cancelled = true
    }
  }, [layout, prod.pdf, orig.pdf, current, layers, mode, whitePlate, whiteView, garment])

  // Arrastar para mover a arte ampliada; Ctrl + roda do mouse para o zoom.
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
  const onPointerDown = (e: React.PointerEvent) => {
    const el = viewportRef.current
    if (!el || zoom <= 1 || (e.target as HTMLElement).dataset.handle) return
    drag.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop }
    el.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const el = viewportRef.current
    if (!el || !drag.current) return
    el.scrollLeft = drag.current.left - (e.clientX - drag.current.x)
    el.scrollTop = drag.current.top - (e.clientY - drag.current.y)
  }
  const onPointerUp = () => {
    drag.current = null
  }
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      setZoom((z) => Math.min(8, Math.max(0.5, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15))))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [inspecting])

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => null)
    else stageRef.current?.requestFullscreen().catch(() => null)
  }, [])

  const finalMm = (box: Box | null) =>
    box ? [((box[2] - box[0]) / MM) * fileScale, ((box[3] - box[1]) / MM) * fileScale] : null
  const fmt = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: n < 100 ? 1 : 0 })

  const error = prod.error
  const loading = !!production && !production.image && !prod.pdf && !prod.error

  return (
    <div ref={stageRef} className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card">
      {/* Barra da mesa: modo de ver, página, zoom, guias, camadas. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-3 py-2 text-sm">
        <div className="flex items-center rounded-lg bg-muted p-0.5" role="tablist" aria-label="Como ver o arquivo">
          {MODES.filter((m) => (!m.white || !!whiteLayer) && (!m.compare || comparable) && (!m.inspect || (production && !production.image))).map((m) => {
            const Icon = m.icon
            // Inspeção ainda não gerada (análise anterior a ela): o botão explica.
            const unavailable = m.inspect && !insp.inspection
            return (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={mode === m.id}
                disabled={unavailable}
                title={unavailable ? 'Reanalise o arquivo para ver a estrutura' : m.hint}
                onClick={() => setMode(m.id)}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-40',
                  m.inspect && 'border-l border-border/60 first-of-type:border-l-0',
                  mode === m.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {m.label}
              </button>
            )
          })}
        </div>
        {!comparable && !inspecting && production && !production.image && (
          <span className="text-xs text-muted-foreground">
            {client ? 'Carregando o arquivo do cliente…' : 'Sem correções: este é o arquivo do cliente.'}
          </span>
        )}

        {mode === 'white' && (
          <div className="flex items-center gap-2 text-xs">
            <div className="flex items-center rounded-lg bg-muted p-0.5" role="tablist" aria-label="Vista da base branca">
              {([
                ['color', 'Cor'],
                ['white', 'Branco'],
                ['garment', 'Na peça'],
              ] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={whiteView === id}
                  onClick={() => setWhiteView(id)}
                  className={cn(
                    'rounded-md px-2 py-0.5 font-medium',
                    whiteView === id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {whiteView !== 'white' && (
              <label className="flex items-center gap-1.5 text-muted-foreground" title="Cor da peça ou do tecido, só na tela">
                Peça
                <input type="color" value={garment} onChange={(e) => setGarment(e.target.value)} className="h-6 w-8 cursor-pointer rounded border border-border bg-transparent" />
              </label>
            )}
            <span className="text-muted-foreground">Prévia de tela; sobreimpressão simulada</span>
          </div>
        )}

        <div className="ml-auto flex items-center gap-1">
          {pageCount > 1 && (
            <>
              <Button size="icon" variant="ghost" className="h-8 w-8" disabled={current <= 1} onClick={() => onPageChange(current - 1)} aria-label="Página anterior">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="tabular-nums text-xs text-muted-foreground">
                pág. {current}/{pageCount}
              </span>
              <Button size="icon" variant="ghost" className="h-8 w-8" disabled={current >= pageCount} onClick={() => onPageChange(current + 1)} aria-label="Próxima página">
                <ChevronRight className="h-4 w-4" />
              </Button>
              <span className="mx-1 h-4 w-px bg-border" />
            </>
          )}
          {mode !== 'layers3d' && (
            <>
              <Button size="icon" variant="ghost" className="h-8 w-8" disabled={zoom <= 0.5} onClick={() => setZoom((z) => Math.max(0.5, z / 1.25))} aria-label="Diminuir zoom">
                <Minus className="h-4 w-4" />
              </Button>
              <button className="w-12 text-center text-xs tabular-nums text-muted-foreground hover:text-foreground" onClick={() => setZoom(1)} title="Ajustar à área">
                {zoom === 1 ? 'Ajustar' : `${Math.round(zoom * 100)}%`}
              </button>
              <Button size="icon" variant="ghost" className="h-8 w-8" disabled={zoom >= 8} onClick={() => setZoom((z) => Math.min(8, z * 1.25))} aria-label="Aumentar zoom">
                <Plus className="h-4 w-4" />
              </Button>
              <span className="mx-1 h-4 w-px bg-border" />
            </>
          )}
          {!inspecting && (
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground" title="Só na tela: não vão para o PDF">
              <input type="checkbox" checked={guides} onChange={(e) => setGuides(e.target.checked)} />
              Guias
            </label>
          )}
          {layers.length > 0 && !inspecting && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-xs">
                  <Layers className="h-3.5 w-3.5" />
                  Camadas
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel className="text-xs text-muted-foreground">Camadas do PDF</DropdownMenuLabel>
                {layers.map((layer) => (
                  <DropdownMenuCheckboxItem
                    key={layer.id}
                    checked={layer.visible}
                    onCheckedChange={(v) => setLayers((prev) => prev.map((l) => (l.id === layer.id ? { ...l, visible: v === true } : l)))}
                  >
                    {layer.name}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={toggleFullscreen} aria-label={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'}>
            {fullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* A arte: estrutura e camadas 3D (inspeção) ou a página, inteira ou comparada. */}
      {inspecting && insp.inspection && prod.pdf ? (
        <div className="relative min-h-0 flex-1 bg-[hsl(var(--muted))]">
          {mode === 'structure' ? (
            <StructureView production={prod.pdf} inspection={insp.inspection} page={current} fileScale={fileScale} zoom={zoom} />
          ) : (
            <Layers3D production={prod.pdf} inspection={insp.inspection} page={current} />
          )}
        </div>
      ) : (
      <div
        ref={viewportRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className={cn(
          'relative min-h-0 flex-1 overflow-auto bg-[hsl(var(--muted))]',
          zoom > 1 && 'cursor-grab active:cursor-grabbing',
        )}
        style={{ backgroundImage: 'radial-gradient(hsl(var(--border)) 1px, transparent 1px)', backgroundSize: '18px 18px' }}
      >
        {production?.image ? (
          <img src={production.url} alt={production.name} className="h-full w-full object-contain p-6" />
        ) : error ? (
          <p className="p-6 text-center text-sm text-destructive">Não foi possível abrir o PDF ({error}).</p>
        ) : loading || !layout ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="flex min-h-full min-w-full w-max items-center justify-center">
            {layout.frames.map((frame) => {
              const info = frame.key === 'prod' ? prodPage! : origPage!
              const w = (frame.box[2] - frame.box[0]) * layout.scale
              const h = (frame.box[3] - frame.box[1]) * layout.scale
              const toFrame = (b: Box | null): Box | null =>
                b
                  ? [
                      (b[0] - frame.box[0]) * layout.scale,
                      (frame.box[3] - b[3]) * layout.scale,
                      (b[2] - frame.box[0]) * layout.scale,
                      (frame.box[3] - b[1]) * layout.scale,
                    ]
                  : null
              const size = finalMm(info.trim)
              const bleed = info.trim && info.bleed ? minBleedMm(info.trim, info.bleed) * fileScale : null
              const title =
                mode === 'side' ? (frame.key === 'orig' ? 'Cliente' : 'Produção') : mode === 'curtain' ? null : null
              return (
                <div key={frame.key} className="relative shrink-0" style={{ width: w, height: h, margin: MARGIN }}>
                  {/* Medidas reais, acima da arte. */}
                  <div className="absolute -top-8 left-0 right-0 flex items-end justify-between gap-2 text-[11px] text-muted-foreground">
                    <span className="truncate font-semibold uppercase tracking-wide text-foreground">{title}</span>
                    {guides && size && (
                      <span className="whitespace-nowrap tabular-nums">
                        <span style={{ color: GUIDES.trim.color }}>■</span> {fmt(size[0])} × {fmt(size[1])} mm
                        {bleed !== null && (
                          <>
                            {'  '}
                            <span style={{ color: GUIDES.bleed.color }}>■</span> sangria {fmt(bleed)} mm
                          </>
                        )}
                      </span>
                    )}
                  </div>

                  {mode === 'curtain' ? (
                    <Curtain canvases={canvases} position={curtain} onChange={setCurtain} />
                  ) : (
                    <CanvasSlot canvas={canvases[frame.key] ?? null} />
                  )}

                  {guides && (mode !== 'curtain' && mode !== 'diff' ? true : !!prodPage) && (
                    <GuideTicks
                      w={w}
                      h={h}
                      trim={toFrame((mode === 'curtain' || mode === 'diff' ? prodPage! : info).trim)}
                      bleed={toFrame((mode === 'curtain' || mode === 'diff' ? prodPage! : info).bleed)}
                    />
                  )}
                </div>
              )
            })}
          </div>
        )}

        {drawing && layout && (
          <Loader2 className="pointer-events-none absolute right-3 top-3 h-4 w-4 animate-spin text-muted-foreground" />
        )}
        {correcting && (
          <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground shadow">
            <Loader2 className="mr-1.5 inline h-3 w-3 animate-spin" />
            Aplicando correções… a nova versão aparece aqui ao terminar
          </div>
        )}
      </div>
      )}

      {/* Legenda do que está na tela. */}
      <StageFooter>
        {inspecting ? (
          <span>
            Só inspeção: nada aqui altera o arquivo.{' '}
            {mode === 'structure'
              ? 'Clique num objeto, na arte ou na lista, para ver o tamanho real e o que importa nele.'
              : 'Cada placa é um tipo de objeto; passe o mouse no nome para destacar.'}
          </span>
        ) : mode === 'diff' ? (
          <span>
            <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: `rgb(${DIFF.join(',')})` }} />
            Em ciano: o que mudou em relação ao arquivo do cliente
            {diffShare !== null && ` (${diffShare < 0.1 && diffShare > 0 ? '<0,1' : diffShare.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% da área)`}. O resto aparece apagado.
          </span>
        ) : mode === 'curtain' ? (
          <span>Arraste a linha: à esquerda o arquivo do cliente, à direita o de produção.</span>
        ) : mode === 'client' ? (
          <span>Arquivo do cliente, como chegou: {client?.name}</span>
        ) : changes.length ? (
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <Wand2 className="h-3.5 w-3.5 text-primary" />
            <span>O sistema fez:</span>
            {changes.map((fix, i) => (
              <span key={`${fix.id}-${i}`} className="rounded bg-muted px-1.5 py-0.5 text-foreground" title={fix.details.join('\n')}>
                {i + 1}. {fix.label}
              </span>
            ))}
            {comparable && (
              <button type="button" className="font-medium text-primary hover:underline" onClick={() => setMode('diff')}>
                ver na arte
              </button>
            )}
          </span>
        ) : (
          <span>{production?.name}</span>
        )}
        <span className="ml-auto hidden whitespace-nowrap sm:inline">Ctrl + roda do mouse: zoom · arraste para mover</span>
      </StageFooter>
    </div>
  )
}

function StageFooter({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-t border-border px-3 py-2 text-xs text-muted-foreground">{children}</div>
  )
}

/** Mostra uma tela já desenhada, no tamanho do quadro. */
function CanvasSlot({ canvas }: { canvas: HTMLCanvasElement | null }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.replaceChildren()
    if (canvas) {
      canvas.style.width = '100%'
      canvas.style.height = '100%'
      canvas.style.display = 'block'
      el.appendChild(canvas)
    }
  }, [canvas])
  return <div ref={ref} className="h-full w-full shadow-lg" />
}

/** Cliente embaixo, produção por cima a partir da linha arrastável. */
function Curtain({
  canvases,
  position,
  onChange,
}: {
  canvases: Record<string, HTMLCanvasElement | null>
  position: number
  onChange: (value: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const move = (clientX: number) => {
    const rect = ref.current?.getBoundingClientRect()
    if (rect) onChange(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)))
  }
  return (
    <div ref={ref} className="relative h-full w-full">
      <div className="absolute inset-0">
        <CanvasSlot canvas={canvases.orig ?? null} />
      </div>
      <div className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${position * 100}%)` }}>
        <CanvasSlot canvas={canvases.prod ?? null} />
      </div>
      <div
        data-handle="1"
        role="slider"
        aria-label="Divisão entre cliente e produção"
        aria-valuenow={Math.round(position * 100)}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') onChange(Math.max(0, position - 0.02))
          if (e.key === 'ArrowRight') onChange(Math.min(1, position + 0.02))
        }}
        onPointerDown={(e) => {
          e.stopPropagation()
          ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => e.buttons === 1 && move(e.clientX)}
        className="absolute -bottom-6 -top-6 w-6 -translate-x-1/2 cursor-ew-resize"
        style={{ left: `${position * 100}%` }}
      >
        <div data-handle="1" className="mx-auto h-full w-0.5 bg-primary" />
        <span data-handle="1" className="absolute -top-1 left-1/2 -translate-x-full whitespace-nowrap pr-2 text-[10px] font-semibold uppercase text-muted-foreground">
          Cliente
        </span>
        <span data-handle="1" className="absolute -top-1 left-1/2 whitespace-nowrap pl-2 text-[10px] font-semibold uppercase text-primary">
          Produção
        </span>
      </div>
    </div>
  )
}

/** Guias por fora da arte, alinhadas às linhas de corte, como marcas de corte reais. */
function GuideTicks({ w, h, trim, bleed }: { w: number; h: number; trim: Box | null; bleed: Box | null }) {
  const rects = { bleed, trim }
  return (
    <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={w} height={h} aria-hidden>
      {(Object.keys(GUIDES) as (keyof typeof GUIDES)[]).map((key) => {
        const rect = rects[key]
        if (!rect) return null
        const [near, far] = key === 'trim' ? [4, 14] : [16, 26]
        const ticks = [
          ...[rect[0], rect[2]].flatMap((x) => [
            [x, -far, x, -near],
            [x, h + near, x, h + far],
          ]),
          ...[rect[1], rect[3]].flatMap((y) => [
            [-far, y, -near, y],
            [w + near, y, w + far, y],
          ]),
        ]
        return ticks.map(([x1, y1, x2, y2], i) => (
          <line key={`${key}-${i}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={GUIDES[key].color} strokeWidth={1.5} />
        ))
      })}
    </svg>
  )
}

/** Página desenhada dentro de um quadro do espaço do PDF (mesmo ponto → mesmo pixel). */
async function renderInto(pdf: LoadedPdf, pageNumber: number, px: number, frame: Box, layers?: PdfLayer[]) {
  return renderPage(pdf, pageNumber, px, layers, frame)
}

/** Produção apagada em cinza, com os pixels que mudaram em ciano; e a parte que mudou. */
function difference(prod: HTMLCanvasElement, orig: HTMLCanvasElement) {
  const width = prod.width
  const height = prod.height
  const a = prod.getContext('2d')!.getImageData(0, 0, width, height)
  const b = orig.getContext('2d')!.getImageData(0, 0, width, height)
  const out = new ImageData(width, height)
  let changed = 0
  let painted = 0
  for (let i = 0; i < a.data.length; i += 4) {
    const alphaA = a.data[i + 3]
    const alphaB = b.data[i + 3]
    if (!alphaA && !alphaB) continue
    painted++
    const delta =
      Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2])
    if ((alphaA > 0) !== (alphaB > 0) || delta > 36) {
      changed++
      out.data[i] = DIFF[0]
      out.data[i + 1] = DIFF[1]
      out.data[i + 2] = DIFF[2]
      out.data[i + 3] = 255
    } else {
      const gray = (a.data[i] * 0.3 + a.data[i + 1] * 0.59 + a.data[i + 2] * 0.11) * 0.35 + 165
      out.data[i] = out.data[i + 1] = out.data[i + 2] = gray
      out.data[i + 3] = alphaA
    }
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d')!.putImageData(out, 0, 0)
  return { canvas, share: painted ? (changed / painted) * 100 : 0 }
}

function minBleedMm(trim: Box, bleed: Box) {
  return Math.max(0, Math.min(trim[0] - bleed[0], trim[1] - bleed[1], bleed[2] - trim[2], bleed[3] - trim[3])) / MM
}

/**
 * Prévia da base branca (DTF/DTG), só de tela. `color` é a arte com fundo transparente (o
 * branco do arquivo usa Multiplicar e não aparece); a placa vem do arquivo de inspeção,
 * tirada do próprio PDF. Cor: a arte sobre a peça. Branco: só a placa sobre cinza escuro.
 * Na peça: a placa sobre a cor da peça e a arte multiplicada por cima, então a tinta
 * sem branco embaixo (o choke) escurece como no tecido.
 */
function composeWhite(
  color: HTMLCanvasElement,
  plate: { box: Box; image: HTMLImageElement } | undefined,
  frame: Box,
  px: number,
  view: WhiteView,
  garment: string,
): HTMLCanvasElement {
  const { width, height } = color
  const out = document.createElement('canvas')
  out.width = width
  out.height = height
  const ctx = out.getContext('2d')!
  ctx.fillStyle = view === 'white' ? '#3f3f46' : garment
  ctx.fillRect(0, 0, width, height)
  if (view !== 'color' && plate) {
    const [x0, y0, x1, y1] = plate.box
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(plate.image, (x0 - frame[0]) * px, (frame[3] - y1) * px, (x1 - x0) * px, (y1 - y0) * px)
  }
  if (view !== 'white') {
    ctx.globalCompositeOperation = view === 'garment' ? 'multiply' : 'source-over'
    ctx.drawImage(color, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
  }
  return out
}
