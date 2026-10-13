import { describe, expect, it } from 'vitest'
import { overflowText, placeArt, placementLimits } from '../placement'

const area = { areaWidthMm: 300, areaHeightMm: 400 }

describe('posição DTG', () => {
  it('centraliza e mede a partir do topo da área', () => {
    const placed = placeArt(area, { widthMm: 200, heightMm: 100 }, { topMm: 50 })
    expect(placed).toMatchObject({ x: 50, y: 50, fits: true })
  })

  it('aponta quanto passa de cada lado', () => {
    const placed = placeArt(area, { widthMm: 200, heightMm: 380 }, { centerOffsetMm: 70, topMm: 30 })
    expect(placed.fits).toBe(false)
    expect(placed.overflow.right).toBeCloseTo(20)
    expect(placed.overflow.bottom).toBeCloseTo(10)
    expect(overflowText(placed)).toEqual(['20,0 mm à direita', '10,0 mm abaixo'])
  })

  it('aceita a arte exatamente no limite', () => {
    const limits = placementLimits(area, { widthMm: 200, heightMm: 100 })
    expect(limits).toEqual({ maxOffsetMm: 50, maxTopMm: 300 })
    const placed = placeArt(area, { widthMm: 200, heightMm: 100 }, { centerOffsetMm: -50, topMm: 300 })
    expect(placed.fits).toBe(true)
  })
})
