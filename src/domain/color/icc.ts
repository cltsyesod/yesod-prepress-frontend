/**
 * Cabeçalho de um perfil ICC (ICC.1, v2 e v4): o que o perfil é, sem interpretar as tabelas.
 * TypeScript puro, sem dependências: usado ao enviar o arquivo para a biblioteca da empresa.
 */

export interface IccInfo {
  size: number
  version: string
  /** prtr (saída/impressão), mntr (monitor), scnr (entrada), spac (espaço de cor), link… */
  profileClass: string
  /** CMYK, RGB, GRAY, Lab… */
  colorSpace: string
  pcs: string
  description: string
  /** ID do perfil (MD5 do cabeçalho v4), vazio quando o perfil não traz. */
  md5: string
}

export const CLASS_LABEL: Record<string, string> = {
  prtr: 'Saída (impressão)',
  mntr: 'Monitor',
  scnr: 'Entrada',
  spac: 'Espaço de cor',
  link: 'DeviceLink',
  abst: 'Abstrato',
  nmcl: 'Cores nomeadas',
}

const text4 = (view: DataView, offset: number) =>
  String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3)).trim()

function description(view: DataView): string {
  if (view.byteLength < 132) return ''
  const count = view.getUint32(128)
  for (let i = 0; i < Math.min(count, 200); i++) {
    const entry = 132 + i * 12
    if (entry + 12 > view.byteLength) break
    if (text4(view, entry) !== 'desc') continue
    const offset = view.getUint32(entry + 4)
    if (offset + 12 > view.byteLength) return ''
    const type = text4(view, offset)
    if (type === 'desc') {
      // v2: textDescriptionType — ASCII com o tamanho antes.
      const length = view.getUint32(offset + 8)
      let out = ''
      for (let j = 0; j < length - 1 && offset + 12 + j < view.byteLength; j++) {
        const code = view.getUint8(offset + 12 + j)
        if (code === 0) break
        out += String.fromCharCode(code)
      }
      return out.trim()
    }
    if (type === 'mluc') {
      // v4: multiLocalizedUnicodeType — o primeiro registro, em UTF-16BE.
      const recordLength = view.getUint32(offset + 20)
      const recordOffset = view.getUint32(offset + 24)
      let out = ''
      for (let j = 0; j + 1 < recordLength; j += 2) {
        const at = offset + recordOffset + j
        if (at + 1 >= view.byteLength) break
        out += String.fromCharCode(view.getUint16(at))
      }
      // Sem os caracteres nulos de preenchimento do fim.
      return out.split(String.fromCharCode(0)).join('').trim()
    }
  }
  return ''
}

/** Lê o cabeçalho; lança erro quando o arquivo não é um perfil ICC. */
export function parseIcc(buffer: ArrayBuffer): IccInfo {
  const view = new DataView(buffer)
  if (view.byteLength < 128 || text4(view, 36) !== 'acsp') {
    throw new Error('O arquivo não é um perfil ICC (falta a assinatura "acsp").')
  }
  const major = view.getUint8(8)
  const minor = view.getUint8(9) >> 4
  const md5 = Array.from(new Uint8Array(buffer, 84, 16))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return {
    size: view.getUint32(0),
    version: `${major}.${minor}`,
    profileClass: text4(view, 12),
    colorSpace: text4(view, 16),
    pcs: text4(view, 20),
    description: description(view),
    md5: /^0+$/.test(md5) ? '' : md5,
  }
}
