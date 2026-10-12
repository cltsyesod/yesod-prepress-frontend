/**
 * O que cada seção do raio-x mostra: o número principal do cartão, os fatos medidos (ao
 * lado do que a ficha pede) e avisos que não são regra mas mudam a leitura (ex.: ficha sem
 * tamanho final). Sem React: a tela só desenha.
 */

import {
  finalSize,
  minBleed,
  mm,
  num,
  scaleLabel,
  size,
  type FileProfile,
  type SectionId,
  type Tone,
} from '@/lib/xray'

export interface Fact {
  label: string
  value: string
  tone?: Tone
  hint?: string
}

/** Tamanho de arquivo legível: KB abaixo de 1 MB. */
export function fileSize(bytes?: number): string {
  if (bytes === undefined || bytes === null) return '—'
  if (bytes < 1_048_576) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1_048_576).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`
}

const RANK: Record<Tone, number> = { ok: 0, resolved: 1, info: 2, decision: 3, blocked: 4 }
export const worse = (a: Tone, b: Tone): Tone => (RANK[a] >= RANK[b] ? a : b)

/** Avisos da leitura (não são ocorrências): mudam a cor do cartão para "informação". */
export function advisoryOf(id: SectionId, p: FileProfile): { tone: Tone; text: string } | null {
  const t = p.targets ?? {}
  if (id === 'format' && !(t.finalWidthMm && t.finalHeightMm)) {
    return {
      tone: 'info',
      text:
        !t.scale || t.scale === 1
          ? 'A ficha não informa o tamanho final nem a escala: o tamanho abaixo considera o arquivo em tamanho real (1:1). Confira na ficha do trabalho.'
          : 'A ficha não informa o tamanho final: o tamanho abaixo vem da escala informada.',
    }
  }
  return null
}

/** O número que o cartão mostra em destaque, com uma linha de apoio. */
export function tileSummary(id: SectionId, p: FileProfile): { value: string; sub: string } {
  const pages = p.pages ?? []
  const t = p.targets ?? {}
  switch (id) {
    case 'format': {
      const first = pages[0]?.finalMm
      return {
        value: first ? `${num(first[0], 0)} × ${num(first[1], 0)} mm` : '—',
        sub: `${scaleLabel(t.scale)} · ${p.document?.pages ?? pages.length} pág.`,
      }
    }
    case 'bleed': {
      const b = minBleed(p)
      if (!b) return { value: 'Sem sangria', sub: pages.some((pg) => pg.hasTrimBox) ? 'BleedBox ausente' : 'sem TrimBox nem BleedBox' }
      return { value: mm(Math.min(b.top, b.right, b.bottom, b.left)), sub: t.minBleedMm !== undefined ? `pede ${mm(t.minBleedMm)}` : 'menor lado' }
    }
    case 'images': {
      const img = p.images
      if (!img?.count) return { value: 'Vetorial', sub: 'sem imagens' }
      return {
        value: img.minFinalPpi !== null ? `${num(img.minFinalPpi, 0)} ppi` : '—',
        sub: [
          `${img.count} ${img.count === 1 ? 'imagem' : 'imagens'}`,
          Object.keys(img.colorSpaces).map((s) => s.replace(/^Device|^ICCBased$/, (m) => (m === 'Device' ? '' : 'ICC'))).join(' + '),
          t.minPpi ? `pede ${t.minPpi}` : '',
        ]
          .filter(Boolean)
          .join(' · '),
      }
    }
    case 'colors': {
      const c = p.colors
      if (!c) return { value: '—', sub: '' }
      const spaces = [c.cmykOperators && 'CMYK', c.rgbOperators && 'RGB', c.grayOperators && 'Cinza'].filter(Boolean) as string[]
      return {
        value: spaces.length ? spaces.join(' + ') : '—',
        sub: c.spots.length ? `${c.spots.length} ${c.spots.length === 1 ? 'cor especial' : 'cores especiais'}` : 'sem cores especiais',
      }
    }
    case 'fonts': {
      const f = p.fonts
      if (!f?.count) return { value: 'Em curvas', sub: 'sem fontes' }
      return {
        value: `${f.count} ${f.count === 1 ? 'fonte' : 'fontes'}`,
        sub: f.notEmbedded ? `${f.notEmbedded} não incorporada${f.notEmbedded > 1 ? 's' : ''}` : 'todas incorporadas',
      }
    }
    case 'finishing': {
      const die = pages.find((pg) => pg.dieLine)
      return {
        value: die ? 'Com faca' : 'Sem faca',
        sub: die ? (p.colors?.technicalSpots.join(', ') || 'separação de corte') : t.requiresCutLayer ? 'a ficha exige faca' : 'não exigida',
      }
    }
    case 'structure': {
      const d = p.document ?? {}
      return {
        value: `PDF ${d.pdfVersion || '—'}`,
        sub: `${d.structureOk && d.rendersOk ? 'íntegro' : 'com problemas'} · ${fileSize(d.fileBytes)}`,
      }
    }
  }
}

const SIDES = (b: { top: number; right: number; bottom: number; left: number }) =>
  `${num(b.top)} / ${num(b.right)} / ${num(b.bottom)} / ${num(b.left)} mm`

/**
 * Fatos medidos de cada seção (os mesmos números que as regras usam). `bad` é a cor dos
 * valores fora do pedido: a cor da seção (vermelho se bloqueia, amarelo se pede decisão).
 */
export function factsOf(id: SectionId, p: FileProfile, bad: Tone): Fact[] {
  const t = p.targets ?? {}
  const pages = p.pages ?? []
  switch (id) {
    case 'format':
      return [
        { label: 'Páginas', value: String(p.document?.pages ?? pages.length) },
        { label: 'Formato no arquivo', value: size(pages[0]?.fileMm) },
        { label: 'Escala', value: scaleLabel(t.scale) },
        { label: 'Tamanho final', value: finalSize(p) },
        {
          label: 'Ficha pede',
          value: t.finalWidthMm && t.finalHeightMm ? size([t.finalWidthMm, t.finalHeightMm]) : 'não informado',
          tone: t.finalWidthMm && t.finalHeightMm ? undefined : 'info',
        },
      ]
    case 'bleed': {
      const withTrim = pages.filter((pg) => pg.hasTrimBox).length
      const withBleed = pages.filter((pg) => pg.hasBleedBox).length
      const bleed = minBleed(p)
      const enough =
        bleed && t.minBleedMm !== undefined ? Math.min(bleed.top, bleed.right, bleed.bottom, bleed.left) >= t.minBleedMm - 0.05 : undefined
      return [
        {
          label: 'Formato final (TrimBox)',
          value: withTrim === pages.length ? 'definido' : withTrim ? `em ${withTrim} de ${pages.length} páginas` : 'não definido',
          tone: withTrim === pages.length ? 'ok' : bad,
        },
        {
          label: 'Área de sangria (BleedBox)',
          value: withBleed === pages.length ? 'definida' : withBleed ? `em ${withBleed} de ${pages.length} páginas` : 'não definida',
          tone: withBleed === pages.length ? 'ok' : bad,
        },
        {
          label: 'Sangria no tamanho final',
          value: bleed ? SIDES(bleed) : '—',
          hint: 'Cima / direita / baixo / esquerda (menor valor entre as páginas)',
          tone: enough === undefined ? undefined : enough ? 'ok' : bad,
        },
        { label: 'Ficha pede', value: t.minBleedMm !== undefined ? `mínimo ${mm(t.minBleedMm)}` : '—' },
      ]
    }
    case 'images': {
      const img = p.images
      if (!img || !img.count) return [{ label: 'Imagens', value: 'nenhuma: a arte é só vetorial', tone: 'ok' }]
      const low = t.minPpi && img.minFinalPpi !== null ? img.minFinalPpi < t.minPpi : undefined
      return [
        { label: 'Imagens', value: `${img.count}${img.withTransparency ? ` · ${img.withTransparency} com transparência` : ''}` },
        {
          label: 'Menor resolução no tamanho final',
          value: img.minFinalPpi !== null ? `${num(img.minFinalPpi, 0)} ppi` : '—',
          tone: low === undefined ? undefined : low ? bad : 'ok',
        },
        { label: 'Ficha pede', value: t.minPpi ? `mínimo ${t.minPpi} ppi` : '—' },
        {
          label: 'Espaços de cor',
          value: Object.entries(img.colorSpaces)
            .map(([space, n]) => `${space} ×${n}`)
            .join(' · '),
        },
      ]
    }
    case 'colors': {
      const c = p.colors
      if (!c) return []
      return [
        {
          label: 'Vetores e textos',
          value: `CMYK ${c.cmykOperators} · RGB ${c.rgbOperators} · Cinza ${c.grayOperators}`,
          hint: 'Quantas operações de pintura usam cada espaço de cor',
          tone: c.rgbOperators > 0 ? (t.rgbPolicy === 'cmyk_only' ? bad : 'info') : 'ok',
        },
        { label: 'RGB', value: t.rgbPolicy === 'cmyk_only' ? 'não aceito (somente CMYK)' : 'aceito: o RIP converte' },
        { label: 'Cores especiais', value: c.spots.length ? c.spots.join(', ') : 'nenhuma' },
        {
          label: 'Perfil de saída',
          value: c.outputIntent || 'não declarado',
          tone: c.outputIntent ? (c.outputIntentValid === false ? bad : 'ok') : 'info',
        },
        {
          label: 'Cobertura máxima de tinta',
          value: c.maxInkCoverage ? `${num(c.maxInkCoverage, 0)}%${t.maxInkCoverage ? ` · limite ${t.maxInkCoverage}%` : ''}` : '—',
          tone: c.maxInkCoverage && t.maxInkCoverage ? (c.maxInkCoverage > t.maxInkCoverage ? bad : 'ok') : undefined,
        },
      ]
    }
    case 'fonts': {
      const f = p.fonts
      if (!f || !f.count) return [{ label: 'Fontes', value: 'nenhuma: textos em curvas ou sem texto', tone: 'ok' }]
      return f.items.slice(0, 10).map((font) => ({
        label: font.name,
        value: `${font.embedded ? 'incorporada' : 'não incorporada'} · ${font.type}`,
        tone: (font.embedded ? 'ok' : bad) as Tone,
      }))
    }
    case 'finishing': {
      const withDie = pages.filter((pg) => pg.dieLine)
      const c = p.colors
      const magenta = pages.reduce((n, pg) => n + (pg.magentaStrokes ?? 0), 0)
      return [
        {
          label: 'Faca',
          value: withDie.length ? `presente${withDie[0].dieLineFinalMm ? ` · ${size(withDie[0].dieLineFinalMm)}` : ''}` : 'não encontrada',
          tone: withDie.length ? 'ok' : t.requiresCutLayer ? bad : undefined,
        },
        { label: 'Separação de corte', value: c?.technicalSpots.length ? c.technicalSpots.join(', ') : '—' },
        { label: 'Ficha exige faca', value: t.requiresCutLayer ? 'sim' : 'não' },
        ...(magenta ? [{ label: 'Linhas em 100% magenta', value: `${magenta} (podem ser uma faca)`, tone: 'info' as Tone }] : []),
        { label: 'Camadas', value: p.layers?.length ? p.layers.join(', ') : 'nenhuma' },
      ]
    }
    case 'structure': {
      const d = p.document ?? {}
      return [
        {
          label: 'Integridade',
          value: d.structureOk && d.rendersOk ? 'íntegro: abre e renderiza' : 'com problemas',
          tone: d.structureOk && d.rendersOk ? 'ok' : 'blocked',
        },
        { label: 'Versão', value: `PDF ${d.pdfVersion || '—'}${d.pdfx ? ` · ${d.pdfx}` : ''}` },
        { label: 'Criado em', value: [d.creator, d.producer].filter(Boolean).join(' · ') || '—' },
        { label: 'Tamanho do arquivo', value: fileSize(d.fileBytes) },
        ...(d.encrypted ? [{ label: 'Protegido', value: 'sim, com senha', tone: bad }] : []),
      ]
    }
  }
}
