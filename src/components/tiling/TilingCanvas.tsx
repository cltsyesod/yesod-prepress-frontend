import { useMemo, useRef, useState } from 'react'
import type { ProjectGeometry, Rect } from '@/domain/tiling'

export interface CanvasImage {
  url: string
  /** Onde fica, em mm da arte. */
  rect: Rect
  opacity?: number
}

interface TilingCanvasProps {
  art: CanvasImage | null
  poster: { w: number; h: number }
  background: CanvasImage | null
  geometry: ProjectGeometry
  selected: string[]
  selectedSeam: string | null
  /** Painéis com erro de produção (contorno vermelho). */
  flagged: Set<string>
  onSelectTile: (key: string, additive: boolean) => void
  onSelectSeam: (id: string | null) => void
  onMoveSeam: (id: string, position: number) => void
  onMoveEnd: () => void
}

/**
 * Prancheta do painelamento em milímetros da arte (eixo Y para cima, como no PDF). Mostra a
 * pré-visualização leve da arte; a geometria vem toda do motor. Cabe inteira, sem rolagem.
 */
export function TilingCanvas({
  art,
  poster,
  background,
  geometry,
  selected,
  selectedSeam,
  flagged,
  onSelectTile,
  onSelectSeam,
  onMoveSeam,
  onMoveEnd,
}: TilingCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const moved = useRef(false)
  const { tiles, seams, overlaps } = geometry

  const extent = useMemo(() => {
    const rects = [{ x: 0, y: 0, w: poster.w, h: poster.h }, ...tiles.map((t) => t.physical)]
    if (art) rects.push(art.rect)
    if (background) rects.push(background.rect)
    const x0 = Math.min(...rects.map((r) => r.x))
    const y0 = Math.min(...rects.map((r) => r.y))
    const x1 = Math.max(...rects.map((r) => r.x + r.w))
    const y1 = Math.max(...rects.map((r) => r.y + r.h))
    const pad = Math.max(x1 - x0, y1 - y0) * 0.03
    return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad }
  }, [art, background, tiles, poster])

  const flip = `translate(0 ${extent.y0 + extent.y1}) scale(1 -1)`
  const unit = Math.max(extent.x1 - extent.x0, extent.y1 - extent.y0) / 100

  const toMm = (event: React.PointerEvent): { x: number; y: number } | null => {
    const matrix = svgRef.current?.getScreenCTM()
    if (!matrix) return null
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
    return { x: point.x, y: extent.y0 + extent.y1 - point.y }
  }

  const text = (x: number, y: number, value: string, size: number, color: string, weight = 600) => (
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
      {value}
    </text>
  )

  const box = (r: Rect, props: React.SVGProps<SVGRectElement>) => (
    <rect x={r.x} y={r.y} width={r.w} height={r.h} vectorEffect="non-scaling-stroke" {...props} />
  )

  const finishDrag = () => {
    if (dragging && moved.current) onMoveEnd()
    setDragging(null)
  }

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
      onPointerUp={finishDrag}
      onPointerLeave={finishDrag}
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
        {box({ x: 0, y: 0, w: poster.w, h: poster.h }, { fill: 'none', stroke: '#64748b', strokeDasharray: '4 3' })}

        {/* Painel físico (com área branca de colagem) e janela impressa. */}
        {tiles
          .filter((t) => t.enabled)
          .map((t) => (
            <g key={`p-${t.key}`} style={{ pointerEvents: 'none' }}>
              {(t.physical.w > t.print.w || t.physical.h > t.print.h) &&
                box(t.physical, { fill: '#ffffff', fillOpacity: 0.35, stroke: '#94a3b8', strokeDasharray: '2 3' })}
              {box(t.print, { fill: 'none', stroke: flagged.has(t.id) ? '#dc2626' : '#38bdf8', strokeDasharray: '6 4' })}
            </g>
          ))}
        {overlaps.map((r, i) => (
          <rect key={`o-${i}`} x={r.x} y={r.y} width={r.w} height={r.h} fill="#f97316" opacity={0.4} style={{ pointerEvents: 'none' }} />
        ))}
        {seams
          .filter((s) => s.gap)
          .map((s) => {
            const g = s.gap!
            const start = g.mode === 'centered' ? s.position - g.width / 2 : g.mode === 'before' ? s.position - g.width : s.position
            const r =
              s.orientation === 'vertical'
                ? { x: start, y: s.start, w: g.width, h: s.end - s.start }
                : { x: s.start, y: start, w: s.end - s.start, h: g.width }
            return <rect key={`g-${s.id}`} x={r.x} y={r.y} width={r.w} height={r.h} fill="#1e293b" opacity={0.55} style={{ pointerEvents: 'none' }} />
          })}

        {tiles.map((t) => {
          const isSelected = selected.includes(t.key)
          const select = (event: React.MouseEvent) => {
            event.stopPropagation()
            onSelectTile(t.key, event.shiftKey || event.ctrlKey || event.metaKey)
          }
          if (!t.enabled) {
            return (
              <rect
                key={`v-${t.key}`}
                x={t.logical.x}
                y={t.logical.y}
                width={t.logical.w}
                height={t.logical.h}
                fill="#ef4444"
                fillOpacity={isSelected ? 0.35 : 0.18}
                stroke="#ef4444"
                strokeDasharray="3 3"
                vectorEffect="non-scaling-stroke"
                className="cursor-pointer"
                onClick={select}
              />
            )
          }
          return (
            <rect
              key={`v-${t.key}`}
              x={t.logical.x}
              y={t.logical.y}
              width={t.logical.w}
              height={t.logical.h}
              fill={isSelected ? '#2563eb' : 'transparent'}
              fillOpacity={isSelected ? 0.15 : 0}
              stroke={flagged.has(t.id) ? '#dc2626' : '#2563eb'}
              strokeWidth={isSelected ? 3 : 1.5}
              vectorEffect="non-scaling-stroke"
              className="cursor-pointer"
              onClick={select}
            />
          )
        })}

        {/* Linhas de divisão: arraste para mover, clique para escolher a emenda. */}
        {seams.map((s) => {
          const vertical = s.orientation === 'vertical'
          const coords = vertical
            ? { x1: s.position, x2: s.position, y1: s.start, y2: s.end }
            : { x1: s.start, x2: s.end, y1: s.position, y2: s.position }
          return (
            <g key={`s-${s.id}`}>
              {selectedSeam === s.id && <line {...coords} stroke="#facc15" strokeWidth={3} vectorEffect="non-scaling-stroke" />}
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

      {tiles.map((t) => {
        const size = Math.min(unit * 4, Math.min(t.logical.w, t.logical.h) * 0.22)
        const cx = t.logical.x + t.logical.w / 2
        const cy = t.logical.y + t.logical.h / 2
        const color = !t.enabled ? '#b91c1c' : flagged.has(t.id) ? '#dc2626' : '#1d4ed8'
        return (
          <g key={`n-${t.key}`}>
            {text(cx, cy + size * 0.35, t.enabled ? String(t.number).padStart(2, '0') : 'não imprime', t.enabled ? size : size * 0.4, color, 700)}
            {text(cx, cy - size * 0.55, t.id, size * 0.38, color, 600)}
            {t.zone && text(cx, cy - size * 1.05, t.zone, size * 0.34, '#1e3a8a', 500)}
          </g>
        )
      })}
    </svg>
  )
}
