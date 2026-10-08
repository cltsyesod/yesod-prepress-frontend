import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2, Minus, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type Box = [number, number, number, number]

interface PageBoxes {
  trim: Box | null
  bleed: Box | null
}

interface PdfPreviewProps {
  url: string
  page: number
  onPageChange: (page: number) => void
}

const MM = 72 / 25.4

// Cores das guias de tela (as mesmas da legenda). Magenta fica reservado para a faca
// real do arquivo (CutContour), para a guia nunca ser confundida com um corte.
const GUIDES = {
  bleed: { label: 'Sangria (BleedBox)', color: '#3b82f6', dash: '' },
  trim: { label: 'Formato final (TrimBox)', color: '#22c55e', dash: '' },
} as const

// Espaço em volta da página para as guias, que ficam sempre do lado de fora da arte.
const GUIDE_ROOM = 22

/**
 * Pré-visualização do PDF com as guias de pré-impressão (TrimBox e BleedBox), que o
 * visualizador do navegador não mostra. Nenhuma guia é desenhada sobre a arte: a
 * sangria é uma moldura por fora da área impressa e o formato final aparece como
 * marcas na margem, alinhadas às linhas de corte, como as marcas de corte reais.
 */
export function PdfPreview({ url, page, onPageChange }: PdfPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [doc, setDoc] = useState<import('pdfjs-dist').PDFDocumentProxy | null>(null)
  const [boxes, setBoxes] = useState<PageBoxes[]>([])
  const [error, setError] = useState('')
  const [area, setArea] = useState({ width: 0, height: 0 })
  const [zoom, setZoom] = useState(1)
  const [showGuides, setShowGuides] = useState(true)
  // Camadas do PDF (ex.: a faca CutContour): o operador liga e desliga como no Acrobat.
  const [layers, setLayers] = useState<{ id: string; name: string; visible: boolean }[]>([])
  const [overlay, setOverlay] = useState<{ w: number; h: number; rects: Record<string, Box | null> }>()

  // Carrega o documento (pdf.js para desenhar, pdf-lib para ler TrimBox/BleedBox).
  useEffect(() => {
    let cancelled = false
    let loaded: import('pdfjs-dist').PDFDocumentProxy | null = null
    setDoc(null)
    setError('')
    ;(async () => {
      try {
        const [pdfjs, worker, pdfLib, bytes] = await Promise.all([
          import('pdfjs-dist'),
          import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
          import('pdf-lib'),
          fetch(url).then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            return res.arrayBuffer()
          }),
        ])
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default
        const pageBoxes = await readBoxes(pdfLib, bytes.slice(0))
        loaded = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise
        const config = await loaded.getOptionalContentConfig()
        const groups = [...config].map(([id, group]) => ({
          id,
          name: group.name || 'Camada',
          visible: group.visible,
        }))
        if (cancelled) return
        setBoxes(pageBoxes)
        setLayers(groups)
        setDoc(loaded)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
      loaded?.destroy()
    }
  }, [url])

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) =>
      setArea({ width: entry.contentRect.width, height: entry.contentRect.height }),
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // Peça com faca: o formato final é a própria faca, então só a sangria é marcada.
  const dieCut = layers.some((layer) => /cut|corte|faca|contour|kiss/i.test(layer.name))

  const pageCount = doc?.numPages ?? 0
  const current = Math.min(Math.max(page, 1), pageCount || 1)

  // Desenha a página e calcula as guias no mesmo viewport.
  useEffect(() => {
    if (!doc || !area.width || !area.height || !canvasRef.current) return
    let task: import('pdfjs-dist').RenderTask | null = null
    let cancelled = false
    ;(async () => {
      const pdfPage = await doc.getPage(current)
      const base = pdfPage.getViewport({ scale: 1 })
      // 100% = página inteira visível (sem rolagem); o zoom só amplia a partir disso.
      const room = 16 + GUIDE_ROOM * 2
      const fit = Math.min((area.width - room) / base.width, (area.height - room) / base.height)
      const viewport = pdfPage.getViewport({ scale: fit * zoom })
      const canvas = canvasRef.current
      if (!canvas || cancelled) return
      const ratio = window.devicePixelRatio || 1
      canvas.width = Math.floor(viewport.width * ratio)
      canvas.height = Math.floor(viewport.height * ratio)
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`
      const optional = await doc.getOptionalContentConfig()
      for (const layer of layers) optional.setVisibility(layer.id, layer.visible)
      task = pdfPage.render({
        canvas,
        viewport,
        transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
        optionalContentConfigPromise: Promise.resolve(optional),
      })
      await task.promise.catch(() => null)

      const toView = (box: Box | null): Box | null => {
        if (!box) return null
        const [x0, y0, x1, y1] = viewport.convertToViewportRectangle(box)
        return [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)]
      }
      const info = boxes[current - 1] ?? { trim: null, bleed: null }
      if (!cancelled) {
        setOverlay({
          w: viewport.width,
          h: viewport.height,
          rects: {
            bleed: toView(info.bleed),
            trim: dieCut ? null : toView(info.trim),
          },
        })
      }
    })()
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [doc, current, area, zoom, boxes, layers, dieCut])

  const info = boxes[current - 1]
  const missing = doc && info && !info.trim

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-2 text-sm">
        <Button size="icon" variant="ghost" className="h-8 w-8" disabled={current <= 1} onClick={() => onPageChange(current - 1)} aria-label="Página anterior">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="tabular-nums text-muted-foreground">
          {pageCount ? `${current} de ${pageCount}` : '—'}
        </span>
        <Button size="icon" variant="ghost" className="h-8 w-8" disabled={current >= pageCount} onClick={() => onPageChange(current + 1)} aria-label="Próxima página">
          <ChevronRight className="h-4 w-4" />
        </Button>
        <span className="mx-1 h-4 w-px bg-border" />
        <Button size="icon" variant="ghost" className="h-8 w-8" disabled={zoom <= 0.5} onClick={() => setZoom((z) => z / 1.25)} aria-label="Diminuir zoom">
          <Minus className="h-4 w-4" />
        </Button>
        <button className="tabular-nums text-muted-foreground hover:text-foreground" onClick={() => setZoom(1)}>
          {Math.round(zoom * 100)}%
        </button>
        <Button size="icon" variant="ghost" className="h-8 w-8" disabled={zoom >= 6} onClick={() => setZoom((z) => z * 1.25)} aria-label="Aumentar zoom">
          <Plus className="h-4 w-4" />
        </Button>
        <span className="mx-1 h-4 w-px bg-border" />
        <label
          className="flex cursor-pointer items-center gap-1.5 text-muted-foreground"
          title="Linhas só de conferência na tela; não vão para o PDF nem para a impressão"
        >
          <input type="checkbox" checked={showGuides} onChange={(e) => setShowGuides(e.target.checked)} />
          Guias de tela
        </label>
        {showGuides && (
          <div className="flex flex-wrap items-center gap-3 text-xs">
            {Object.entries(GUIDES).filter(([key]) => !dieCut || key === 'bleed').map(([key, guide]) => (
              <span key={key} className="flex items-center gap-1">
                <svg width="18" height="6" aria-hidden>
                  <line x1="0" y1="3" x2="18" y2="3" stroke={guide.color} strokeWidth="2" strokeDasharray={guide.dash} />
                </svg>
                {guide.label}
              </span>
            ))}
          </div>
        )}
        {layers.length > 0 && <span className="mx-1 h-4 w-px bg-border" />}
        {layers.map((layer) => (
          <label
            key={layer.id}
            className="flex cursor-pointer items-center gap-1.5 text-muted-foreground"
            title="Camada do próprio PDF (ex.: a faca que vai para o plotter)"
          >
            <input
              type="checkbox"
              checked={layer.visible}
              onChange={(e) =>
                setLayers((prev) =>
                  prev.map((l) => (l.id === layer.id ? { ...l, visible: e.target.checked } : l)),
                )
              }
            />
            {layer.name}
            <span className="text-xs">(camada do PDF)</span>
          </label>
        ))}
        {dieCut && showGuides && (
          <span className="text-xs text-muted-foreground">Formato final = a faca</span>
        )}
        {missing && !dieCut && (
          <span className="text-xs text-amber-600 dark:text-amber-400">Sem TrimBox: linha de corte não definida</span>
        )}
      </div>

      <div
        ref={containerRef}
        className={cn(
          'relative min-h-0 flex-1 bg-muted p-2',
          zoom > 1 ? 'overflow-auto' : 'flex items-center justify-center overflow-hidden',
        )}
      >
        {error ? (
          <p className="p-6 text-center text-sm text-destructive">Não foi possível abrir o PDF ({error}).</p>
        ) : !doc ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : null}
        <div className={cn('relative mx-auto w-fit', !doc && 'hidden')} style={{ margin: GUIDE_ROOM }}>
          <canvas ref={canvasRef} className="block bg-white shadow-md" />
          {showGuides && overlay && (
            // Só na margem em volta da página: nenhuma linha passa por cima do que é impresso.
            <svg
              className="pointer-events-none absolute left-0 top-0 overflow-visible"
              width={overlay.w}
              height={overlay.h}
              aria-hidden
            >
              {(Object.keys(GUIDES) as (keyof typeof GUIDES)[]).map((key) => {
                const rect = overlay.rects[key]
                if (!rect) return null
                // Formato final mais perto da página, sangria mais longe: não se sobrepõem.
                const [near, far] = key === 'trim' ? [3, 11] : [12, GUIDE_ROOM - 2]
                const { w, h } = overlay
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
          )}
        </div>
      </div>
    </div>
  )
}

/** TrimBox e BleedBox de cada página, somente quando definidas no arquivo. */
async function readBoxes(pdfLib: typeof import('pdf-lib'), bytes: ArrayBuffer): Promise<PageBoxes[]> {
  try {
    const pdf = await pdfLib.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
    return pdf.getPages().map((p) => {
      const asBox = (r: { x: number; y: number; width: number; height: number }): Box => [
        r.x,
        r.y,
        r.x + r.width,
        r.y + r.height,
      ]
      return {
        trim: p.node.TrimBox() ? asBox(p.getTrimBox()) : null,
        bleed: p.node.BleedBox() ? asBox(p.getBleedBox()) : null,
      }
    })
  } catch {
    return []
  }
}

export const mmToPt = (mm: number) => mm * MM
