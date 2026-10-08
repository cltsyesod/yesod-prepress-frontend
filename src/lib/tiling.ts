/**
 * Painelamento: geometria dos painéis, em mm no tamanho final, com origem no canto inferior
 * esquerdo do formato final da arte (TrimBox).
 *
 * A divisão é uma grade (linhas de corte verticais `xs` e horizontais `ys`). Células podem
 * ser juntadas (formando um retângulo) ou removidas (não impressas, ex.: vidro). Cada emenda
 * da grade é sobreposição (a arte se repete nos dois painéis), fresta (a faixa da arte que cai
 * na fresta não é impressa) ou topo a topo.
 */

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export type SeamKind = 'overlap' | 'gap' | 'butt'

export interface SeamSetting {
  kind: SeamKind
  /** Largura da fresta (só para "gap"). */
  widthMm?: number
}

export interface TilingLayout {
  /** Linhas de corte verticais, incluindo 0 e a largura da arte. */
  xs: number[]
  /** Linhas de corte horizontais, incluindo 0 e a altura da arte. */
  ys: number[]
  /** Grupos de células ("c,r") juntadas num só painel. */
  merged: string[][]
  /** Células (ou a primeira célula de um grupo) que não são impressas. */
  removed: string[]
  /** Emendas com tipo diferente do padrão: "v:<índice em xs>" ou "h:<índice em ys>". */
  seams: Record<string, SeamSetting>
  /** Nome, região e número escolhidos à mão, por painel (chave = célula de origem). */
  overrides: Record<string, { name?: string; region?: string; number?: number }>
}

export interface TilingSettings {
  artWidthMm: number
  artHeightMm: number
  /** Sangria disponível no arquivo, por lado (mm no tamanho final). */
  bleedMm: { left: number; bottom: number; right: number; top: number }
  /** Maior largura e altura que um painel pode ter impresso (0 = sem limite). */
  maxWidthMm: number
  maxHeightMm: number
  mode: 'equal' | 'max'
  overlapMm: number
  /** "next": o painel seguinte cobre o anterior; "split": metade para cada lado. */
  overlapSide: 'next' | 'split'
  gapMm: number
  nameTemplate: string
}

export interface Tile {
  key: string
  number: number
  name: string
  region: string
  column: number
  row: number
  cells: string[]
  visible: Rect
  printed: Rect
  tooBig: boolean
}

export interface Seam {
  id: string
  orientation: 'vertical' | 'horizontal'
  position: number
  start: number
  end: number
  kind: SeamKind
  widthMm: number
}

const EPS = 0.01

/** Linhas de corte internas para cobrir `length` com painéis de no máximo `max` impressos. */
export function autoCuts(
  length: number,
  max: number,
  /** Quanto cada painel imprime além do visível: sangria nas pontas, emendas antes/depois. */
  extend: { start: number; end: number; before: number; after: number },
  mode: 'equal' | 'max',
): number[] {
  if (!(max > 0) || length <= 0) return [0, length]
  const printed = (visible: number, first: boolean, last: boolean) =>
    visible + (first ? extend.start : extend.before) + (last ? extend.end : extend.after)

  if (mode === 'equal') {
    for (let n = 1; n <= 500; n++) {
      const visible = length / n
      const worst = Math.max(
        printed(visible, true, n === 1),
        n > 1 ? printed(visible, false, true) : 0,
        n > 2 ? printed(visible, false, false) : 0,
      )
      if (worst <= max + EPS) return Array.from({ length: n + 1 }, (_, i) => (length * i) / n)
    }
    return [0, length]
  }

  // Máximo + resto: cada painel o maior possível; o último fica com o que sobrar.
  const cuts = [0]
  let pos = 0
  for (let i = 0; i < 500; i++) {
    const first = i === 0
    if (printed(length - pos, first, true) <= max + EPS) break
    const visible = max - (first ? extend.start : extend.before) - extend.after
    if (visible <= 1) break
    pos += visible
    cuts.push(pos)
  }
  cuts.push(length)
  return cuts
}

export function newLayout(settings: TilingSettings): TilingLayout {
  // "next": o painel seguinte (direita / de cima) imprime a sobreposição; "split": metade cada.
  const split = settings.overlapSide === 'split'
  const before = split ? settings.overlapMm / 2 : settings.overlapMm
  const after = split ? settings.overlapMm / 2 : 0
  const b = settings.bleedMm
  const xs = autoCuts(
    settings.artWidthMm,
    settings.maxWidthMm,
    { start: b.left, end: b.right, before, after },
    settings.mode,
  )
  // Na vertical o painel de cima cobre o de baixo: a extensão fica "antes" de quem está acima.
  const ys = autoCuts(
    settings.artHeightMm,
    settings.maxHeightMm,
    { start: b.bottom, end: b.top, before, after },
    settings.mode,
  )
  return { xs, ys, merged: [], removed: [], seams: {}, overrides: {} }
}

const cellKey = (c: number, r: number) => `${c},${r}`
const parseCell = (key: string) => key.split(',').map(Number) as [number, number]

export function seamSetting(layout: TilingLayout, id: string): SeamSetting {
  return layout.seams[id] ?? { kind: 'overlap' }
}

/** Painéis (grupos de células) da grade, com o que cada um mostra e imprime. */
export function computeTiles(
  layout: TilingLayout,
  settings: TilingSettings,
  context: { job?: string; client?: string } = {},
): { tiles: Tile[]; seams: Seam[] } {
  const { xs, ys } = layout
  const columns = xs.length - 1
  const rows = ys.length - 1
  const groupOf = new Map<string, string[]>()
  for (const group of layout.merged) for (const cell of group) groupOf.set(cell, group)

  const seen = new Set<string>()
  const raw: { key: string; cells: string[]; c0: number; c1: number; r0: number; r1: number }[] = []
  // Leitura de cima para baixo, da esquerda para a direita (ordem de instalação padrão).
  for (let r = rows - 1; r >= 0; r--) {
    for (let c = 0; c < columns; c++) {
      const key = cellKey(c, r)
      if (seen.has(key)) continue
      const cells = groupOf.get(key) ?? [key]
      cells.forEach((cell) => seen.add(cell))
      const coords = cells.map(parseCell)
      const c0 = Math.min(...coords.map(([cc]) => cc))
      const c1 = Math.max(...coords.map(([cc]) => cc)) + 1
      const r0 = Math.min(...coords.map(([, rr]) => rr))
      const r1 = Math.max(...coords.map(([, rr]) => rr)) + 1
      raw.push({ key: cellKey(c0, r1 - 1), cells, c0, c1, r0, r1 })
    }
  }

  const removed = new Set(layout.removed)
  const gapOf = (id: string) => {
    const seam = seamSetting(layout, id)
    return seam.kind === 'gap' ? (seam.widthMm ?? settings.gapMm) : 0
  }
  const overlapExtend = (id: string, isNext: boolean) => {
    const seam = seamSetting(layout, id)
    if (seam.kind !== 'overlap' || settings.overlapMm <= 0) return 0
    if (settings.overlapSide === 'split') return settings.overlapMm / 2
    return isNext ? settings.overlapMm : 0
  }

  const visibleTiles = raw.filter((t) => !t.cells.some((cell) => removed.has(cell)))
  let counter = 0
  const tiles: Tile[] = visibleTiles.map((t) => {
    const left = t.c0 === 0 ? 0 : gapOf(`v:${t.c0}`) / 2
    const right = t.c1 === columns ? 0 : gapOf(`v:${t.c1}`) / 2
    const bottom = t.r0 === 0 ? 0 : gapOf(`h:${t.r0}`) / 2
    const top = t.r1 === rows ? 0 : gapOf(`h:${t.r1}`) / 2
    const visible: Rect = {
      x: xs[t.c0] + left,
      y: ys[t.r0] + bottom,
      w: xs[t.c1] - xs[t.c0] - left - right,
      h: ys[t.r1] - ys[t.r0] - bottom - top,
    }
    const b = settings.bleedMm
    // Vertical: o painel da direita cobre o da esquerda. Horizontal: o de cima cobre o de baixo
    // (como telhas, a água não entra na emenda).
    const extLeft = t.c0 === 0 ? b.left : overlapExtend(`v:${t.c0}`, true)
    const extRight = t.c1 === columns ? b.right : overlapExtend(`v:${t.c1}`, false)
    const extBottom = t.r0 === 0 ? b.bottom : overlapExtend(`h:${t.r0}`, true)
    const extTop = t.r1 === rows ? b.top : overlapExtend(`h:${t.r1}`, false)
    const printed: Rect = {
      x: visible.x - extLeft,
      y: visible.y - extBottom,
      w: visible.w + extLeft + extRight,
      h: visible.h + extBottom + extTop,
    }
    counter += 1
    const override = layout.overrides[t.key] ?? {}
    const number = override.number ?? counter
    const column = t.c0 + 1
    const row = rows - t.r1 + 1
    const region = override.region ?? ''
    return {
      key: t.key,
      number,
      name: override.name || fillName(settings.nameTemplate, { number, column, row, region, ...context }),
      region,
      column,
      row,
      cells: t.cells,
      visible,
      printed,
      tooBig:
        (settings.maxWidthMm > 0 && printed.w > settings.maxWidthMm + EPS) ||
        (settings.maxHeightMm > 0 && printed.h > settings.maxHeightMm + EPS),
    }
  })

  const seams: Seam[] = []
  for (let i = 1; i < xs.length - 1; i++) {
    const s = seamSetting(layout, `v:${i}`)
    seams.push({
      id: `v:${i}`,
      orientation: 'vertical',
      position: xs[i],
      start: 0,
      end: settings.artHeightMm,
      kind: s.kind,
      widthMm: s.kind === 'gap' ? (s.widthMm ?? settings.gapMm) : s.kind === 'overlap' ? settings.overlapMm : 0,
    })
  }
  for (let i = 1; i < ys.length - 1; i++) {
    const s = seamSetting(layout, `h:${i}`)
    seams.push({
      id: `h:${i}`,
      orientation: 'horizontal',
      position: ys[i],
      start: 0,
      end: settings.artWidthMm,
      kind: s.kind,
      widthMm: s.kind === 'gap' ? (s.widthMm ?? settings.gapMm) : s.kind === 'overlap' ? settings.overlapMm : 0,
    })
  }
  return { tiles: tiles.sort((a, b) => a.number - b.number), seams }
}

/** "{trabalho}_PAINEL_{nn}" → "Fachada_PAINEL_03". */
export function fillName(
  template: string,
  values: { number: number; column: number; row: number; region: string; job?: string; client?: string },
): string {
  const text = (template || '{trabalho}_PAINEL_{nn}')
    .replaceAll('{nn}', String(values.number).padStart(2, '0'))
    .replaceAll('{n}', String(values.number))
    .replaceAll('{col}', String(values.column))
    .replaceAll('{lin}', String(values.row))
    .replaceAll('{regiao}', values.region)
    .replaceAll('{trabalho}', values.job ?? '')
    .replaceAll('{cliente}', values.client ?? '')
  return text.trim() || `PAINEL_${String(values.number).padStart(2, '0')}`
}

/** Junta as células dos painéis escolhidos, se formarem um retângulo. */
export function mergeTiles(layout: TilingLayout, tiles: Tile[]): TilingLayout | null {
  const cells = [...new Set(tiles.flatMap((t) => t.cells))]
  if (tiles.length < 2) return null
  const coords = cells.map(parseCell)
  const c0 = Math.min(...coords.map(([c]) => c))
  const c1 = Math.max(...coords.map(([c]) => c))
  const r0 = Math.min(...coords.map(([, r]) => r))
  const r1 = Math.max(...coords.map(([, r]) => r))
  if ((c1 - c0 + 1) * (r1 - r0 + 1) !== cells.length) return null
  const inside = new Set(cells)
  const merged = layout.merged.filter((group) => !group.some((cell) => inside.has(cell)))
  merged.push(cells)
  return { ...layout, merged }
}

export function splitTile(layout: TilingLayout, tile: Tile): TilingLayout {
  const inside = new Set(tile.cells)
  return { ...layout, merged: layout.merged.filter((group) => !group.some((cell) => inside.has(cell))) }
}

export function toggleRemoved(layout: TilingLayout, tile: Tile, removed: boolean): TilingLayout {
  const others = layout.removed.filter((cell) => !tile.cells.includes(cell))
  return { ...layout, removed: removed ? [...others, ...tile.cells] : others }
}

/** Corta um painel ao meio, criando uma nova linha de corte em toda a grade. */
export function splitAt(layout: TilingLayout, orientation: 'vertical' | 'horizontal', position: number): TilingLayout {
  const lines = orientation === 'vertical' ? layout.xs : layout.ys
  if (lines.some((v) => Math.abs(v - position) < 1)) return layout
  const index = lines.findIndex((v) => v > position)
  if (index <= 0) return layout
  const next = [...lines.slice(0, index), position, ...lines.slice(index)]
  // As células à direita/acima da nova linha mudam de índice.
  const shift = (key: string) => {
    const [c, r] = parseCell(key)
    if (orientation === 'vertical') return cellKey(c >= index ? c + 1 : c, r)
    return cellKey(c, r >= index ? r + 1 : r)
  }
  const shiftSeams = (seams: Record<string, SeamSetting>) =>
    Object.fromEntries(
      Object.entries(seams).map(([id, value]) => {
        const [kind, i] = id.split(':')
        const n = Number(i)
        const moved = (kind === 'v') === (orientation === 'vertical') && n >= index ? n + 1 : n
        return [`${kind}:${moved}`, value]
      }),
    )
  // Grupos atravessados pela nova linha ganham as células novas.
  const merged = layout.merged.map((group) => {
    const shifted = group.map(shift)
    const coords = group.map(parseCell)
    const spans =
      orientation === 'vertical'
        ? Math.min(...coords.map(([c]) => c)) < index && Math.max(...coords.map(([c]) => c)) >= index
        : Math.min(...coords.map(([, r]) => r)) < index && Math.max(...coords.map(([, r]) => r)) >= index
    if (!spans) return shifted
    const extra = coords
      .filter(([c, r]) => (orientation === 'vertical' ? c === index - 1 : r === index - 1))
      .map(([c, r]) => (orientation === 'vertical' ? cellKey(c + 1, r) : cellKey(c, r + 1)))
    return [...shifted, ...extra]
  })
  return {
    ...layout,
    xs: orientation === 'vertical' ? next : layout.xs,
    ys: orientation === 'horizontal' ? next : layout.ys,
    merged,
    removed: layout.removed.map(shift),
    seams: shiftSeams(layout.seams),
    overrides: Object.fromEntries(Object.entries(layout.overrides).map(([k, v]) => [shift(k), v])),
  }
}

/** Move uma linha de corte, mantendo-a entre as vizinhas. */
export function moveLine(layout: TilingLayout, id: string, position: number): TilingLayout {
  const [kind, i] = id.split(':')
  const index = Number(i)
  const lines = kind === 'v' ? [...layout.xs] : [...layout.ys]
  const min = lines[index - 1] + 10
  const max = lines[index + 1] - 10
  if (!(max > min)) return layout
  lines[index] = Math.round(Math.min(max, Math.max(min, position)))
  return kind === 'v' ? { ...layout, xs: lines } : { ...layout, ys: lines }
}

/** Escala uma estrutura salva (modelo) para uma arte de outro tamanho. */
export function scaleLayout(layout: TilingLayout, from: { w: number; h: number }, to: { w: number; h: number }): TilingLayout {
  const fx = from.w > 0 ? to.w / from.w : 1
  const fy = from.h > 0 ? to.h / from.h : 1
  return { ...layout, xs: layout.xs.map((x) => x * fx), ys: layout.ys.map((y) => y * fy) }
}
