/**
 * Motor geométrico do painelamento: do projeto (configuração) para a geometria de cada
 * painel. Função pura: a tela só manipula o projeto e chama calculateProject().
 */

import {
  EDGES,
  type Edge,
  type Edges,
  type GapSetting,
  type ProjectGeometry,
  type Rect,
  type SeamGeometry,
  type TileGeometry,
  type TilingProjectModel,
  zeroEdges,
} from './model'
import { installIssues, installOrder } from './install'
import { layoutMedia, onMedia, orientationOf, rotationOf } from './media'
import { validateProject } from './validate'

export const cellKey = (c: number, r: number) => `${c},${r}`
export const parseCell = (key: string) => key.split(',').map(Number) as [number, number]

export interface CellGroup {
  key: string
  cells: string[]
  c0: number
  c1: number
  r0: number
  r1: number
}

/** Painéis da grade (células sozinhas ou juntadas), em ordem de leitura: de cima, da esquerda. */
export function cellGroups(project: TilingProjectModel): CellGroup[] {
  const columns = project.grid.xs.length - 1
  const rows = project.grid.ys.length - 1
  const groupOf = new Map<string, string[]>()
  for (const group of project.merged) for (const cell of group) groupOf.set(cell, group)
  const seen = new Set<string>()
  const result: CellGroup[] = []
  for (let r = rows - 1; r >= 0; r--) {
    for (let c = 0; c < columns; c++) {
      const start = cellKey(c, r)
      if (seen.has(start)) continue
      const cells = groupOf.get(start) ?? [start]
      cells.forEach((cell) => seen.add(cell))
      const coords = cells.map(parseCell)
      const c0 = Math.min(...coords.map(([x]) => x))
      const c1 = Math.max(...coords.map(([x]) => x)) + 1
      const r0 = Math.min(...coords.map(([, y]) => y))
      const r1 = Math.max(...coords.map(([, y]) => y)) + 1
      result.push({ key: cellKey(c0, r1 - 1), cells, c0, c1, r0, r1 })
    }
  }
  return result
}

const expand = (r: Rect, e: Edges): Rect => ({
  x: r.x - e.left,
  y: r.y - e.bottom,
  w: r.w + e.left + e.right,
  h: r.h + e.bottom + e.top,
})

/** Quanto da fresta de uma emenda sai do painel que está antes (esq./baixo) ou depois dela. */
function gapShare(gap: GapSetting | undefined, side: 'before' | 'after'): number {
  if (!gap || gap.width <= 0) return 0
  if (gap.mode === 'centered') return gap.width / 2
  return gap.mode === side ? gap.width : 0
}

export function fillName(
  template: string,
  values: {
    number: number
    row: number
    column: number
    zone: string
    install?: number
    project?: string
    client?: string
    revision?: number
  },
): string {
  const nn = String(values.number).padStart(2, '0')
  const text = (template || '{projeto}_L{lin}C{col}')
    .replaceAll('{rev}', `R${Math.max(1, Math.round(values.revision ?? 1))}`)
    .replaceAll('{ordem}', String(values.install ?? values.number).padStart(2, '0'))
    .replaceAll('{area}', values.zone)
    .replaceAll('{nn}', nn)
    .replaceAll('{n}', String(values.number))
    .replaceAll('{lin}', String(values.row))
    .replaceAll('{col}', String(values.column))
    .replaceAll('{zona}', values.zone)
    .replaceAll('{regiao}', values.zone)
    .replaceAll('{projeto}', values.project ?? '')
    .replaceAll('{trabalho}', values.project ?? '')
    .replaceAll('{cliente}', values.client ?? '')
  return text.trim() || `L${values.row}C${values.column}`
}

export function calculateProject(
  project: TilingProjectModel,
  /** `marksMargin`: margem técnica das marcas em volta de cada painel (gasta mídia). */
  context: { project?: string; client?: string; marksMargin?: number; revision?: number } = {},
): ProjectGeometry {
  const { xs, ys } = project.grid
  const columns = xs.length - 1
  const rows = ys.length - 1
  const groups = cellGroups(project)
  const settingsOf = (key: string) => project.tiles[key] ?? {}

  // Célula -> painel, para achar vizinhos ligados.
  const owner = new Map<string, CellGroup>()
  for (const g of groups) for (const cell of g.cells) owner.set(cell, g)
  const enabled = (g: CellGroup) => settingsOf(g.key).enabled !== false

  const neighbour = (g: CellGroup, edge: Edge): CellGroup | null => {
    const probe: [number, number][] = []
    if (edge === 'left' && g.c0 > 0) for (let r = g.r0; r < g.r1; r++) probe.push([g.c0 - 1, r])
    if (edge === 'right' && g.c1 < columns) for (let r = g.r0; r < g.r1; r++) probe.push([g.c1, r])
    if (edge === 'bottom' && g.r0 > 0) for (let c = g.c0; c < g.c1; c++) probe.push([c, g.r0 - 1])
    if (edge === 'top' && g.r1 < rows) for (let c = g.c0; c < g.c1; c++) probe.push([c, g.r1])
    for (const [c, r] of probe) {
      const other = owner.get(cellKey(c, r))
      if (other && enabled(other)) return other
    }
    return null
  }

  const idOf = (g: CellGroup) => `L${rows - g.r1 + 1}C${g.c0 + 1}`
  let counter = 0
  const drafts: TileGeometry[] = groups.map((g) => {
    const s = settingsOf(g.key)
    const on = s.enabled !== false
    const outer: Record<Edge, boolean> = {
      left: g.c0 === 0,
      right: g.c1 === columns,
      bottom: g.r0 === 0,
      top: g.r1 === rows,
    }
    // Lógico: a célula da grade menos a parte de cada fresta que cabe a este painel.
    const gapLeft = outer.left ? 0 : gapShare(project.gaps[`v:${g.c0}`], 'after')
    const gapRight = outer.right ? 0 : gapShare(project.gaps[`v:${g.c1}`], 'before')
    const gapBottom = outer.bottom ? 0 : gapShare(project.gaps[`h:${g.r0}`], 'after')
    const gapTop = outer.top ? 0 : gapShare(project.gaps[`h:${g.r1}`], 'before')
    const logical: Rect = {
      x: xs[g.c0] + gapLeft,
      y: ys[g.r0] + gapBottom,
      w: xs[g.c1] - xs[g.c0] - gapLeft - gapRight,
      h: ys[g.r1] - ys[g.r0] - gapBottom - gapTop,
    }

    const neighbours: Partial<Record<Edge, string>> = {}
    const overlap = zeroEdges()
    const bleed = zeroEdges()
    const white = zeroEdges()
    for (const edge of EDGES) {
      const next = neighbour(g, edge)
      if (next) neighbours[edge] = idOf(next)
      // Sobreposição só onde existe painel vizinho: fora da arte não há o que repetir.
      overlap[edge] = next ? Math.max(0, s.overlap?.[edge] ?? project.rules.overlap[edge]) : 0
      bleed[edge] = outer[edge]
        ? Math.max(0, Math.min(project.rules.bleed[edge], project.poster.availableBleed[edge]))
        : 0
      white[edge] = Math.max(0, s.white?.[edge] ?? project.rules.white[edge])
    }
    const extension: Edges = {
      top: overlap.top + bleed.top,
      right: overlap.right + bleed.right,
      bottom: overlap.bottom + bleed.bottom,
      left: overlap.left + bleed.left,
    }
    const print = expand(logical, extension)
    const physical = expand(print, white)
    if (on) counter += 1
    const number = s.number ?? (on ? counter : 0)
    const row = rows - g.r1 + 1
    const column = g.c0 + 1
    const zone = s.zone?.trim() ?? ''
    const rotation = rotationOf(orientationOf(physical.w, physical.h, project.constraint), { row, column }, project.constraint.flipFlop)
    return {
      key: g.key,
      cells: g.cells,
      id: idOf(g),
      number,
      row,
      column,
      // Preenchido depois da ordem de instalação (o nome pode usar {ordem}).
      name: '',
      zone,
      enabled: on,
      logical,
      print,
      physical,
      overlap,
      white,
      bleed,
      neighbours,
      rotation,
      install: 0,
    }
  })

  // Ordem de instalação (áreas e sequência); a numeração pode segui-la.
  const areas = installOrder(project, drafts.filter((t) => t.enabled))
  const installAt = new Map(areas.flatMap((a) => a.tiles).map((id, i) => [id, i + 1]))
  const byInstall = project.numbering === 'install'
  const tiles: TileGeometry[] = drafts.map((t) => {
    const s = settingsOf(t.key)
    const install = installAt.get(t.id) ?? 0
    const number = byInstall && t.enabled ? (s.number ?? install) : t.number
    const name =
      s.name ||
      fillName(project.nameTemplate, { number, install, row: t.row, column: t.column, zone: t.zone, ...context })
    return { ...t, install, number, name }
  })

  const seams: SeamGeometry[] = []
  for (let i = 1; i < xs.length - 1; i++) {
    seams.push({
      id: `v:${i}`,
      orientation: 'vertical',
      position: xs[i],
      start: 0,
      end: project.poster.height,
      gap: project.gaps[`v:${i}`] ?? null,
    })
  }
  for (let i = 1; i < ys.length - 1; i++) {
    seams.push({
      id: `h:${i}`,
      orientation: 'horizontal',
      position: ys[i],
      start: 0,
      end: project.poster.width,
      gap: project.gaps[`h:${i}`] ?? null,
    })
  }

  const active = tiles.filter((t) => t.enabled)
  const overlaps: Rect[] = []
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i].print
      const b = active[j].print
      const x0 = Math.max(a.x, b.x)
      const y0 = Math.max(a.y, b.y)
      const x1 = Math.min(a.x + a.w, b.x + b.w)
      const y1 = Math.min(a.y + a.h, b.y + b.h)
      if (x1 - x0 > 0.01 && y1 - y0 > 0.01) overlaps.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 })
    }
  }

  const widest = active.reduce((m, t) => Math.max(m, onMedia(t).across), 0)
  const mediaUsage = project.constraint.printableWidth > 0 ? Math.min(1, widest / project.constraint.printableWidth) : 0

  return {
    tiles: [...tiles].sort((a, b) => (a.enabled === b.enabled ? a.number - b.number : a.enabled ? -1 : 1)),
    seams,
    overlaps,
    issues: [...validateProject(project, tiles, { marksMargin: context.marksMargin }), ...installIssues(active, areas)],
    mediaUsage,
    media: layoutMedia(active, project.constraint, context.marksMargin ?? 0),
    areas,
  }
}
