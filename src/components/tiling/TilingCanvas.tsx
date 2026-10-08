import { useMemo, useRef, useState } from 'react'
import type { Rect, Seam, Tile } from '@/lib/tiling'

export interface CanvasImage {
  url: string
  /** Onde fica, em mm da arte. */
  rect: Rect
  opacity?: number
}

interface TilingCanvasProps {
  art: CanvasImage | null
  /** Formato final da arte (0,0 até largura × altura). */
  artSize: { w: number; h: number }
  background: CanvasImage | null
  tiles: Tile[]
  removed: { key: string; rect: Rect }[]
  seams: Seam[]
  overlaps: Rect[]
  selected: string[]
  selectedSeam: string | null
  onSelectTile: (key: string, additive: boolean) => void
  onSelectSeam: (id: string | null) => void
  onMoveSeam: (id: string, position: number) => void
  onMoveEnd: () => void
}

/**
 * Prancheta do painelamento em milímetros da arte (eixo Y para cima, como no PDF).
 * A arte inteira e a imagem de referência cabem na área, sem rolagem.
 */
export function TilingCanvas({
  art,
  artSize,
  background,
  tiles,
  removed,
  seams,
  overlaps,
  selected,
  selectedSeam,
  onSelectTile,
  onSelectSeam,
  onMoveSeam,
  onMoveEnd,
}: TilingCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const moved = useRef(false)

  const extent = useMemo(() => {
    const rects = [{ x: 0, y: 0, w: artSize.w, h: artSize.h }, ...tiles.map((t) => t.printed)]
    if (art) rects.push(art.rect)
    if (background) rects.push(background.rect)
    const x0 = Math.min(...rects.map((r) => r.x))
    const y0 = Math.min(...rects.map((r) => r.y))
    const x1 = Math.max(...rects.map((r) => r.x + r.w))
    const y1 = Math.max(...rects.map((r) => r.y + r.h))
    const pad = Math.max(x1 - x0, y1 - y0) * 0.03
    return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad }
  }, [art, background, tiles, artSize])

  // Y para cima: tudo é desenhado num grupo espelhado; textos são desespelhados.
  const flip = `translate(0 ${extent.y0 + extent.y1}) scale(1 -1)`
  const unit = Math.max(extent.x1 - extent.x0, extent.y1 - extent.y0) / 100

  const toMm = (event: React.PointerEvent): { x: number; y: number } | null => {
    const svg = svgRef.current
    const matrix = svg?.getScreenCTM()
    if (!svg || !matrix) return null
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
    return { x: point.x, y: extent.y0 + extent.y1 - point.y }
  }

  const label = (x: number, y: number, text: string, size: number, color: string, weight = 600) => (
    <text
      x={x}
      y={extent.y0 + extent.y1 - y}
      fontSize={size}
      fontWeight={weight}
      fill={color}
      textAnchor="middle"
      dominantBaseline="middle"
      style={{ pointerEvents: 'none', userSelect: 'none' }}
    >
      {text}
    </text>
  )

  return (
    <svg
      ref={svgRef}
      className="h-full w-full touch-none select-none"
      viewBox={`${extent.x0} ${extent.y0} ${extent.x1 - extent.x0} ${extent.y1 - extent.y0}`}
      preserveAspectRatio="xMidYMid meet"
      onPointerMove={(event) => {
        if (!dragging) return
        const point = toMm(event)
        if (!point) return
        moved.current = true
        onMoveSeam(dragging, dragging.startsWith('v') ? point.x : point.y)
      }}
      onPointerUp={() => {
        if (dragging && moved.current) onMoveEnd()
        setDragging(null)
      }}
      onPointerLeave={() => {
        if (dragging && moved.current) onMoveEnd()
        setDragging(null)
      }}
      onClick={(event) => {
        if (event.target === svgRef.current) onSelectSeam(null)
      }}
    >
      <g transform={flip}>
        {art && (
          <image
            href={art.url}
            x={art.rect.x}
            y={art.rect.y}
            width={art.rect.w}
            height={art.rect.h}
            preserveAspectRatio="none"
            transform={`translate(0 ${2 * art.rect.y + art.rect.h}) scale(1 -1)`}
          />
        )}
        {background && (
          <image
            href={background.url}
            x={background.rect.x}
            y={background.rect.y}
            width={background.rect.w}
            height={background.rect.h}
            opacity={background.opacity ?? 0.6}
            preserveAspectRatio="none"
            transform={`translate(0 ${2 * background.rect.y + background.rect.h}) scale(1 -1)`}
            style={{ pointerEvents: 'none' }}
          />
        )}
        <rect
          x={0}
          y={0}
          width={artSize.w}
          height={artSize.h}
          fill="none"
          stroke="#64748b"
          strokeDasharray="4 3"
          vectorEffect="non-scaling-stroke"
        />

        {/* Área impressa de cada painel (inclui sobreposição e sangria). */}
        {tiles.map((t) => (
          <rect
            key={`p-${t.key}`}
            x={t.printed.x}
            y={t.printed.y}
            width={t.printed.w}
            height={t.printed.h}
            fill="none"
            stroke={t.tooBig ? '#dc2626' : '#38bdf8'}
            strokeDasharray="6 4"
            vectorEffect="non-scaling-stroke"
            style={{ pointerEvents: 'none' }}
          />
        ))}
        {overlaps.map((r, i) => (
          <rect key={`o-${i}`} x={r.x} y={r.y} width={r.w} height={r.h} fill="#f97316" opacity={0.4} style={{ pointerEvents: 'none' }} />
        ))}
        {seams
          .filter((s) => s.kind === 'gap' && s.widthMm > 0)
          .map((s) => (
            <rect
              key={`g-${s.id}`}
              x={s.orientation === 'vertical' ? s.position - s.widthMm / 2 : s.start}
              y={s.orientation === 'vertical' ? s.start : s.position - s.widthMm / 2}
              width={s.orientation === 'vertical' ? s.widthMm : s.end - s.start}
              height={s.orientation === 'vertical' ? s.end - s.start : s.widthMm}
              fill="#1e293b"
              opacity={0.55}
              style={{ pointerEvents: 'none' }}
            />
          ))}

        {removed.map((r) => (
          <rect
            key={`r-${r.key}`}
            x={r.rect.x}
            y={r.rect.y}
            width={r.rect.w}
            height={r.rect.h}
            fill="#ef4444"
            fillOpacity={selected.includes(r.key) ? 0.35 : 0.18}
            stroke="#ef4444"
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
            className="cursor-pointer"
            onClick={(event) => {
              event.stopPropagation()
              onSelectTile(r.key, event.shiftKey || event.ctrlKey || event.metaKey)
            }}
          />
        ))}

        {tiles.map((t) => {
          const isSelected = selected.includes(t.key)
          return (
            <rect
              key={`v-${t.key}`}
              x={t.visible.x}
              y={t.visible.y}
              width={t.visible.w}
              height={t.visible.h}
              fill={isSelected ? '#2563eb' : 'transparent'}
              fillOpacity={isSelected ? 0.15 : 0}
              stroke={t.tooBig ? '#dc2626' : '#2563eb'}
              strokeWidth={isSelected ? 3 : 1.5}
              vectorEffect="non-scaling-stroke"
              className="cursor-pointer"
              onClick={(event) => {
                event.stopPropagation()
                onSelectTile(t.key, event.shiftKey || event.ctrlKey || event.metaKey)
              }}
            />
          )
        })}

        {/* Linhas de divisão: arraste para mover, clique para escolher o tipo da emenda. */}
        {seams.map((s) => {
          const vertical = s.orientation === 'vertical'
          const active = selectedSeam === s.id
          const coords = vertical
            ? { x1: s.position, x2: s.position, y1: s.start, y2: s.end }
            : { x1: s.start, x2: s.end, y1: s.position, y2: s.position }
          return (
            <g key={`s-${s.id}`}>
              {active && <line {...coords} stroke="#facc15" strokeWidth={3} vectorEffect="non-scaling-stroke" />}
              <line
                {...coords}
                stroke="transparent"
                strokeWidth={14}
                vectorEffect="non-scaling-stroke"
                className={vertical ? 'cursor-ew-resize' : 'cursor-ns-resize'}
                onPointerDown={(event) => {
                  event.stopPropagation()
                  ;(event.target as Element).setPointerCapture?.(event.pointerId)
                  moved.current = false
                  setDragging(s.id)
                }}
                onClick={(event) => {
                  event.stopPropagation()
                  if (!moved.current) onSelectSeam(s.id)
                }}
              />
            </g>
          )
        })}
      </g>

      {/* Números e regiões, fora do grupo espelhado para não ficarem de cabeça para baixo. */}
      {tiles.map((t) => {
        const size = Math.min(unit * 4, Math.min(t.visible.w, t.visible.h) * 0.22)
        const cx = t.visible.x + t.visible.w / 2
        const cy = t.visible.y + t.visible.h / 2
        return (
          <g key={`n-${t.key}`}>
            {label(cx, cy, String(t.number).padStart(2, '0'), size, t.tooBig ? '#dc2626' : '#1d4ed8', 700)}
            {t.region && label(cx, cy - size * 0.9, t.region, size * 0.38, '#1e3a8a', 500)}
          </g>
        )
      })}
    </svg>
  )
}
