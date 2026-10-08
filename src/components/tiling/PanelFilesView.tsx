import { useMemo, useState } from 'react'
import { labelSizePt, labelWidthMm, type ProjectGeometry, type Rect, type TileGeometry } from '@/domain/tiling'
import type { CanvasImage } from '@/components/tiling/TilingCanvas'

const PT_PER_MM = 72 / 25.4
const fmtPt = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })

export interface FilesViewFinishing {
  marginMm: number
  cropMarks: boolean
  overlapMarks: boolean
  centerMarks: boolean
  label: boolean
  /** Etiqueta pronta de cada painel (pelo id L1C2). */
  labels: Map<string, { top: string; bottom: string }>
  panelEdge: boolean
  /** Prévia da faca pelo contorno (caminho SVG em mm da arte), ou null. */
  contour: string | null
}

/**
 * Os painéis como saem nos arquivos: cada um afastado dos vizinhos, com a margem técnica,
 * as marcas, a etiqueta e a faca. Assim nada aparece sobre a arte do painel ao lado.
 */
export function PanelFilesView({
  art,
  geometry,
  finishing,
  selected,
  onSelectTile,
}: {
  art: CanvasImage | null
  geometry: ProjectGeometry
  finishing: FilesViewFinishing
  selected: string[]
  onSelectTile: (key: string, additive: boolean) => void
}) {
  // Clicar num painel amplia só ele (marcas e etiqueta legíveis); "Todos" volta.
  const [focus, setFocus] = useState<string | null>(null)
  const all = geometry.tiles.filter((t) => t.enabled)
  const focused = all.find((t) => t.key === focus)
  const tiles = useMemo(() => (focused ? [focused] : all), [focused, all.map((t) => t.key).join()]) // eslint-disable-line react-hooks/exhaustive-deps
  const margin = Math.max(0, finishing.marginMm)
  const rows = Math.max(1, ...tiles.map((t) => t.row))

  const layout = useMemo(() => {
    const span = Math.max(...tiles.map((t) => Math.max(t.physical.x + t.physical.w, t.physical.y + t.physical.h)), 1)
    // Folga entre os arquivos: a margem de cada um e espaço para o nome acima da página.
    const spacing = 2 * margin + span * 0.045
    const placed = tiles.map((t) => {
      const dx = focused ? 0 : (t.column - 1) * spacing
      const dy = focused ? 0 : (rows - t.row) * spacing
      const page: Rect = {
        x: t.physical.x - margin + dx,
        y: t.physical.y - margin + dy,
        w: t.physical.w + 2 * margin,
        h: t.physical.h + 2 * margin,
      }
      return { t, dx, dy, page }
    })
    const x0 = Math.min(...placed.map((p) => p.page.x))
    const y0 = Math.min(...placed.map((p) => p.page.y))
    const x1 = Math.max(...placed.map((p) => p.page.x + p.page.w))
    const y1 = Math.max(...placed.map((p) => p.page.y + p.page.h))
    const pad = Math.max(x1 - x0, y1 - y0) * 0.02
    return { placed, extent: { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad } }
  }, [tiles, margin, rows, focused])

  if (!tiles.length) return null
  const { extent, placed } = layout
  const flipY = (y: number) => extent.y0 + extent.y1 - y
  const sizeMm = labelSizePt(margin) / PT_PER_MM
  const reach = Math.min(5, margin * 0.6)
  const gap = Math.min(1.5, margin * 0.2)
  const showMarks = margin >= 2

  /** Marcas de um painel (mm da arte, antes do deslocamento). */
  const marksOf = (t: TileGeometry) => {
    const { x, y, w, h } = t.physical
    const x1 = x + w
    const y1 = y + h
    const crop: string[] = []
    const dashed: string[] = []
    const center: string[] = []
    const vTicks = (cx: number) => [`M${cx} ${y - gap}V${y - gap - reach}`, `M${cx} ${y1 + gap}V${y1 + gap + reach}`]
    const hTicks = (cy: number) => [`M${x - gap} ${cy}H${x - gap - reach}`, `M${x1 + gap} ${cy}H${x1 + gap + reach}`]
    if (finishing.cropMarks) {
      for (const cx of [x, x1]) crop.push(...vTicks(cx))
      for (const cy of [y, y1]) crop.push(...hTicks(cy))
    }
    if (finishing.overlapMarks) {
      const l = t.logical
      const p = t.print
      if (t.overlap.left > 0) dashed.push(...vTicks(l.x), ...(Math.abs(p.x - x) > 0.5 ? vTicks(p.x) : []))
      if (t.overlap.right > 0)
        dashed.push(...vTicks(l.x + l.w), ...(Math.abs(p.x + p.w - x1) > 0.5 ? vTicks(p.x + p.w) : []))
      if (t.overlap.bottom > 0) dashed.push(...hTicks(l.y), ...(Math.abs(p.y - y) > 0.5 ? hTicks(p.y) : []))
      if (t.overlap.top > 0)
        dashed.push(...hTicks(l.y + l.h), ...(Math.abs(p.y + p.h - y1) > 0.5 ? hTicks(p.y + p.h) : []))
    }
    if (finishing.centerMarks) {
      center.push(...vTicks(t.logical.x + t.logical.w / 2), ...hTicks(t.logical.y + t.logical.h / 2))
    }
    return { crop: crop.join(''), dashed: dashed.join(''), center: center.join('') }
  }

  /** Corta a linha da etiqueta como o analisador faria (aproximado). */
  const fit = (text: string, width: number) => {
    if (!text) return ''
    if (labelWidthMm(text, margin) <= width) return text
    const chars = Math.max(0, Math.floor((text.length * width) / labelWidthMm(text, margin)) - 1)
    return chars >= 4 ? `${text.slice(0, chars)}…` : ''
  }

  return (
    <div className="relative h-full w-full">
      {focused && (
        <button
          type="button"
          className="absolute left-0 top-0 z-10 rounded border border-border bg-card px-2 py-1 text-xs hover:bg-accent"
          onClick={() => setFocus(null)}
        >
          ← Todos os painéis
        </button>
      )}
      {/* No arquivo a etiqueta tem o tamanho real (poucos mm); aqui ela aparece legível. */}
      {focused && finishing.label && finishing.labels.get(focused.id) && (
        <div className="pointer-events-none absolute bottom-0 right-0 z-10 max-w-[60%] space-y-0.5 rounded border border-border bg-card/95 px-2 py-1 text-[11px] leading-snug">
          <p className="text-muted-foreground">Etiqueta deste painel ({fmtPt(labelSizePt(margin))} pt no arquivo)</p>
          <p>
            <span className="text-muted-foreground">Em cima: </span>
            {finishing.labels.get(focused.id)!.top || '—'}
          </p>
          <p>
            <span className="text-muted-foreground">Embaixo: </span>
            {finishing.labels.get(focused.id)!.bottom || '—'}
          </p>
        </div>
      )}
    <svg
      className="h-full w-full select-none"
      viewBox={`${extent.x0} ${extent.y0} ${extent.x1 - extent.x0} ${extent.y1 - extent.y0}`}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        {placed.map(({ t }) => (
          <clipPath key={t.key} id={`print-${t.key}`}>
            <rect x={t.print.x} y={t.print.y} width={t.print.w} height={t.print.h} />
          </clipPath>
        ))}
      </defs>
      <g transform={`translate(0 ${extent.y0 + extent.y1}) scale(1 -1)`}>
        {placed.map(({ t, dx, dy, page }) => {
          const isSelected = selected.includes(t.key)
          const m = marksOf(t)
          return (
            <g
              key={t.key}
              className="cursor-pointer"
              onClick={(event) => {
                const additive = event.shiftKey || event.ctrlKey || event.metaKey
                onSelectTile(t.key, additive)
                if (!additive) setFocus(t.key)
              }}
            >
              {/* Página do arquivo: margem técnica em volta do painel físico. */}
              <rect
                x={page.x}
                y={page.y}
                width={page.w}
                height={page.h}
                fill="#ffffff"
                stroke={isSelected ? '#2563eb' : '#cbd5e1'}
                strokeWidth={isSelected ? 2.5 : 1}
                vectorEffect="non-scaling-stroke"
              />
              <g transform={`translate(${dx} ${dy})`}>
                {art && (
                  <g clipPath={`url(#print-${t.key})`}>
                    <image
                      href={art.url}
                      x={art.rect.x}
                      y={art.rect.y}
                      width={art.rect.w}
                      height={art.rect.h}
                      preserveAspectRatio="none"
                      transform={`translate(0 ${2 * art.rect.y + art.rect.h}) scale(1 -1)`}
                    />
                  </g>
                )}
                {/* Painel físico (com a área branca de colagem, sem tinta). */}
                <rect
                  x={t.physical.x}
                  y={t.physical.y}
                  width={t.physical.w}
                  height={t.physical.h}
                  fill="none"
                  stroke="#94a3b8"
                  strokeDasharray="2 3"
                  vectorEffect="non-scaling-stroke"
                />
                {showMarks && (
                  <>
                    {m.crop && <path d={m.crop} stroke="#0f172a" strokeWidth={1} fill="none" vectorEffect="non-scaling-stroke" />}
                    {m.dashed && (
                      <path d={m.dashed} stroke="#0f172a" strokeWidth={1} strokeDasharray="3 2" fill="none" vectorEffect="non-scaling-stroke" />
                    )}
                    {m.center && <path d={m.center} stroke="#0f172a" strokeWidth={2} fill="none" vectorEffect="non-scaling-stroke" />}
                  </>
                )}
                {finishing.contour && (
                  <path
                    d={finishing.contour}
                    clipPath={`url(#print-${t.key})`}
                    stroke="#db2777"
                    strokeWidth={1.5}
                    fill="none"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                {finishing.panelEdge && (
                  <rect
                    x={t.physical.x}
                    y={t.physical.y}
                    width={t.physical.w}
                    height={t.physical.h}
                    fill="none"
                    stroke="#db2777"
                    strokeWidth={1.5}
                    vectorEffect="non-scaling-stroke"
                  />
                )}
              </g>
            </g>
          )
        })}
      </g>

      {/* Textos fora do grupo invertido (senão sairiam de cabeça para baixo). */}
      {placed.map(({ t, dx, dy, page }) => {
        const lines = finishing.labels.get(t.id)
        const width = t.physical.w - 2 * 1.5 - 2 * gap
        const x = t.physical.x + dx + 1.5 + gap
        // Nome do painel acima da página, fora do arquivo (só tela).
        const tag = Math.max(extent.x1 - extent.x0, extent.y1 - extent.y0) * 0.014
        return (
          <g key={`text-${t.key}`} style={{ pointerEvents: 'none' }}>
            {finishing.label && showMarks && lines && (
              <>
                <text x={x} y={flipY(t.physical.y + t.physical.h + dy + margin / 2)} fontSize={sizeMm} dominantBaseline="middle" fill="#0f172a">
                  {fit(lines.top, width)}
                </text>
                <text x={x} y={flipY(t.physical.y + dy - margin / 2)} fontSize={sizeMm} dominantBaseline="middle" fill="#0f172a">
                  {fit(lines.bottom, width)}
                </text>
              </>
            )}
            <text
              x={page.x}
              y={flipY(page.y + page.h) - tag * 0.4}
              fontSize={tag}
              fontWeight={600}
              fill={selected.includes(t.key) ? '#2563eb' : '#475569'}
            >
              {String(t.number).padStart(2, '0')} · {t.id}
            </text>
          </g>
        )
      })}
    </svg>
    </div>
  )
}
