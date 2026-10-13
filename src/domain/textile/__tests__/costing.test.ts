import { describe, expect, it } from 'vitest'
import { compare, costDtf, costDtg, filmLayout, type Order } from '../costing'

const order: Order = {
  quantity: 10,
  designs: 1,
  artWidthMm: 250,
  artHeightMm: 300,
  darkGarment: true,
  laborPerHour: 60,
  garmentCost: 20,
}

const dtfFull = {
  filmWidthMm: 600,
  gapMm: 10,
  filmCostPerM: 10,
  colorInkMlPerM2: 10,
  whiteInkMlPerM2: 20,
  colorInkCostPerMl: 1,
  whiteInkCostPerMl: 1,
  powderCostPerM2: 5,
  printMinutesPerM: 6,
  pressSecondsPerPiece: 15,
  setupMinutes: 30,
}

describe('custos DTF e DTG', () => {
  it('calcula o filme na melhor orientação', () => {
    // 600 mm, 10 mm de espaço: 2 por linha em pé (250 mm), 5 linhas de 300 mm.
    const layout = filmLayout(order, 600, 10)!
    expect(layout.perRow).toBe(2)
    expect(layout.rows).toBe(5)
    expect(layout.lengthMm).toBe(5 * 300 + 4 * 10)
  })

  it('não inventa: sem dados, sem custo e confiança baixa', () => {
    const r = costDtf(order, {})
    expect(r.perUnit).toBeNull()
    expect(r.confidence).toBe('baixa')
    expect(r.missing).toContain('largura útil do filme')
  })

  it('soma as partes e calcula margem e ponto de equilíbrio', () => {
    const r = costDtf({ ...order, salePrice: 60 }, dtfFull)
    // Arte 0,075 m² × 10 = 0,75 m²: tinta branca 0,75 × 20 × 1 = 15; filme 1,54 m × 10 = 15,4.
    expect(r.parts.find((p) => p.label === 'Filme')!.value).toBeCloseTo(15.4)
    expect(r.parts.find((p) => p.label === 'Tinta branca')!.value).toBeCloseTo(15)
    expect(r.parts.find((p) => p.label === 'Preparação')!.value).toBeCloseTo(30)
    expect(r.confidence).toBe('média') // cobertura não informada é premissa, não falta
    const total = r.parts.reduce((s, p) => s + p.value, 0)
    expect(r.orderTotal).toBeCloseTo(total)
    expect(r.margin).toBeCloseTo(60 - total / 10)
    expect(r.breakEven).toBeGreaterThan(0)
  })

  it('DTG em peça clara não cobra branco e pede confirmação', () => {
    const r = costDtg(
      { ...order, darkGarment: false },
      { areaWidthMm: 300, areaHeightMm: 400, colorInkMlPerM2: 10, colorInkCostPerMl: 1 },
    )
    expect(r.parts.some((p) => p.label === 'Tinta branca')).toBe(false)
    expect(r.facts.join(' ')).toMatch(/confirme/)
    expect(r.fits).toBe(true)
  })

  it('arte maior que a área: DTG sem custo', () => {
    const r = costDtg(order, { areaWidthMm: 200, areaHeightMm: 400, colorInkMlPerM2: 1, colorInkCostPerMl: 1 })
    expect(r.fits).toBe(false)
    expect(r.perUnit).toBeNull()
  })

  it('compara só com os dois custos, sem regra geral', () => {
    expect(compare(costDtf(order, {}), costDtg(order, {})).verdict).toBeNull()
    const dtf = costDtf(order, dtfFull)
    const dtg = costDtg(order, {
      areaWidthMm: 300,
      areaHeightMm: 400,
      colorInkMlPerM2: 10,
      whiteInkMlPerM2: 20,
      colorInkCostPerMl: 1,
      whiteInkCostPerMl: 1,
      pretreatCostPerPiece: 2,
      printSecondsPerPiece: 90,
      setupMinutes: 10,
    })
    const result = compare(dtf, dtg)
    expect(result.verdict).not.toBeNull()
    expect(result.text).toMatch(/outro pedido pode inverter/)
  })
})
