import { useEffect, useState } from 'react'

/** Caixa no espaço do PDF, em pontos: [x0, y0, x1, y1]. */
export type Box = [number, number, number, number]

export interface PageInfo {
  /** Área que o visualizador mostra (CropBox ou MediaBox). */
  view: Box
  trim: Box | null
  bleed: Box | null
}

export interface PdfLayer {
  id: string
  name: string
  visible: boolean
}

export interface LoadedPdf {
  doc: import('pdfjs-dist').PDFDocumentProxy
  pages: PageInfo[]
  layers: PdfLayer[]
}

/**
 * Abre um PDF para a mesa de trabalho: pdf.js desenha, pdf-lib lê as caixas
 * (TrimBox/BleedBox), que o pdf.js não expõe.
 */
export function usePdf(url: string | null) {
  const [pdf, setPdf] = useState<LoadedPdf | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!url) {
      setPdf(null)
      return
    }
    let cancelled = false
    let loaded: import('pdfjs-dist').PDFDocumentProxy | null = null
    setPdf(null)
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
        const boxes = await readBoxes(pdfLib, bytes.slice(0))
        loaded = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise
        const pages: PageInfo[] = []
        for (let n = 1; n <= loaded.numPages; n++) {
          const page = await loaded.getPage(n)
          const [x0, y0, x1, y1] = page.view
          pages.push({
            view: [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)],
            trim: boxes[n - 1]?.trim ?? null,
            bleed: boxes[n - 1]?.bleed ?? null,
          })
        }
        const config = await loaded.getOptionalContentConfig()
        const layers = [...config].map(([id, group]) => ({ id, name: group.name || 'Camada', visible: group.visible }))
        if (!cancelled) setPdf({ doc: loaded, pages, layers })
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
      loaded?.destroy()
    }
  }, [url])

  return { pdf, error }
}

async function readBoxes(pdfLib: typeof import('pdf-lib'), bytes: ArrayBuffer) {
  try {
    const pdf = await pdfLib.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
    const asBox = (r: { x: number; y: number; width: number; height: number }): Box => [r.x, r.y, r.x + r.width, r.y + r.height]
    return pdf.getPages().map((p) => ({
      trim: p.node.TrimBox() ? asBox(p.getTrimBox()) : null,
      bleed: p.node.BleedBox() ? asBox(p.getBleedBox()) : null,
    }))
  } catch {
    return []
  }
}

/**
 * Desenha uma página numa tela fora da vista, na escala pedida (px por ponto, já com a
 * densidade da tela). Com `frame`, a tela cobre esse quadro do espaço do PDF e a página
 * cai na sua posição exata, sem arredondar: dois arquivos desenhados no mesmo quadro
 * ficam alinhados pixel a pixel. As camadas desligadas não são desenhadas.
 */
export async function renderPage(
  pdf: LoadedPdf,
  pageNumber: number,
  pxPerPt: number,
  layers?: PdfLayer[],
  frame?: Box,
  /** Sem o papel branco: só o que é pintado (placas da vista 3D). */
  transparent = false,
): Promise<HTMLCanvasElement> {
  const page = await pdf.doc.getPage(pageNumber)
  const view = pdf.pages[pageNumber - 1].view
  const box = frame ?? view
  const viewport = page.getViewport({
    scale: pxPerPt,
    offsetX: (view[0] - box[0]) * pxPerPt,
    offsetY: (box[3] - view[3]) * pxPerPt,
  })
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round((box[2] - box[0]) * pxPerPt))
  canvas.height = Math.max(1, Math.round((box[3] - box[1]) * pxPerPt))
  // O pdf.js pede uma área de desenho opaca (fundo preto onde nada é pintado); criada
  // antes, com transparência, é a que ele recebe.
  if (transparent) canvas.getContext('2d', { alpha: true })
  const optional = await pdf.doc.getOptionalContentConfig()
  for (const layer of layers ?? []) optional.setVisibility(layer.id, layer.visible)
  await page.render({
    canvas,
    viewport,
    optionalContentConfigPromise: Promise.resolve(optional),
    ...(transparent ? { background: 'rgba(0,0,0,0)' } : {}),
  }).promise
  return canvas
}

// ---- Arquivo de inspeção: placas por tipo de objeto + mapa de objetos (do analisador) ----

export type ObjectKind = 'image' | 'text' | 'path' | 'shading' | 'cut'

export interface InspectedObject {
  id: string
  kind: ObjectKind
  /** Caixa na página, em pontos do PDF. */
  box: Box
  layer?: string
  // texto
  text?: string
  font?: string
  sizePt?: number
  embedded?: boolean | null
  // imagem
  px?: [number, number]
  /** Resolução no arquivo; no tamanho final, dividida pela escala. */
  ppi?: number | null
  colorSpace?: string
  bits?: number
  // vetor e faca (cores como a tela mostra, RGBA)
  fill?: [number, number, number, number] | null
  stroke?: [number, number, number, number] | null
  strokeWidthPt?: number | null
}

export interface InspectedPage {
  number: number
  objects: InspectedObject[]
  counts: Record<'image' | 'text' | 'path' | 'shading' | 'cut', number>
  truncated: boolean
  generatedBleed: boolean
}

export interface Inspection {
  pdf: LoadedPdf
  /** Ordem das placas de cada página no arquivo de inspeção. */
  plates: Plate[]
  pages: InspectedPage[]
}

export type Plate = 'images' | 'text' | 'vectors' | 'cut'

/** Abre o arquivo de inspeção e o mapa de objetos anexado a ele. Sem arquivo: null. */
export function useInspection(url: string | null) {
  const { pdf, error } = usePdf(url)
  const [inspection, setInspection] = useState<Inspection | null>(null)
  useEffect(() => {
    setInspection(null)
    if (!pdf) return
    let cancelled = false
    pdf.doc
      .getAttachments()
      .then((attachments: Record<string, { content: Uint8Array }> | null) => {
        const item = attachments?.['objects.json']
        if (!item || cancelled) return
        const data = JSON.parse(new TextDecoder().decode(item.content))
        setInspection({ pdf, plates: data.plates, pages: data.pages })
      })
      .catch(() => null)
    return () => {
      cancelled = true
    }
  }, [pdf])
  return { inspection, error }
}

export const union = (a: Box, b: Box): Box => [
  Math.min(a[0], b[0]),
  Math.min(a[1], b[1]),
  Math.max(a[2], b[2]),
  Math.max(a[3], b[3]),
]
