/**
 * DTG: posição da arte na área imprimível do gabarito, em mm no tamanho final.
 *
 * Origem: o canto superior esquerdo da área imprimível (como se mede na peça: a partir
 * da gola/topo da área). `centerOffsetMm` desloca o centro da arte em relação ao centro
 * da área (+ = para a direita de quem olha a peça); `topMm` é a distância do topo da área
 * ao topo da arte. TypeScript puro, sem React.
 */

export interface DtgTemplate {
  name: string
  /** Tamanho da peça (P, M, G, infantil…), livre. */
  size?: string
  areaWidthMm: number
  areaHeightMm: number
}

export interface DtgPlacement {
  template?: string
  centerOffsetMm?: number
  topMm?: number
  garmentColor?: string
  fabric?: string
  ink?: string
  pretreatment?: string
}

export interface PlacedArt {
  /** Retângulo da arte na área (x, y a partir do canto superior esquerdo da área). */
  x: number
  y: number
  width: number
  height: number
  /** Quanto a arte passa de cada lado da área (0 = dentro). */
  overflow: { left: number; right: number; top: number; bottom: number }
  fits: boolean
}

const EPS = 0.05

export function placeArt(
  template: Pick<DtgTemplate, 'areaWidthMm' | 'areaHeightMm'>,
  art: { widthMm: number; heightMm: number },
  placement: Pick<DtgPlacement, 'centerOffsetMm' | 'topMm'>,
): PlacedArt {
  const x = template.areaWidthMm / 2 + (placement.centerOffsetMm ?? 0) - art.widthMm / 2
  const y = placement.topMm ?? 0
  const overflow = {
    left: Math.max(0, -x),
    right: Math.max(0, x + art.widthMm - template.areaWidthMm),
    top: Math.max(0, -y),
    bottom: Math.max(0, y + art.heightMm - template.areaHeightMm),
  }
  const fits = Object.values(overflow).every((v) => v <= EPS)
  return { x, y, width: art.widthMm, height: art.heightMm, overflow, fits }
}

/** Texto de cada lado que passa da área, para o operador. */
export function overflowText(placed: PlacedArt): string[] {
  const sides: [keyof PlacedArt['overflow'], string][] = [
    ['left', 'à esquerda'],
    ['right', 'à direita'],
    ['top', 'acima'],
    ['bottom', 'abaixo'],
  ]
  return sides
    .filter(([side]) => placed.overflow[side] > EPS)
    .map(([side, label]) => `${placed.overflow[side].toFixed(1).replace('.', ',')} mm ${label}`)
}

/** Maior deslocamento lateral e topo que ainda cabem (para limitar os campos). */
export function placementLimits(
  template: Pick<DtgTemplate, 'areaWidthMm' | 'areaHeightMm'>,
  art: { widthMm: number; heightMm: number },
) {
  return {
    maxOffsetMm: Math.max(0, (template.areaWidthMm - art.widthMm) / 2),
    maxTopMm: Math.max(0, template.areaHeightMm - art.heightMm),
  }
}
