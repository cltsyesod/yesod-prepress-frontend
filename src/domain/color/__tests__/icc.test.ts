import { describe, expect, it } from 'vitest'
import { parseIcc } from '../icc'

function header(space: string, cls: string, version: [number, number], desc?: { v4: boolean; text: string }) {
  const tags = desc ? 1 : 0
  const tagData = desc
    ? desc.v4
      ? 28 + desc.text.length * 2
      : 12 + desc.text.length + 1
    : 0
  const size = 128 + 4 + tags * 12 + tagData
  const buf = new ArrayBuffer(size)
  const v = new DataView(buf)
  const put4 = (at: number, s: string) => [...s.padEnd(4)].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)))
  v.setUint32(0, size)
  v.setUint8(8, version[0])
  v.setUint8(9, version[1] << 4)
  put4(12, cls)
  put4(16, space)
  put4(20, 'Lab ')
  put4(36, 'acsp')
  v.setUint32(128, tags)
  if (desc) {
    const at = 144
    put4(132, 'desc')
    v.setUint32(136, at)
    v.setUint32(140, tagData)
    if (desc.v4) {
      put4(at, 'mluc')
      v.setUint32(at + 8, 1)
      v.setUint32(at + 12, 12)
      v.setUint32(at + 20, desc.text.length * 2)
      v.setUint32(at + 24, 28)
      ;[...desc.text].forEach((c, i) => v.setUint16(at + 28 + i * 2, c.charCodeAt(0)))
    } else {
      put4(at, 'desc')
      v.setUint32(at + 8, desc.text.length + 1)
      ;[...desc.text].forEach((c, i) => v.setUint8(at + 12 + i, c.charCodeAt(0)))
    }
  }
  return buf
}

describe('cabeçalho ICC', () => {
  it('lê classe, espaço de cor, versão e descrição v2', () => {
    const info = parseIcc(header('CMYK', 'prtr', [2, 1], { v4: false, text: 'Coated FOGRA39' }))
    expect(info).toMatchObject({ profileClass: 'prtr', colorSpace: 'CMYK', pcs: 'Lab', version: '2.1', description: 'Coated FOGRA39', md5: '' })
  })

  it('lê descrição v4 (mluc)', () => {
    expect(parseIcc(header('RGB ', 'mntr', [4, 3], { v4: true, text: 'sRGB v4' })).description).toBe('sRGB v4')
  })

  it('recusa o que não é perfil ICC', () => {
    expect(() => parseIcc(new ArrayBuffer(200))).toThrow(/não é um perfil ICC/)
  })
})
