import { useEffect, useState } from 'react'

export type PdfBox = [number, number, number, number]

export interface PdfPageImage {
  url: string
  pageCount: number
  /** Caixas da página em pontos do PDF. */
  visible: PdfBox
  trim: PdfBox
  bleed: PdfBox | null
}

const MAX_PX = 2400

/** Renderiza uma página do PDF numa imagem (para pranchetas) e lê suas caixas. */
export function usePdfPageImage(url: string, pageNumber: number) {
  const [image, setImage] = useState<PdfPageImage | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!url) {
      setImage(null)
      return
    }
    let cancelled = false
    let objectUrl = ''
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
        const doc = await pdfLib.PDFDocument.load(bytes.slice(0), { ignoreEncryption: true, updateMetadata: false })
        const pages = doc.getPages()
        const libPage = pages[Math.min(pageNumber, pages.length) - 1]
        const asBox = (r: { x: number; y: number; width: number; height: number }): PdfBox => [
          r.x,
          r.y,
          r.x + r.width,
          r.y + r.height,
        ]
        const media = asBox(libPage.getMediaBox())
        const crop = libPage.node.CropBox() ? asBox(libPage.getCropBox()) : media
        const visible: PdfBox = [
          Math.max(media[0], crop[0]),
          Math.max(media[1], crop[1]),
          Math.min(media[2], crop[2]),
          Math.min(media[3], crop[3]),
        ]
        const trim = libPage.node.TrimBox() ? asBox(libPage.getTrimBox()) : visible
        const bleed = libPage.node.BleedBox() ? asBox(libPage.getBleedBox()) : null

        const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise
        const page = await pdf.getPage(Math.min(pageNumber, pdf.numPages))
        const base = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({ scale: MAX_PX / Math.max(base.width, base.height) })
        const canvas = document.createElement('canvas')
        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        await page.render({ canvas, viewport }).promise
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
        const pageCount = pdf.numPages
        await pdf.destroy()
        if (cancelled || !blob) return
        objectUrl = URL.createObjectURL(blob)
        setImage({ url: objectUrl, pageCount, visible, trim, bleed })
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [url, pageNumber])

  return { image, error }
}
