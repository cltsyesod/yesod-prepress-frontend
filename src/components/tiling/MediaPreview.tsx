import { Readout, fmt, fmtM, fmtMm, fmtMoney } from '@/components/tiling/fields'
import type { MediaLayout, MediaSettings } from '@/domain/tiling'

/**
 * Os painéis na mídia, como saem da impressora: o comprimento corre da esquerda para a
 * direita e a largura da mídia fica na vertical (margens e barra de cor em cinza).
 */
export function MediaPreview({
  layout,
  media,
  numbers,
}: {
  layout: MediaLayout | null
  media: MediaSettings | undefined
  numbers: Record<string, number>
}) {
  if (!layout) {
    return <p className="px-3 py-3 text-xs text-muted-foreground">Informe a largura da mídia (aba Mídia) para ver os painéis na mídia.</p>
  }
  const left = media && media.width > 0 ? media.marginLeft : 0
  const bar = media && media.width > 0 ? media.colorBar : 0
  const width = layout.width
  const length = Math.max(layout.length, 1)
  const pad = Math.max(width, length) * 0.01
  const font = Math.max(width, length) * 0.018

  return (
    <div className="flex h-full min-h-0 gap-4 p-3">
      <div className="min-w-0 flex-1">
        <svg className="h-full w-full" viewBox={`${-pad} ${-pad} ${length + 2 * pad} ${width + 2 * pad}`} preserveAspectRatio="xMinYMid meet">
          <rect x={0} y={0} width={length} height={width} fill="#f8fafc" stroke="#94a3b8" vectorEffect="non-scaling-stroke" />
          {left > 0 && <rect x={0} y={0} width={length} height={left} fill="#e2e8f0" />}
          {media && media.width > 0 && media.marginRight > 0 && (
            <rect x={0} y={width - media.marginRight} width={length} height={media.marginRight} fill="#e2e8f0" />
          )}
          {bar > 0 && (
            <rect x={0} y={left + layout.printableWidth} width={length} height={bar} fill="url(#colorbar)" opacity={0.7} />
          )}
          <defs>
            <linearGradient id="colorbar" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopColor="#06b6d4" />
              <stop offset="0.33" stopColor="#d946ef" />
              <stop offset="0.66" stopColor="#facc15" />
              <stop offset="1" stopColor="#111827" />
            </linearGradient>
          </defs>
          {layout.placements.map((p) => (
            <g key={p.tile}>
              <rect
                x={p.y}
                y={left + p.x}
                width={p.along}
                height={p.across}
                fill="#dbeafe"
                stroke="#2563eb"
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={p.y + p.along / 2}
                y={left + p.x + p.across / 2}
                fontSize={Math.min(font * 1.6, p.across * 0.4, p.along * 0.4)}
                fontWeight={700}
                fill="#1d4ed8"
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {String(numbers[p.tile] ?? '').padStart(2, '0')}
              </text>
              {p.rotation !== 0 && (
                <text x={p.y + font * 0.4} y={left + p.x + font} fontSize={font * 0.8} fill="#1e3a8a">
                  {p.rotation}°
                </text>
              )}
            </g>
          ))}
        </svg>
      </div>
      <div className="w-56 shrink-0 space-y-1">
        <Readout label="Largura da mídia" value={fmtMm(width)} />
        <Readout label="Largura imprimível" value={fmtMm(layout.printableWidth)} />
        <Readout label="Comprimento consumido" value={fmtM(layout.length)} strong />
        <Readout label="Área dos painéis" value={`${fmt(layout.panelArea, 2)} m²`} />
        <Readout label="Área de mídia" value={`${fmt(layout.mediaArea, 2)} m²`} />
        <Readout
          label="Desperdício"
          hint="Mídia consumida que não vira painel (margens, sobras na largura, marcas e espaços)"
          value={`${fmt(layout.waste * 100, 1)}%`}
          tone={layout.waste > 0.3 ? 'warning' : undefined}
        />
        <Readout label="Custo da mídia" value={layout.cost === null ? 'sem preço' : fmtMoney(layout.cost)} strong={layout.cost !== null} />
      </div>
    </div>
  )
}
