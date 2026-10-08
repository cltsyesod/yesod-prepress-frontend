import { describe, expect, it, vi } from 'vitest'
import { calculateProject, newProject, zeroEdges } from '@/domain/tiling'
import { contentHash, exportPayload, isOutdated, type TilingProject } from '../tilingService'

vi.mock('@/lib/supabase/client', () => ({ default: {} }))

const project = newProject(
  { width: 2000, height: 1000, scale: 1, availableBleed: zeroEdges() },
  { printableWidth: 0, printableLength: 0, direction: 'standing' },
  { overlap: zeroEdges(), white: zeroEdges(), bleed: zeroEdges(), minimumTile: 10 },
  '{projeto}_{nn}',
  { mode: 'equal', columns: 2, rows: 1 },
)
const marks = { marginMm: 10, cropMarks: true, label: true }
const values = { project, name: 'Loja', page: 1, marks, background: null }

describe('exportação desatualizada', () => {
  it('a impressão digital ignora a ordem das chaves e ruído de arredondamento', () => {
    const shuffled = { ...values, project: { ...project, poster: { ...project.poster, width: 2000.0001 } } }
    expect(contentHash(shuffled)).toBe(contentHash(values))
    expect(contentHash({ ...values, name: 'Outra' })).not.toBe(contentHash(values))
  })

  it('exportado e alterado depois = desatualizado', () => {
    const row = {
      status: 'completed',
      name: 'Loja',
      background: null,
      config: { version: 2, page: 1, project, request: { mode: 'equal' }, marks, exportedHash: contentHash(values) },
    } as unknown as TilingProject
    expect(isOutdated(row)).toBe(false)
    expect(isOutdated({ ...row, name: 'Loja 2' })).toBe(true)
  })
})

describe('etiqueta no envio', () => {
  it('cada painel leva as duas linhas prontas; sem etiqueta, vazias', () => {
    const geometry = calculateProject(project, { project: 'Loja' })
    const context = { project: 'Loja', revision: 1 }
    const [first] = exportPayload(geometry, { marks, context }).tiles
    expect(first.labelTop).toContain('painel 01/2')
    expect(first.labelBottom).toBe('Instalação: 1º · Vizinhos: dir. 02')
    expect(first.install).toBe(1)
    const off = exportPayload(geometry, { marks: { ...marks, label: false }, context }).tiles[0]
    expect([off.labelTop, off.labelBottom]).toEqual(['', ''])
  })
})
