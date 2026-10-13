import { describe, expect, it } from 'vitest'
import { artResolution, resolutionIssues } from '../resolution'

const images = [
  { page: 1, px: [3000, 1500] as [number, number], filePpi: 300 },
  { page: 1, px: [800, 600] as [number, number], filePpi: 150 },
  { page: 2, px: [100, 100] as [number, number], filePpi: 72 },
]

describe('resolução da arte nos painéis', () => {
  it('divide a resolução do arquivo pela escala e pega a menor da página', () => {
    expect(artResolution(images, 1, 1)).toEqual({ minPpi: 150, images: 2 })
    // Arte 1:10: tudo fica 10 vezes maior, a resolução cai 10 vezes.
    expect(artResolution(images, 1, 10).minPpi).toBe(15)
    expect(artResolution(images, 3, 10)).toEqual({ minPpi: null, images: 0 })
  })

  it('avisa só abaixo do mínimo do trabalho e nunca sem mínimo definido', () => {
    expect(resolutionIssues({ minPpi: 15, images: 2 }, 100)).toHaveLength(1)
    expect(resolutionIssues({ minPpi: 15, images: 2 }, 100)[0].severity).toBe('warning')
    expect(resolutionIssues({ minPpi: 120, images: 2 }, 100)).toHaveLength(0)
    expect(resolutionIssues({ minPpi: 15, images: 2 }, undefined)).toHaveLength(0)
    expect(resolutionIssues({ minPpi: null, images: 0 }, 100)).toHaveLength(0)
  })
})
