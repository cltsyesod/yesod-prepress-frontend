/**
 * Resolução das imagens da arte no tamanho final dos painéis.
 *
 * O raio-x do arquivo (análise do trabalho) mede a resolução de cada imagem no próprio
 * arquivo; nos painéis a arte é ampliada pela escala do projeto (1:N → N vezes), então
 * a resolução final é a do arquivo dividida pela escala. O mínimo vem da ficha do
 * trabalho ou do perfil de produção: o sistema não fixa um valor.
 */

import type { Issue } from './model'

export interface ArtImage {
  page: number
  px: [number, number]
  /** Resolução no arquivo (pixels por polegada da página do PDF). */
  filePpi: number | null
}

export interface ArtResolution {
  /** Menor resolução no tamanho final entre as imagens da página (null: sem imagens). */
  minPpi: number | null
  images: number
}

export function artResolution(images: ArtImage[], page: number, scale: number): ArtResolution {
  const onPage = images.filter((img) => img.page === page && img.filePpi && img.filePpi > 0)
  if (!onPage.length) return { minPpi: null, images: 0 }
  const factor = scale > 0 ? scale : 1
  return {
    minPpi: Math.min(...onPage.map((img) => (img.filePpi as number) / factor)),
    images: onPage.length,
  }
}

/** Aviso (não bloqueia) quando a menor imagem fica abaixo do mínimo pedido para o trabalho. */
export function resolutionIssues(resolution: ArtResolution, minimumPpi?: number | null): Issue[] {
  if (resolution.minPpi === null || !minimumPpi || minimumPpi <= 0) return []
  if (resolution.minPpi + 0.5 >= minimumPpi) return []
  const ppi = Math.round(resolution.minPpi)
  return [
    {
      severity: 'warning',
      code: 'ART_LOW_RESOLUTION',
      message:
        `Imagem com ${ppi} ppi no tamanho final dos painéis (o trabalho pede ${minimumPpi} ppi): ` +
        'vai aparecer pixelada de perto. Confira a escala ou peça a imagem em maior resolução.',
    },
  ]
}
