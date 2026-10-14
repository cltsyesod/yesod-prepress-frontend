/**
 * Raio-X do arquivo: o perfil medido pelo analisador (formato, caixas, sangria, imagens,
 * cores, fontes, faca, estrutura) organizado em seções, cada uma com a sua situação
 * (bloqueia, decisão, informação, ok) a partir das ocorrências da análise.
 */

import type { AnalysisIssue } from '@/services/analysisJobsService'

export interface TextilePage {
  page: number
  px_per_mm: number
  box_mm: [number, number]
  art_mm: [number, number, number, number] | null
  artSizeMm: [number, number] | null
  painted_mm2: number
  opaque_share_of_box: number
  partial_share: number
  below_threshold_share: number | null
  thin_mm2: number | null
  thin_measured: boolean
}

/** Seções que valem para a tecnologia do perfil (gráfica: sangria e faca; DTF/DTG: estampa). */
export const sectionApplies = (id: SectionId, p: FileProfile | null): boolean =>
  p?.textile ? id !== 'bleed' && id !== 'finishing' : id !== 'textile'

export interface InkPage {
  page: number
  inks: { name: string; process: boolean; coverage: number; area: number; meanWhereUsed: number; share: number }[]
  maxProcessTotal: number
}

export interface FileProfile {
  /** Proporção de tintas pela separação do arquivo (todas as tecnologias). */
  inks?: { pages: InkPage[]; error: string; dpi?: number }
  technology?: 'grafica' | 'dtf' | 'dtg'
  textile?: { pages: TextilePage[]; error: string; settings?: Record<string, string | number | boolean | null> } | null
  document?: {
    pdfVersion?: string
    pdfx?: string
    pages?: number
    fileBytes?: number
    encrypted?: boolean
    creator?: string
    producer?: string
    title?: string
    structureOk?: boolean
    rendersOk?: boolean
  }
  pages?: {
    number: number
    fileMm: [number, number]
    finalMm: [number, number]
    mediaMm?: [number, number]
    hasTrimBox: boolean
    hasBleedBox: boolean
    bleedMm: { left: number; bottom: number; right: number; top: number } | null
    rotation?: number
    dieLine: boolean
    dieLineFinalMm: [number, number] | null
    magentaStrokes?: number
  }[]
  images?: {
    count: number
    minFinalPpi: number | null
    maxFinalPpi: number | null
    colorSpaces: Record<string, number>
    withTransparency: number
    items: {
      page: number
      px: [number, number]
      filePpi: number | null
      finalPpi: number | null
      colorSpace: string
      bits: number | null
      transparency: boolean
    }[]
  }
  fonts?: { count: number; notEmbedded: number; items: { name: string; type: string; embedded: boolean; pages: number[] }[] }
  colors?: {
    rgbOperators: number
    cmykOperators: number
    grayOperators: number
    spots: string[]
    technicalSpots: string[]
    maxInkCoverage: number
    outputIntent: string
    outputIntentValid: boolean | null
  }
  layers?: string[]
  targets?: {
    scale?: number
    finalWidthMm?: number | null
    finalHeightMm?: number | null
    minPpi?: number
    minBleedMm?: number
    rgbPolicy?: 'managed' | 'cmyk_only'
    maxInkCoverage?: number
    requiresCutLayer?: boolean
    cutLayerNames?: string[]
    requirePdfX?: boolean
  }
}

export const hasProfile = (profile: unknown): profile is FileProfile =>
  !!profile && typeof profile === 'object' && Object.keys(profile as object).length > 0

/** Situação de uma seção ou do arquivo inteiro. */
export type Tone = 'blocked' | 'decision' | 'info' | 'ok' | 'resolved'

export const TONE_LABEL: Record<Tone, string> = {
  blocked: 'Bloqueia',
  decision: 'Decidir',
  info: 'Informação',
  ok: 'Conferido',
  resolved: 'Resolvido',
}

/** Classes de cor de cada situação (bolinha, texto, fundo suave, borda). */
export const TONE_CLASS: Record<Tone, { dot: string; text: string; soft: string; border: string }> = {
  blocked: { dot: 'bg-red-500', text: 'text-red-700 dark:text-red-400', soft: 'bg-red-500/10', border: 'border-red-500/40' },
  decision: {
    dot: 'bg-amber-500',
    text: 'text-amber-700 dark:text-amber-400',
    soft: 'bg-amber-500/10',
    border: 'border-amber-500/40',
  },
  info: { dot: 'bg-sky-500', text: 'text-sky-700 dark:text-sky-400', soft: 'bg-sky-500/10', border: 'border-sky-500/40' },
  ok: {
    dot: 'bg-emerald-500',
    text: 'text-emerald-700 dark:text-emerald-400',
    soft: 'bg-emerald-500/10',
    border: 'border-emerald-500/40',
  },
  resolved: {
    dot: 'bg-emerald-500',
    text: 'text-emerald-700 dark:text-emerald-400',
    soft: 'bg-emerald-500/10',
    border: 'border-emerald-500/40',
  },
}

export type SectionId =
  | 'format'
  | 'bleed'
  | 'images'
  | 'colors'
  | 'fonts'
  | 'finishing'
  | 'textile'
  | 'structure'

export const SECTIONS: { id: SectionId; title: string; codes: string[] }[] = [
  { id: 'format', title: 'Formato e tamanho', codes: ['PAGE_DIMENSION_MISMATCH', 'PAGE_SIZE_INCONSISTENT'] },
  { id: 'bleed', title: 'Sangria e caixas', codes: ['PAGE_BLEED_INSUFFICIENT', 'PAGE_TRIMBOX_MISSING'] },
  { id: 'images', title: 'Imagens', codes: ['IMAGE_LOW_RESOLUTION', 'IMAGE_RGB', 'IMAGE_TRANSPARENCY', 'IMAGE_UPSCALED'] },
  {
    id: 'colors',
    title: 'Cores',
    codes: ['COLOR_RGB_CONTENT', 'COLOR_SPOT_DUPLICATE', 'COLOR_SPOT_INVENTORY', 'COLOR_OUTPUT_INTENT', 'COLOR_INK_COVERAGE'],
  },
  { id: 'fonts', title: 'Fontes e textos', codes: ['FONT_NOT_EMBEDDED', 'FONT_PROGRAM_INVALID'] },
  { id: 'finishing', title: 'Faca e acabamento', codes: ['FINISHING_CUT_LAYER', 'FINISHING_MAGENTA_DIE_LINE'] },
  {
    id: 'textile',
    title: 'Estampa e base branca',
    codes: [
      'TEXTILE_PRINT_AREA',
      'TEXTILE_SEMI_TRANSPARENT',
      'TEXTILE_SOLID_BACKGROUND',
      'TEXTILE_THIN_DETAILS',
      'TEXTILE_NOT_MEASURED',
    ],
  },
  {
    id: 'structure',
    title: 'Estrutura do PDF',
    codes: ['FILE_PDF_SYNTAX', 'FILE_PDFIUM_RENDER', 'FILE_PDF_VERSION', 'FILE_PDFX_REQUIRED'],
  },
]

export const sectionOf = (ruleCode: string): SectionId | null =>
  SECTIONS.find((s) => s.codes.includes(ruleCode))?.id ?? null

/** Situação de um conjunto de ocorrências: a pior pendente; decididas contam como resolvidas. */
export function toneOf(issues: AnalysisIssue[]): Tone {
  const pending = issues.filter((i) => i.status === 'pending')
  if (pending.some((i) => i.severity === 'critical')) return 'blocked'
  if (pending.some((i) => i.severity === 'warning')) return 'decision'
  if (issues.some((i) => i.severity !== 'informational')) return 'resolved'
  if (issues.length) return 'info'
  return 'ok'
}

// ---- Formatação --------------------------------------------------------------------

export const num = (value: number, digits = 1) =>
  value.toLocaleString('pt-BR', { maximumFractionDigits: digits })
export const mm = (value: number) => `${num(value)} mm`
export const size = (pair: [number, number] | null | undefined) => (pair ? `${num(pair[0])} × ${num(pair[1])} mm` : '—')
export const megabytes = (bytes?: number) =>
  bytes === undefined ? '—' : `${(bytes / 1_048_576).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`

/** Menor sangria de cada lado entre as páginas (no tamanho final). */
export function minBleed(profile: FileProfile) {
  const all = (profile.pages ?? []).map((p) => p.bleedMm).filter(Boolean) as NonNullable<
    NonNullable<FileProfile['pages']>[number]['bleedMm']
  >[]
  if (!all.length) return null
  return {
    top: Math.min(...all.map((b) => b.top)),
    right: Math.min(...all.map((b) => b.right)),
    bottom: Math.min(...all.map((b) => b.bottom)),
    left: Math.min(...all.map((b) => b.left)),
  }
}

/** Tamanho final da página 1, ou "variado" quando as páginas têm tamanhos diferentes. */
export function finalSize(profile: FileProfile): string {
  const pages = profile.pages ?? []
  if (!pages.length) return '—'
  const first = pages[0].finalMm
  const same = pages.every((p) => Math.abs(p.finalMm[0] - first[0]) < 0.5 && Math.abs(p.finalMm[1] - first[1]) < 0.5)
  return same ? size(first) : `${size(first)} (páginas com tamanhos diferentes)`
}

export const scaleLabel = (scale?: number) =>
  !scale || scale === 1 ? '1:1 (tamanho real)' : `1:${num(scale, 2)}`
