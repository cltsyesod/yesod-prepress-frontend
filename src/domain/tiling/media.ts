/**
 * Painéis na mídia: largura imprimível, giro de cada painel (em pé, deitado, flip-flop) e a
 * distribuição na mídia para medir o comprimento consumido, o desperdício e o custo.
 */

import type { MediaLayout, MediaPlacement, MediaSettings, PrintConstraint, TileGeometry } from './model'

const EPS = 0.01

/** Largura que a impressora realmente imprime: mídia menos margens e barra de cor. */
export const printableWidthOf = (media: MediaSettings) =>
  Math.max(0, media.width - media.marginLeft - media.marginRight - media.colorBar)

export const defaultMedia = (width = 0): MediaSettings => ({
  width,
  marginLeft: 0,
  marginRight: 0,
  colorBar: 0,
  spacing: 0,
  pricePerM2: 0,
})

/**
 * Em pé (0) ou deitado (90). No automático, o painel vai na posição que cabe; se couber
 * das duas formas, na que gasta menos comprimento de mídia.
 */
export function orientationOf(width: number, height: number, constraint: PrintConstraint): 0 | 90 {
  if (constraint.direction === 'standing') return 0
  if (constraint.direction === 'lying') return 90
  const max = constraint.printableWidth
  if (!(max > 0)) return 0
  const limit = constraint.printableLength
  const fits = (across: number, along: number) => across <= max + EPS && (!(limit > 0) || along <= limit + EPS)
  const standing = fits(width, height)
  const lying = fits(height, width)
  if (standing && lying) return width + EPS >= height ? 0 : 90
  if (lying) return 90
  return 0
}

/**
 * Giro final de cada painel. No flip-flop, painéis alternados ganham 180°: em pé alterna por
 * coluna (as emendas verticais atravessam a largura da mídia), deitado alterna por linha.
 */
export function rotationOf(
  base: 0 | 90,
  position: { row: number; column: number },
  flipFlop: boolean | undefined,
): 0 | 90 | 180 | 270 {
  if (!flipFlop) return base
  const index = base === 0 ? position.column : position.row
  if (index % 2 === 1) return base
  return base === 0 ? 180 : 270
}

/** Medidas do painel na mídia: atravessado (na largura) e ao longo (no comprimento). */
export function onMedia(tile: Pick<TileGeometry, 'physical' | 'rotation'>, margin = 0) {
  const lying = tile.rotation % 180 !== 0
  return {
    across: (lying ? tile.physical.h : tile.physical.w) + 2 * margin,
    along: (lying ? tile.physical.w : tile.physical.h) + 2 * margin,
  }
}

/**
 * Distribui os painéis na mídia em ordem de impressão, lado a lado enquanto couberem na
 * largura imprimível e em seguida no comprimento. `margin` é a margem técnica das marcas,
 * que também gasta mídia.
 */
export function layoutMedia(tiles: TileGeometry[], constraint: PrintConstraint, margin = 0): MediaLayout | null {
  const printable = constraint.printableWidth
  if (!(printable > 0) || !tiles.length) return null
  const spacing = Math.max(0, constraint.media?.spacing ?? 0)
  const placements: MediaPlacement[] = []
  let x = 0
  let y = 0
  let row = 0
  for (const tile of [...tiles].sort((a, b) => a.number - b.number)) {
    const { across, along } = onMedia(tile, margin)
    if (x > 0 && x + across > printable + EPS) {
      y += row + spacing
      x = 0
      row = 0
    }
    placements.push({ tile: tile.id, x, y, across, along, rotation: tile.rotation })
    x += across + spacing
    row = Math.max(row, along)
  }
  const length = y + row
  const width = constraint.media && constraint.media.width > 0 ? constraint.media.width : printable
  const panelArea = tiles.reduce((sum, t) => sum + t.physical.w * t.physical.h, 0) / 1e6
  const mediaArea = (width * length) / 1e6
  const price = constraint.media?.pricePerM2 ?? 0
  return {
    width,
    printableWidth: printable,
    length,
    placements,
    panelArea,
    mediaArea,
    waste: mediaArea > 0 ? Math.max(0, 1 - panelArea / mediaArea) : 0,
    cost: price > 0 ? mediaArea * price : null,
  }
}
