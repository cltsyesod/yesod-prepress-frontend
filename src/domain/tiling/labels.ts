/**
 * Etiqueta impressa na margem técnica de cada painel: o operador escreve um modelo com
 * variáveis e o motor preenche para cada painel. O analisador só imprime o texto pronto.
 */

import type { Edge, Issue, TileGeometry } from './model'

const PT_PER_MM = 72 / 25.4

/** Corpo da etiqueta no arquivo (pt), igual ao do analisador: 40% da margem, entre 4 e 10 pt. */
export const labelSizePt = (marginMm: number) => Math.max(4, Math.min(10, marginMm * PT_PER_MM * 0.4))

/** Largura aproximada de uma linha da etiqueta, em mm (Helvetica, média de 0,52 do corpo). */
export const labelWidthMm = (text: string, marginMm: number) => (text.length * labelSizePt(marginMm) * 0.52) / PT_PER_MM

/**
 * Avisos de acabamento antes de exportar: a margem técnica não comporta as marcas, ou a
 * etiqueta não cabe na largura do painel e sairá encurtada.
 */
export function finishingIssues(
  tiles: TileGeometry[],
  marks: { marginMm: number; cropMarks: boolean; label: boolean; centerMarks?: boolean },
  labels: Map<string, { top: string; bottom: string }>,
): Issue[] {
  const issues: Issue[] = []
  const anything = marks.cropMarks || marks.label || !!marks.centerMarks
  if (anything && marks.marginMm < 2) {
    issues.push({
      severity: 'warning',
      code: 'MARKS_NO_ROOM',
      message: `A margem técnica de ${marks.marginMm} mm é pequena demais: marcas e etiqueta não serão impressas (mínimo 2 mm).`,
    })
    return issues
  }
  if (!marks.label) return issues
  // Folga para as marcas dos cantos (como no analisador).
  const room = (t: TileGeometry) => t.physical.w - 2 * 1.5 - 2 * Math.min(1.5, marks.marginMm * 0.2)
  const short = tiles.filter((t) => {
    const lines = labels.get(t.id)
    return lines && [lines.top, lines.bottom].some((line) => line && labelWidthMm(line, marks.marginMm) > room(t))
  })
  if (short.length) {
    const list = short.slice(0, 6).map((t) => t.id).join(', ')
    issues.push({
      severity: 'warning',
      code: 'LABEL_SHORTENED',
      tile: short[0].id,
      message: `A etiqueta não cabe na largura de ${short.length} painel(is) (${list}${short.length > 6 ? '…' : ''}) e sairá encurtada.`,
    })
  }
  return issues
}

export interface LabelContext {
  project?: string
  client?: string
  /** Painéis impressos no projeto. */
  total: number
  revision: number
  /** Data da exportação, já formatada. */
  date?: string
  /** Número de um painel pelo id (para os vizinhos). */
  numberOf: (id: string) => number | undefined
}

export const LABEL_TOKENS: [string, string][] = [
  ['{projeto}', 'Nome do projeto'],
  ['{cliente}', 'Cliente'],
  ['{arquivo}', 'Nome do arquivo do painel'],
  ['{nn}', 'Número do painel (2 dígitos)'],
  ['{total}', 'Total de painéis'],
  ['{pos}', 'Posição na grade (L1C2)'],
  ['{area}', 'Área da instalação'],
  ['{ordem}', 'Ordem de instalação'],
  ['{cobre}', 'Medida que cobre da arte'],
  ['{impresso}', 'Medida impressa'],
  ['{fisico}', 'Medida do painel físico'],
  ['{vizinhos}', 'Painéis vizinhos'],
  ['{giro}', 'Posição na mídia'],
  ['{rev}', 'Revisão (R1, R2…)'],
  ['{data}', 'Data da exportação'],
]

export const DEFAULT_LABEL_TOP = '{projeto} · {arquivo} · painel {nn}/{total} · {pos} · {area} · impresso {impresso} mm · {rev}'
export const DEFAULT_LABEL_BOTTOM = 'Instalação: {ordem} · Vizinhos: {vizinhos}'

const SIDES: [Edge, string][] = [
  ['left', 'esq.'],
  ['right', 'dir.'],
  ['top', 'acima'],
  ['bottom', 'abaixo'],
]
const GIRO: Record<number, string> = { 0: 'em pé', 90: 'deitado', 180: 'em pé 180°', 270: 'deitado 180°' }
const size = (r: { w: number; h: number }) => `${Math.round(r.w)} × ${Math.round(r.h)}`

export const revisionTag = (revision: number) => `R${Math.max(1, Math.round(revision))}`

export function fillLabel(template: string, tile: TileGeometry, ctx: LabelContext): string {
  const nn = String(tile.number).padStart(2, '0')
  const neighbours =
    SIDES.filter(([edge]) => tile.neighbours[edge])
      .map(([edge, label]) => {
        const n = ctx.numberOf(tile.neighbours[edge]!)
        return `${label} ${n ? String(n).padStart(2, '0') : tile.neighbours[edge]}`
      })
      .join(', ') || '—'
  const values: Record<string, string> = {
    '{projeto}': ctx.project ?? '',
    '{cliente}': ctx.client ?? '',
    '{arquivo}': tile.name,
    '{nn}': nn,
    '{n}': String(tile.number),
    '{total}': String(ctx.total),
    '{pos}': tile.id,
    '{lin}': String(tile.row),
    '{col}': String(tile.column),
    '{zona}': tile.zone,
    '{regiao}': tile.zone,
    '{area}': tile.zone,
    '{ordem}': tile.install ? `${tile.install}º` : '',
    '{cobre}': size(tile.logical),
    '{impresso}': size(tile.print),
    '{fisico}': size(tile.physical),
    '{vizinhos}': neighbours,
    '{giro}': GIRO[tile.rotation] ?? '',
    '{rev}': revisionTag(ctx.revision),
    '{data}': ctx.date ?? '',
  }
  const text = template.replace(/\{[a-z]+\}/g, (token) => values[token] ?? token)
  // Variáveis vazias (sem região, sem cliente) não deixam separadores sobrando.
  return text
    .split(' · ')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' · ')
}
