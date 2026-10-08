/**
 * Validação de produção: nenhum arquivo sai de um projeto com erro. Avisos não bloqueiam.
 */

import { onMedia } from './media'
import { EDGES, type Issue, type TileGeometry, type TilingProjectModel } from './model'

/** Maior página que um PDF pode descrever (200 polegadas). */
export const PDF_MAX_MM = 5080
const EPS = 0.01

const mm = (v: number) => `${Math.round(v * 10) / 10} mm`

export function validateProject(
  project: TilingProjectModel,
  tiles: TileGeometry[],
  options: { marksMargin?: number } = {},
): Issue[] {
  const issues: Issue[] = []
  const marksMargin = options.marksMargin ?? 0
  const { xs, ys } = project.grid
  const { poster, constraint, rules } = project

  // Grade cobre o poster, sem linhas fora de ordem.
  const ordered = (lines: number[], total: number) =>
    lines.length >= 2 &&
    Math.abs(lines[0]) < EPS &&
    Math.abs(lines[lines.length - 1] - total) < 0.5 &&
    lines.every((v, i) => i === 0 || v > lines[i - 1] + EPS)
  if (!ordered(xs, poster.width) || !ordered(ys, poster.height)) {
    issues.push({ severity: 'error', code: 'GRID_INVALID', message: 'A grade não cobre a arte inteira.' })
  }

  const active = tiles.filter((t) => t.enabled)
  if (!active.length) {
    issues.push({ severity: 'error', code: 'NO_TILES', message: 'Nenhum painel para imprimir.' })
  }

  const byId = new Map(tiles.map((t) => [t.id, t]))
  for (const t of active) {
    const label = `Painel ${t.id}`
    if (t.logical.w <= EPS || t.logical.h <= EPS) {
      issues.push({ severity: 'error', code: 'TILE_EMPTY', tile: t.id, message: `${label} ficou sem área: a fresta é maior que o painel.` })
      continue
    }
    if (t.logical.w + EPS < rules.minimumTile || t.logical.h + EPS < rules.minimumTile) {
      issues.push({
        severity: 'error',
        code: 'TILE_TOO_SMALL',
        tile: t.id,
        message: `${label} (${mm(t.logical.w)} × ${mm(t.logical.h)}) é menor que o mínimo de ${mm(rules.minimumTile)}.`,
      })
    }
    // A sobreposição não pode passar do painel vizinho que ela repete.
    for (const edge of EDGES) {
      const other = t.neighbours[edge] ? byId.get(t.neighbours[edge]!) : null
      if (!other || t.overlap[edge] <= 0) continue
      const room = edge === 'left' || edge === 'right' ? other.logical.w : other.logical.h
      if (t.overlap[edge] > room + EPS) {
        issues.push({
          severity: 'error',
          code: 'OVERLAP_TOO_LARGE',
          tile: t.id,
          message: `${label}: sobreposição de ${mm(t.overlap[edge])} maior que o painel vizinho ${other.id}.`,
        })
      }
    }
    // Cabe no material, na posição em que vai (em pé ou deitado)?
    const { across, along } = onMedia(t)
    if (constraint.printableWidth > 0 && across > constraint.printableWidth + EPS) {
      issues.push({
        severity: 'error',
        code: 'TILE_EXCEEDS_WIDTH',
        tile: t.id,
        message: `${label} (${mm(across)}) passa da largura imprimível de ${mm(constraint.printableWidth)}.`,
      })
    } else if (
      constraint.printableWidth > 0 &&
      marksMargin > 0 &&
      across + 2 * marksMargin > constraint.printableWidth + EPS
    ) {
      issues.push({
        severity: 'warning',
        code: 'MARKS_OUTSIDE_MEDIA',
        tile: t.id,
        message: `${label}: o painel cabe, mas as marcas (margem de ${mm(marksMargin)}) passam da largura imprimível.`,
      })
    }
    if (constraint.printableLength > 0 && along > constraint.printableLength + EPS) {
      issues.push({
        severity: 'error',
        code: 'TILE_EXCEEDS_LENGTH',
        tile: t.id,
        message: `${label} (${mm(along)}) passa do comprimento máximo de ${mm(constraint.printableLength)}.`,
      })
    }
    if (t.physical.w > PDF_MAX_MM || t.physical.h > PDF_MAX_MM) {
      issues.push({ severity: 'error', code: 'TILE_EXCEEDS_PDF', tile: t.id, message: `${label} passa do limite de 5080 mm do PDF.` })
    }
  }

  if (constraint.media && constraint.media.width > 0 && !(constraint.printableWidth > 0)) {
    issues.push({
      severity: 'error',
      code: 'MEDIA_NO_PRINTABLE_AREA',
      message: 'As margens e a barra de cor ocupam toda a largura da mídia.',
    })
  } else if (!(constraint.printableWidth > 0)) {
    issues.push({
      severity: 'warning',
      code: 'NO_MEDIA',
      message: 'Informe a largura imprimível do material para conferir se os painéis cabem.',
    })
  }

  // Sangria pedida além do que o arquivo tem: o painel sai com a sangria disponível.
  for (const edge of EDGES) {
    if (rules.bleed[edge] > poster.availableBleed[edge] + 0.5) {
      issues.push({
        severity: 'warning',
        code: 'BLEED_UNAVAILABLE',
        message: `Sangria ${edgeName(edge)}: pedida ${mm(rules.bleed[edge])}, o arquivo tem ${mm(poster.availableBleed[edge])}.`,
      })
    }
  }

  // Identificação única: arquivos e números não podem se repetir.
  const names = new Map<string, string>()
  const numbers = new Map<number, string>()
  for (const t of active) {
    const name = t.name.trim().toLocaleLowerCase('pt-BR')
    if (names.has(name)) {
      issues.push({ severity: 'error', code: 'NAME_DUPLICATE', tile: t.id, message: `Nome "${t.name}" repetido (${names.get(name)} e ${t.id}).` })
    } else names.set(name, t.id)
    if (numbers.has(t.number)) {
      issues.push({ severity: 'error', code: 'NUMBER_DUPLICATE', tile: t.id, message: `Número ${t.number} repetido (${numbers.get(t.number)} e ${t.id}).` })
    } else numbers.set(t.number, t.id)
  }
  return issues
}

const edgeName = (edge: string) =>
  ({ top: 'em cima', right: 'à direita', bottom: 'embaixo', left: 'à esquerda' })[edge] ?? edge

export const hasErrors = (issues: Issue[]) => issues.some((i) => i.severity === 'error')
