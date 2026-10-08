/**
 * Converte painelamentos salvos no formato anterior (emendas com lado da sobreposição) para
 * o modelo atual (sobreposição por painel e por borda, frestas por emenda).
 */

import { cellGroups } from './engine'
import { type Edges, type TileSettings, type TilingProjectModel, zeroEdges } from './model'

type LegacySide = 'next' | 'previous' | 'split'

interface LegacyConfig {
  fileScale?: number
  direction?: 'standing' | 'lying'
  materialWidthMm?: number
  materialLengthMm?: number
  settings?: {
    artWidthMm: number
    artHeightMm: number
    bleedMm: Edges
    overlapMm: number
    overlapSide: LegacySide
    gapMm: number
    nameTemplate: string
  }
  layout?: {
    xs: number[]
    ys: number[]
    merged: string[][]
    removed: string[]
    seams: Record<string, { kind: 'overlap' | 'gap' | 'butt'; widthMm?: number; side?: LegacySide }>
    overrides: Record<string, { name?: string; region?: string; number?: number }>
  }
}

/** Sobreposição padrão por borda equivalente a um lado: quem imprime a faixa. */
export function edgesForSide(side: LegacySide, width: number): Edges {
  if (side === 'split') return { top: width / 2, right: width / 2, bottom: width / 2, left: width / 2 }
  // "next": o painel da direita/de cima imprime (bordas esquerda e de baixo dele).
  if (side === 'next') return { top: 0, right: 0, bottom: width, left: width }
  return { top: width, right: width, bottom: 0, left: 0 }
}

export function isLegacy(config: unknown): config is LegacyConfig {
  return !!config && typeof config === 'object' && 'layout' in config && !('project' in config)
}

export function migrateLegacy(config: LegacyConfig): TilingProjectModel | null {
  const s = config.settings
  const l = config.layout
  if (!s || !l) return null
  const project: TilingProjectModel = {
    version: 2,
    poster: {
      width: s.artWidthMm,
      height: s.artHeightMm,
      scale: config.fileScale ?? 1,
      availableBleed: { ...zeroEdges(), ...s.bleedMm },
    },
    grid: { xs: l.xs, ys: l.ys, mode: 'custom', lockedColumns: [], lockedRows: [] },
    merged: l.merged ?? [],
    tiles: {},
    gaps: {},
    rules: {
      overlap: edgesForSide(s.overlapSide, s.overlapMm),
      white: zeroEdges(),
      bleed: { ...zeroEdges(), ...s.bleedMm },
      minimumTile: 10,
    },
    constraint: {
      printableWidth: config.materialWidthMm ?? 0,
      printableLength: config.materialLengthMm ?? 0,
      direction: config.direction ?? 'standing',
    },
    nameTemplate: (s.nameTemplate || '').replaceAll('{trabalho}', '{projeto}'),
  }

  const tiles: Record<string, TileSettings> = {}
  const removed = new Set(l.removed ?? [])
  for (const [key, o] of Object.entries(l.overrides ?? {})) {
    tiles[key] = { name: o.name || undefined, zone: o.region || undefined, number: o.number }
  }

  // Emendas: fresta vira fresta centralizada; sobreposição com lado/largura próprios vira
  // ajuste nas bordas dos dois painéis daquela emenda; topo a topo zera essas bordas.
  const groups = cellGroups(project)
  for (const [id, seam] of Object.entries(l.seams ?? {})) {
    const [kind, raw] = id.split(':')
    const index = Number(raw)
    if (seam.kind === 'gap') {
      project.gaps[id] = { width: seam.widthMm ?? s.gapMm, mode: 'centered' }
      continue
    }
    const width = seam.kind === 'butt' ? 0 : (seam.widthMm ?? s.overlapMm)
    const edges = edgesForSide(seam.side ?? s.overlapSide, width)
    for (const g of groups) {
      const t = (tiles[g.key] ??= {})
      if (kind === 'v' && g.c0 === index) t.overlap = { ...t.overlap, left: edges.left }
      if (kind === 'v' && g.c1 === index) t.overlap = { ...t.overlap, right: edges.right }
      if (kind === 'h' && g.r0 === index) t.overlap = { ...t.overlap, bottom: edges.bottom }
      if (kind === 'h' && g.r1 === index) t.overlap = { ...t.overlap, top: edges.top }
    }
  }
  for (const g of groups) {
    if (g.cells.some((cell) => removed.has(cell))) (tiles[g.key] ??= {}).enabled = false
  }
  project.tiles = tiles
  return project
}
