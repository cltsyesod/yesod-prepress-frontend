/**
 * Etiqueta impressa na margem técnica de cada painel: o operador escreve um modelo com
 * variáveis e o motor preenche para cada painel. O analisador só imprime o texto pronto.
 */

import type { Edge, TileGeometry } from './model'

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
