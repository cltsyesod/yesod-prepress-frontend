import { describe, expect, it } from 'vitest'
import {
  addLine,
  applyToGrid,
  autoGrid,
  calculateProject,
  defaultMedia,
  hasErrors,
  mergeTiles,
  migrateLegacy,
  moveLine,
  newProject,
  removeLine,
  setConstraint,
  setEnabled,
  setGap,
  setMedia,
  setSizes,
  setTileEdges,
  sizes,
  toggleLock,
  zeroEdges,
  type Edges,
  type MediaSettings,
  type TilingProjectModel,
} from '../index'

const edges = (e: Partial<Edges> = {}): Edges => ({ ...zeroEdges(), ...e })

function project(
  width: number,
  height: number,
  columns: number,
  rows: number,
  overrides: Partial<TilingProjectModel['rules']> = {},
): TilingProjectModel {
  return newProject(
    { width, height, scale: 1, availableBleed: edges() },
    { printableWidth: 0, printableLength: 0, direction: 'standing' },
    { overlap: edges(), white: edges(), bleed: edges(), minimumTile: 10, ...overrides },
    '{projeto}_L{lin}C{col}',
    { mode: 'equal', columns, rows },
  )
}

const tile = (p: TilingProjectModel, id: string) => {
  const t = calculateProject(p, { project: 'P' }).tiles.find((x) => x.id === id)
  if (!t) throw new Error(`no tile ${id}`)
  return t
}

describe('grade', () => {
  it('1: 1000 × 1000 em 2 × 2 dá 4 painéis de 500 × 500', () => {
    const tiles = calculateProject(project(1000, 1000, 2, 2)).tiles
    expect(tiles).toHaveLength(4)
    for (const t of tiles) expect([t.logical.w, t.logical.h]).toEqual([500, 500])
  })

  it('2: 6000 × 3000 em 6 × 3 dá 18 painéis, L1 é a linha de cima', () => {
    const p = project(6000, 3000, 6, 3)
    const tiles = calculateProject(p).tiles
    expect(tiles).toHaveLength(18)
    expect(tile(p, 'L1C1').logical).toEqual({ x: 0, y: 2000, w: 1000, h: 1000 })
    expect(tile(p, 'L3C6').logical).toEqual({ x: 5000, y: 0, w: 1000, h: 1000 })
    expect(tiles.map((t) => t.number)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1))
  })
})

describe('sobreposição', () => {
  it('3: direita e embaixo de 20 mm aumentam só a janela impressa', () => {
    const p = project(6000, 3000, 6, 3, { overlap: edges({ right: 20, bottom: 20 }) })
    const t = tile(p, 'L1C2')
    expect(t.logical).toEqual({ x: 1000, y: 2000, w: 1000, h: 1000 })
    expect(t.print).toEqual({ x: 1000, y: 1980, w: 1020, h: 1020 })
  })

  it('4: a última coluna e a última linha não recebem sobreposição para fora da arte', () => {
    const p = project(6000, 3000, 6, 3, { overlap: edges({ right: 20, bottom: 20 }) })
    const corner = tile(p, 'L3C6')
    expect(corner.overlap).toEqual(edges())
    expect(corner.print).toEqual(corner.logical)
  })

  it('sobreposição alternada: os dois lados da emenda participam', () => {
    const p = project(2000, 1000, 2, 1, { overlap: edges({ left: 10, right: 10 }) })
    expect(tile(p, 'L1C1').print.w).toBe(1010)
    expect(tile(p, 'L1C2').print.x).toBe(990)
  })

  it('ajuste por painel e "aplicar a toda a grade"', () => {
    let p = project(3000, 1000, 3, 1)
    p = setTileEdges(p, [tile(p, 'L1C2').key], 'overlap', { right: 30 })
    expect(tile(p, 'L1C2').overlap.right).toBe(30)
    expect(tile(p, 'L1C1').overlap.right).toBe(0)
    p = applyToGrid(p, 'overlap', edges({ right: 15 }))
    expect(tile(p, 'L1C1').overlap.right).toBe(15)
    expect(tile(p, 'L1C2').overlap.right).toBe(15)
    expect(tile(p, 'L1C3').overlap.right).toBe(0)
  })

  it('não repete conteúdo de um painel desligado', () => {
    let p = project(3000, 1000, 3, 1, { overlap: edges({ right: 20 }) })
    p = setEnabled(p, [tile(p, 'L1C2').key], false)
    expect(tile(p, 'L1C1').overlap.right).toBe(0)
    expect(calculateProject(p).tiles.filter((t) => t.enabled)).toHaveLength(2)
  })
})

describe('fresta, área branca e sangria', () => {
  it('5: fresta centralizada de 20 mm tira 10 de cada painel', () => {
    let p = project(2000, 1000, 2, 1)
    p = setGap(p, 'v:1', { width: 20, mode: 'centered' })
    expect(tile(p, 'L1C1').logical.w).toBe(990)
    expect(tile(p, 'L1C2').logical).toMatchObject({ x: 1010, w: 990 })
  })

  it('fresta lateral sai de um painel só; fresta e sobreposição convivem', () => {
    let p = project(2000, 1000, 2, 1, { overlap: edges({ left: 15 }) })
    p = setGap(p, 'v:1', { width: 20, mode: 'before' })
    expect(tile(p, 'L1C1').logical.w).toBe(980)
    expect(tile(p, 'L1C2').logical.x).toBe(1000)
    expect(tile(p, 'L1C2').print.x).toBe(985)
  })

  it('área branca fica fora da imagem: painel físico maior que o impresso', () => {
    const p = project(2000, 1000, 2, 1, { overlap: edges({ right: 20 }), white: edges({ right: 30 }) })
    const t = tile(p, 'L1C1')
    expect(t.print.w).toBe(1020)
    expect(t.physical.w).toBe(1050)
  })

  it('sangria só nas bordas externas e limitada ao que o arquivo tem', () => {
    let p = project(2000, 1000, 2, 1, { bleed: edges({ left: 5, right: 10, top: 5, bottom: 5 }) })
    p = { ...p, poster: { ...p.poster, availableBleed: edges({ left: 5, right: 5, top: 5, bottom: 5 }) } }
    expect(tile(p, 'L1C1').bleed).toEqual(edges({ left: 5, top: 5, bottom: 5 }))
    expect(tile(p, 'L1C2').bleed.right).toBe(5)
    expect(calculateProject(p).issues.some((i) => i.code === 'BLEED_UNAVAILABLE')).toBe(true)
  })
})

describe('edição da grade', () => {
  it('6: larguras personalizadas preservam as demais colunas', () => {
    let p = project(4000, 1000, 4, 1)
    p = setSizes(p, 'vertical', [1000, 1000, 1200, 800])
    expect(sizes(p.grid.xs)).toEqual([1000, 1000, 1200, 800])
    expect(p.grid.mode).toBe('custom')
  })

  it('sanfona: mover uma linha empurra as seguintes sem passar do mínimo', () => {
    let p = project(3000, 1000, 3, 1, { minimumTile: 100 })
    p = moveLine(p, 'v:1', 2950)
    expect(p.grid.xs).toEqual([0, 2800, 2900, 3000])
  })

  it('coluna travada não muda de largura', () => {
    let p = project(3000, 1000, 3, 1)
    p = toggleLock(p, 'vertical', 1)
    expect(moveLine(p, 'v:1', 500).grid.xs).toEqual(p.grid.xs)
    expect(moveLine(p, 'v:2', 2500).grid.xs).toEqual(p.grid.xs)
  })

  it('7: juntar dá um painel com a geometria somada', () => {
    let p = project(6000, 3000, 6, 3)
    p = mergeTiles(p, [tile(p, 'L1C1').key, tile(p, 'L1C2').key])!
    const tiles = calculateProject(p).tiles
    expect(tiles).toHaveLength(17)
    expect(tile(p, 'L1C1').logical).toEqual({ x: 0, y: 2000, w: 2000, h: 1000 })
    expect(mergeTiles(p, [tile(p, 'L1C1').key, tile(p, 'L2C3').key])).toBeNull()
  })

  it('8: desligar mantém a grade; apagar a linha refaz a grade', () => {
    let p = project(3000, 1000, 3, 1)
    p = setEnabled(p, [tile(p, 'L1C3').key], false)
    expect(calculateProject(p).tiles.filter((t) => t.enabled)).toHaveLength(2)
    p = removeLine(p, 'v:1')
    expect(p.grid.xs).toEqual([0, 2000, 3000])
    p = addLine(p, 'vertical', 500)
    expect(p.grid.xs).toEqual([0, 500, 2000, 3000])
  })
})

describe('validação', () => {
  it('9: painel maior que o material é erro e bloqueia a exportação', () => {
    let p = project(3000, 1000, 1, 1)
    p = { ...p, constraint: { printableWidth: 1600, printableLength: 0, direction: 'standing' } }
    const { issues } = calculateProject(p)
    expect(issues.some((i) => i.code === 'TILE_EXCEEDS_WIDTH' && i.tile === 'L1C1')).toBe(true)
    expect(hasErrors(issues)).toBe(true)
  })

  it('painéis deitados usam a altura na largura do material', () => {
    let p = project(3000, 1000, 3, 1)
    p = { ...p, constraint: { printableWidth: 1050, printableLength: 0, direction: 'lying' } }
    expect(hasErrors(calculateProject(p).issues)).toBe(false)
  })

  it('sobreposição maior que o vizinho, nomes repetidos e painel menor que o mínimo', () => {
    let p = project(3000, 1000, 3, 1, { overlap: edges({ right: 1500 }) })
    p = { ...p, nameTemplate: 'mesmo' }
    const codes = calculateProject(p).issues.map((i) => i.code)
    expect(codes).toContain('OVERLAP_TOO_LARGE')
    expect(codes).toContain('NAME_DUPLICATE')
    // Duas colunas de 20 mm; a fresta de 30 deixa 5 mm em cada (mínimo 10).
    const tiny = setGap(project(40, 1000, 2, 1), 'v:1', { width: 30, mode: 'centered' })
    expect(calculateProject(tiny).issues.map((i) => i.code)).toContain('TILE_TOO_SMALL')
  })
})

describe('grade automática pelo material', () => {
  it('conta sangria, sobreposição e área branca no tamanho do painel', () => {
    const base = project(3000, 1500, 1, 1, {
      overlap: edges({ left: 20 }),
      bleed: edges({ left: 5, right: 5, top: 5, bottom: 5 }),
    })
    const p = autoGrid(
      {
        ...base,
        poster: { ...base.poster, availableBleed: edges({ left: 5, right: 5, top: 5, bottom: 5 }) },
        constraint: { printableWidth: 1060, printableLength: 0, direction: 'standing' },
      },
      { mode: 'equal' },
    )
    expect(p.grid.xs).toEqual([0, 1000, 2000, 3000])
    const { issues, tiles } = calculateProject(p)
    expect(hasErrors(issues)).toBe(false)
    expect(Math.max(...tiles.map((t) => t.physical.w))).toBe(1025)
  })
})

describe('mídia', () => {
  const media = (patch: Partial<MediaSettings> = {}): MediaSettings => ({ ...defaultMedia(1600), ...patch })

  it('largura imprimível = mídia menos margens e barra de cor', () => {
    const p = setMedia(project(3000, 1000, 2, 1), media({ marginLeft: 5, marginRight: 5, colorBar: 10 }))
    expect(p.constraint.printableWidth).toBe(1580)
    expect(hasErrors(calculateProject(p).issues)).toBe(false)
    const none = setMedia(p, media({ width: 20, marginLeft: 10, marginRight: 10 }))
    expect(calculateProject(none).issues.map((i) => i.code)).toContain('MEDIA_NO_PRINTABLE_AREA')
  })

  it('automático: deita o painel que só cabe deitado', () => {
    let p = project(1200, 800, 1, 1)
    p = setConstraint(p, { printableWidth: 1000, direction: 'auto' })
    expect(tile(p, 'L1C1').rotation).toBe(90)
    expect(hasErrors(calculateProject(p).issues)).toBe(false)
    p = setConstraint(p, { direction: 'standing' })
    expect(calculateProject(p).issues.map((i) => i.code)).toContain('TILE_EXCEEDS_WIDTH')
  })

  it('automático na grade: escolhe a orientação com menos painéis', () => {
    let p = project(3000, 900, 1, 1)
    p = autoGrid(setConstraint(p, { printableWidth: 1000, direction: 'auto' }), { mode: 'equal' })
    // Em pé seriam 3 colunas; deitado, a altura de 900 cabe na largura: 1 linha, 1 painel de 3000 de comprimento.
    expect(calculateProject(p).tiles).toHaveLength(1)
    expect(tile(p, 'L1C1').rotation).toBe(90)
  })

  it('flip-flop gira 180° as colunas alternadas', () => {
    let p = project(3000, 1000, 3, 1)
    p = setConstraint(p, { printableWidth: 1100, flipFlop: true })
    expect(['L1C1', 'L1C2', 'L1C3'].map((id) => tile(p, id).rotation)).toEqual([0, 180, 0])
  })

  it('distribuição na mídia: lado a lado, comprimento, desperdício e custo', () => {
    let p = project(2000, 1000, 4, 1)
    p = setMedia(p, media({ width: 1100, spacing: 10, pricePerM2: 20 }))
    const layout = calculateProject(p).media!
    // 4 painéis de 500 × 1000: dois por fileira (500 + 10 + 500 ≤ 1100), duas fileiras.
    expect(layout.placements.map((m) => [m.x, m.y])).toEqual([[0, 0], [510, 0], [0, 1010], [510, 1010]])
    expect(layout.length).toBe(2010)
    expect(layout.mediaArea).toBeCloseTo(2.211, 3)
    expect(layout.panelArea).toBe(2)
    expect(layout.waste).toBeCloseTo(1 - 2 / 2.211, 3)
    expect(layout.cost).toBeCloseTo(44.22, 2)
  })

  it('a margem das marcas gasta mídia e avisa quando passa da largura', () => {
    let p = project(1000, 1000, 1, 1)
    p = setConstraint(p, { printableWidth: 1010 })
    const g = calculateProject(p, { marksMargin: 10 })
    expect(g.media!.placements[0].across).toBe(1020)
    expect(g.issues.map((i) => i.code)).toContain('MARKS_OUTSIDE_MEDIA')
    expect(hasErrors(g.issues)).toBe(false)
  })
})

describe('migração do formato anterior', () => {
  it('converte lado da sobreposição, frestas, desligados e nomes', () => {
    const p = migrateLegacy({
      fileScale: 10,
      direction: 'standing',
      materialWidthMm: 1060,
      settings: {
        artWidthMm: 3000,
        artHeightMm: 1500,
        bleedMm: edges({ left: 5, right: 5 }),
        overlapMm: 20,
        overlapSide: 'next',
        gapMm: 10,
        nameTemplate: '{trabalho}_PAINEL_{nn}',
      },
      layout: {
        xs: [0, 1000, 2000, 3000],
        ys: [0, 1500],
        merged: [],
        removed: ['2,0'],
        seams: { 'v:2': { kind: 'gap', widthMm: 40 } },
        overrides: { '0,0': { region: 'Fachada' } },
      },
    })!
    expect(p.rules.overlap).toEqual(edges({ left: 20, bottom: 20 }))
    expect(p.gaps['v:2']).toEqual({ width: 40, mode: 'centered' })
    expect(p.nameTemplate).toBe('{projeto}_PAINEL_{nn}')
    const tiles = calculateProject(p, { project: 'Loja' }).tiles
    expect(tiles.filter((t) => t.enabled)).toHaveLength(2)
    expect(tiles[0].zone).toBe('Fachada')
    expect(tiles.find((t) => t.id === 'L1C2')!.print.x).toBe(980)
  })
})
