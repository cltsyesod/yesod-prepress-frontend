/**
 * Operações sobre o projeto de painelamento. Todas são puras: recebem o projeto e devolvem
 * um novo (a tela guarda o anterior para desfazer). Edições geométricas manuais marcam a
 * grade como "custom", para que nada as sobrescreva sem confirmação.
 */

import { cellGroups, cellKey, parseCell } from './engine'
import {
  type Edge,
  type Edges,
  type GapSetting,
  type Poster,
  type PrintConstraint,
  type TileSettings,
  type TilingProjectModel,
  type TilingRules,
} from './model'

const EPS = 0.01

/** Linhas de corte para cobrir `length` com painéis que caibam em `max` (0 = sem limite). */
export function autoLines(
  length: number,
  max: number,
  extra: { start: number; end: number; before: number; after: number },
  mode: 'equal' | 'max',
): number[] {
  if (!(max > 0) || length <= 0) return [0, length]
  const physical = (visible: number, first: boolean, last: boolean) =>
    visible + (first ? extra.start : extra.before) + (last ? extra.end : extra.after)
  if (mode === 'equal') {
    for (let n = 1; n <= 500; n++) {
      const visible = length / n
      const worst = Math.max(
        physical(visible, true, n === 1),
        n > 1 ? physical(visible, false, true) : 0,
        n > 2 ? physical(visible, false, false) : 0,
      )
      if (worst <= max + EPS) return equalLines(length, n)
    }
    return [0, length]
  }
  const lines = [0]
  let pos = 0
  for (let i = 0; i < 500; i++) {
    const first = i === 0
    if (physical(length - pos, first, true) <= max + EPS) break
    const visible = max - (first ? extra.start : extra.before) - extra.after
    if (visible <= 1) break
    pos += visible
    lines.push(pos)
  }
  lines.push(length)
  return lines
}

export const equalLines = (length: number, n: number) =>
  Array.from({ length: Math.max(1, n) + 1 }, (_, i) => (length * i) / Math.max(1, n))

export interface GridRequest {
  mode: 'equal' | 'max'
  /** Colunas/linhas pedidas (0 = calcular pelo material). */
  columns?: number
  rows?: number
}

/** Grade automática pelo material e pelas regras padrão (sobreposição, branco, sangria). */
export function autoGrid(project: TilingProjectModel, request: GridRequest): TilingProjectModel {
  const { poster, rules, constraint } = project
  const bleed = (e: Edge) => Math.min(rules.bleed[e], poster.availableBleed[e])
  const standing = constraint.direction === 'standing'
  const maxW = standing ? constraint.printableWidth : constraint.printableLength
  const maxH = standing ? constraint.printableLength : constraint.printableWidth
  const xs =
    request.columns && request.columns > 0
      ? equalLines(poster.width, Math.round(request.columns))
      : autoLines(
          poster.width,
          maxW,
          {
            start: bleed('left') + rules.white.left,
            end: bleed('right') + rules.white.right,
            before: rules.overlap.left + rules.white.left,
            after: rules.overlap.right + rules.white.right,
          },
          request.mode,
        )
  const ys =
    request.rows && request.rows > 0
      ? equalLines(poster.height, Math.round(request.rows))
      : autoLines(
          poster.height,
          maxH,
          {
            start: bleed('bottom') + rules.white.bottom,
            end: bleed('top') + rules.white.top,
            before: rules.overlap.bottom + rules.white.bottom,
            after: rules.overlap.top + rules.white.top,
          },
          request.mode,
        )
  return {
    ...project,
    grid: { xs, ys, mode: 'auto', lockedColumns: [], lockedRows: [] },
    merged: [],
    tiles: {},
    gaps: {},
  }
}

export function newProject(
  poster: Poster,
  constraint: PrintConstraint,
  rules: TilingRules,
  nameTemplate: string,
  request: GridRequest,
): TilingProjectModel {
  return autoGrid(
    {
      version: 2,
      poster,
      grid: { xs: [0, poster.width], ys: [0, poster.height], mode: 'auto', lockedColumns: [], lockedRows: [] },
      merged: [],
      tiles: {},
      gaps: {},
      rules,
      constraint,
      nameTemplate,
    },
    request,
  )
}

const custom = (project: TilingProjectModel): TilingProjectModel => ({
  ...project,
  grid: { ...project.grid, mode: 'custom' },
})

/** Larguras das colunas (ou alturas das linhas, de baixo para cima). */
export const sizes = (lines: number[]) => lines.slice(1).map((v, i) => v - lines[i])

/** Define as larguras das colunas (ou alturas das linhas); a última absorve o arredondamento. */
export function setSizes(
  project: TilingProjectModel,
  orientation: 'vertical' | 'horizontal',
  values: number[],
): TilingProjectModel {
  const total = orientation === 'vertical' ? project.poster.width : project.poster.height
  if (values.length < 1 || values.some((v) => !(v > 0))) return project
  const lines = [0]
  for (const v of values.slice(0, -1)) lines.push(lines[lines.length - 1] + v)
  if (lines[lines.length - 1] >= total - project.rules.minimumTile) return project
  lines.push(total)
  const sameCount = lines.length === (orientation === 'vertical' ? project.grid.xs : project.grid.ys).length
  const next = custom(project)
  return {
    ...next,
    grid: { ...next.grid, [orientation === 'vertical' ? 'xs' : 'ys']: lines },
    // Com outro número de colunas/linhas, junções e ajustes por painel deixam de valer.
    ...(sameCount ? {} : { merged: [], tiles: {}, gaps: {} }),
  }
}

/**
 * Move uma linha de corte. Como uma sanfona: se encostar no mínimo da vizinha, empurra as
 * seguintes, sem nunca deixar coluna/linha menor que o mínimo nem mudar as travadas.
 */
export function moveLine(project: TilingProjectModel, id: string, position: number): TilingProjectModel {
  const [kind, raw] = id.split(':')
  const index = Number(raw)
  const vertical = kind === 'v'
  const lines = [...(vertical ? project.grid.xs : project.grid.ys)]
  const locked = new Set(vertical ? project.grid.lockedColumns : project.grid.lockedRows)
  const min = project.rules.minimumTile
  if (index <= 0 || index >= lines.length - 1) return project
  // Uma linha presa a uma coluna travada não se move.
  if (locked.has(index - 1) || locked.has(index)) return project

  // Até onde dá para ir: cada coluna/linha empurrada fica com pelo menos o mínimo.
  const count = lines.length - 1
  const low = lines[0] + index * min
  const high = lines[count] - (count - index) * min
  const target = Math.round(Math.min(high, Math.max(low, position)) * 10) / 10
  const old = [...lines]
  lines[index] = target
  // Empurra para a direita/cima.
  for (let i = index + 1; i < lines.length - 1; i++) {
    if (lines[i] - lines[i - 1] >= min) break
    if (locked.has(i)) return project
    lines[i] = lines[i - 1] + min
  }
  // Empurra para a esquerda/baixo.
  for (let i = index - 1; i > 0; i--) {
    if (lines[i + 1] - lines[i] >= min) break
    if (locked.has(i - 1)) return project
    lines[i] = lines[i + 1] - min
  }
  if (lines[lines.length - 1] - lines[lines.length - 2] < min - EPS || lines[1] - lines[0] < min - EPS) return project
  if (lines.some((v, i) => i > 0 && v <= lines[i - 1])) return project
  if (old.every((v, i) => Math.abs(v - lines[i]) < EPS)) return project
  const next = custom(project)
  return { ...next, grid: { ...next.grid, [vertical ? 'xs' : 'ys']: lines } }
}

export function toggleLock(project: TilingProjectModel, orientation: 'vertical' | 'horizontal', index: number) {
  const key = orientation === 'vertical' ? 'lockedColumns' : 'lockedRows'
  const current = new Set(project.grid[key])
  if (current.has(index)) current.delete(index)
  else current.add(index)
  return { ...project, grid: { ...project.grid, [key]: [...current].sort((a, b) => a - b) } }
}

type Remap = (cell: string) => string | null

/** Reaplica um remapeamento de células a junções, ajustes por painel e frestas. */
function remap(project: TilingProjectModel, cell: Remap, gap: (id: string) => string | null): TilingProjectModel {
  const merged = project.merged
    .map((group) => [...new Set(group.map(cell).filter((c): c is string => c !== null))])
    .filter((group) => group.length > 1)
  const tiles: Record<string, TileSettings> = {}
  for (const [key, value] of Object.entries(project.tiles)) {
    const moved = cell(key)
    if (moved && !(moved in tiles)) tiles[moved] = value
  }
  const gaps: Record<string, GapSetting> = {}
  for (const [id, value] of Object.entries(project.gaps)) {
    const moved = gap(id)
    if (moved) gaps[moved] = value
  }
  return { ...project, merged, tiles, gaps }
}

/** Nova linha de corte em toda a grade (divide colunas/linhas atravessadas). */
export function addLine(project: TilingProjectModel, orientation: 'vertical' | 'horizontal', position: number): TilingProjectModel {
  const vertical = orientation === 'vertical'
  const lines = vertical ? project.grid.xs : project.grid.ys
  const min = project.rules.minimumTile
  const index = lines.findIndex((v) => v > position)
  if (index <= 0) return project
  if (position - lines[index - 1] < min - EPS || lines[index] - position < min - EPS) return project
  const next = [...lines.slice(0, index), position, ...lines.slice(index)]
  const shiftCell: Remap = (key) => {
    const [c, r] = parseCell(key)
    return vertical ? cellKey(c >= index ? c + 1 : c, r) : cellKey(c, r >= index ? r + 1 : r)
  }
  const shiftGap = (id: string) => {
    const [k, i] = id.split(':')
    const n = Number(i)
    return (k === 'v') === vertical && n >= index ? `${k}:${n + 1}` : id
  }
  let result = remap(project, shiftCell, shiftGap)
  // Grupos atravessados pela linha nova recebem as células criadas.
  result = {
    ...result,
    merged: result.merged.map((group) => {
      const coords = group.map(parseCell)
      const axis = coords.map(([c, r]) => (vertical ? c : r))
      if (!(Math.min(...axis) < index && Math.max(...axis) >= index + 1)) return group
      const extra = coords
        .filter(([c, r]) => (vertical ? c : r) === index - 1)
        .map(([c, r]) => (vertical ? cellKey(index, r) : cellKey(c, index)))
      return [...new Set([...group, ...extra])]
    }),
  }
  const locks = (vertical ? project.grid.lockedColumns : project.grid.lockedRows).map((i) => (i >= index ? i + 1 : i))
  const grid = custom(result).grid
  return {
    ...result,
    grid: {
      ...grid,
      [vertical ? 'xs' : 'ys']: next,
      [vertical ? 'lockedColumns' : 'lockedRows']: locks,
    },
  }
}

/** Apaga uma linha de corte: as duas colunas/linhas vizinhas viram uma, em toda a grade. */
export function removeLine(project: TilingProjectModel, id: string): TilingProjectModel {
  const [kind, raw] = id.split(':')
  const index = Number(raw)
  const vertical = kind === 'v'
  const lines = vertical ? project.grid.xs : project.grid.ys
  if (index <= 0 || index >= lines.length - 1) return project
  const collapse: Remap = (key) => {
    const [c, r] = parseCell(key)
    if (vertical) return cellKey(c >= index ? c - 1 : c, r)
    return cellKey(c, r >= index ? r - 1 : r)
  }
  const shiftGap = (gid: string) => {
    const [k, i] = gid.split(':')
    const n = Number(i)
    if ((k === 'v') !== vertical) return gid
    if (n === index) return null
    return n > index ? `${k}:${n - 1}` : gid
  }
  const result = remap(project, collapse, shiftGap)
  const locks = (vertical ? project.grid.lockedColumns : project.grid.lockedRows)
    .filter((i) => i !== index && i !== index - 1)
    .map((i) => (i > index ? i - 1 : i))
  const grid = custom(result).grid
  return {
    ...result,
    grid: {
      ...grid,
      [vertical ? 'xs' : 'ys']: lines.filter((_, i) => i !== index),
      [vertical ? 'lockedColumns' : 'lockedRows']: locks,
    },
  }
}

/** Junta painéis vizinhos num só, se formarem um retângulo. */
export function mergeTiles(project: TilingProjectModel, keys: string[]): TilingProjectModel | null {
  const groups = cellGroups(project).filter((g) => keys.includes(g.key))
  if (groups.length < 2) return null
  const cells = [...new Set(groups.flatMap((g) => g.cells))]
  const coords = cells.map(parseCell)
  const c0 = Math.min(...coords.map(([c]) => c))
  const c1 = Math.max(...coords.map(([c]) => c))
  const r0 = Math.min(...coords.map(([, r]) => r))
  const r1 = Math.max(...coords.map(([, r]) => r))
  if ((c1 - c0 + 1) * (r1 - r0 + 1) !== cells.length) return null
  const inside = new Set(cells)
  const merged = project.merged.filter((group) => !group.some((cell) => inside.has(cell)))
  merged.push(cells)
  // O painel novo herda os ajustes do primeiro (canto superior esquerdo).
  const head = cellKey(c0, r1)
  const tiles = { ...project.tiles }
  const inherited = groups.map((g) => project.tiles[g.key]).find(Boolean)
  for (const g of groups) delete tiles[g.key]
  if (inherited) tiles[head] = { ...inherited, number: undefined, name: undefined }
  return { ...custom(project), merged, tiles }
}

export function splitTile(project: TilingProjectModel, key: string): TilingProjectModel {
  const group = project.merged.find((g) => g.includes(key))
  if (!group) return project
  return { ...custom(project), merged: project.merged.filter((g) => g !== group) }
}

const patchTiles = (
  project: TilingProjectModel,
  keys: string[],
  patch: (current: TileSettings) => TileSettings,
): TilingProjectModel => {
  const tiles = { ...project.tiles }
  for (const key of keys) tiles[key] = patch(tiles[key] ?? {})
  // Ajuste manual: uma mudança global depois disso pede confirmação antes de recalcular.
  return { ...custom(project), tiles }
}

/** Desligar mantém o painel na grade, mas ele não é impresso (ex.: vidro, área sem material). */
export const setEnabled = (project: TilingProjectModel, keys: string[], enabled: boolean) =>
  patchTiles(project, keys, (t) => ({ ...t, enabled: enabled ? undefined : false }))

/** Sobreposição ou área branca de bordas escolhidas nos painéis escolhidos. */
export const setTileEdges = (
  project: TilingProjectModel,
  keys: string[],
  field: 'overlap' | 'white',
  edges: Partial<Edges>,
) => patchTiles(project, keys, (t) => ({ ...t, [field]: { ...t[field], ...edges } }))

/** Volta as bordas escolhidas ao padrão do projeto. */
export const resetTileEdges = (project: TilingProjectModel, keys: string[], field: 'overlap' | 'white') =>
  patchTiles(project, keys, (t) => ({ ...t, [field]: undefined }))

/** Aplica valores como padrão de toda a grade, descartando os ajustes por painel. */
export function applyToGrid(project: TilingProjectModel, field: 'overlap' | 'white', edges: Edges): TilingProjectModel {
  const tiles: Record<string, TileSettings> = {}
  for (const [key, value] of Object.entries(project.tiles)) tiles[key] = { ...value, [field]: undefined }
  return { ...project, rules: { ...project.rules, [field]: edges }, tiles }
}

export const setTileInfo = (
  project: TilingProjectModel,
  key: string,
  info: { name?: string; zone?: string; number?: number },
) => patchTiles(project, [key], (t) => ({ ...t, ...info }))

export function setGap(project: TilingProjectModel, seamId: string, gap: GapSetting | null): TilingProjectModel {
  const gaps = { ...project.gaps }
  if (gap && gap.width > 0) gaps[seamId] = gap
  else delete gaps[seamId]
  return { ...custom(project), gaps }
}

/** A grade foi editada à mão: recalcular pelos parâmetros globais pede confirmação. */
export const hasManualEdits = (project: TilingProjectModel) => project.grid.mode === 'custom'

/** Mesma estrutura numa arte de outro tamanho (modelo reutilizável). */
export function fitToPoster(project: TilingProjectModel, poster: Poster): TilingProjectModel {
  const fx = project.poster.width > 0 ? poster.width / project.poster.width : 1
  const fy = project.poster.height > 0 ? poster.height / project.poster.height : 1
  return {
    ...project,
    poster,
    grid: { ...project.grid, xs: project.grid.xs.map((x) => x * fx), ys: project.grid.ys.map((y) => y * fy) },
  }
}
