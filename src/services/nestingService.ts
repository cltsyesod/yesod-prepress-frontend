import supabase from '@/lib/supabase/client'
import { getErrorMessage } from '@/lib/supabase/errors'
import { projectFilesService } from '@/services/projectFilesService'

/** Material e regras de encaixe: todos definidos pelo operador a cada montagem. */
export interface NestingParams {
  material: {
    widthMm: number
    /** Vazio = rolo; preenchido = folha/chapa desse comprimento. */
    lengthMm?: number
    marginMm: number
    gapMm: number
  }
  rotation: { allow: boolean; stepDegrees: number }
  /** Faca gerada pelo contorno da arte (arquivos sem faca). Valores no tamanho final. */
  cutLines: {
    add: boolean
    name: string
    offsetMm?: number
    mergeMm?: number
    /** Também corta os vazados internos da arte (e encaixa peças pequenas dentro deles). */
    cutHoles?: boolean
    /** "keep": o fundo branco faz parte da peça; padrão: é ignorado. */
    whiteBackground?: 'ignore' | 'keep'
  }
  marks?: NestingMarks
  /** Retalho do estoque usado como material (baixado quando a montagem é criada). */
  offcutId?: string
}

/** Marcas fora das peças; formato e medidas seguem o plotter do operador. */
export interface NestingMarks {
  registration: 'none' | 'sides' | 'corners'
  shape: 'square' | 'circle'
  sizeMm: number
  distanceMm: number
  spacingMm: number
  cropMarks: boolean
  slug: string
}

export interface MaterialOffcut {
  id: string
  name: string
  width_mm: number
  length_mm: number
  source_run: string | null
  created: string
}

export interface NestingItem {
  projectId: string
  fileId: string
  label: string
  quantity: number
  fileScale?: string | number
  bleedMm?: number
  cutNames?: string[]
}

export interface NestingSheet {
  index: number
  pieces: number
  lengthMm: number
  /** Área das peças ÷ folha inteira (ou comprimento usado, no rolo). */
  efficiency: number
  /** Até o topo da última peça: mostra se o encaixe está bom na parte ocupada. */
  usedLengthMm?: number
  usedEfficiency?: number
  /** Retalho que sobra ao cortar a folha logo acima das peças: [largura, comprimento]. */
  offcutMm?: [number, number]
}

export interface NestingResult {
  widthMm?: number
  sheets?: NestingSheet[]
  totalLengthMm?: number
  placed?: number
  unplaced?: { label: string; copy: number; reason: string }[]
  dieLines?: string[]
  /** Cópias a mais de cada trabalho (sozinho) que ainda cabem na última folha. key = fileId. */
  fill?: { key: string; label: string; extra: number }[]
}

export interface NestingRun {
  id: string
  name: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  progress: number
  current_step: string
  params: NestingParams
  items: NestingItem[]
  result: NestingResult
  output_path: string
  error_message: string
  created: string
}

export const NESTING_ACTIVE = ['queued', 'running']

export const nestingService = {
  async listRuns(): Promise<NestingRun[]> {
    const { data, error } = await supabase
      .from('nesting_runs')
      .select('*')
      .order('created', { ascending: false })
      .limit(30)
    if (error) throw error
    return (data ?? []) as NestingRun[]
  },

  /** Registra a montagem e a envia ao analisador. Retorna o id. */
  async create(name: string, params: NestingParams, items: NestingItem[]): Promise<string> {
    const { data, error } = await supabase
      .from('nesting_runs')
      .insert({ name, params, items, status: 'queued', current_step: 'Enviando ao analisador' })
      .select('id')
      .single()
    if (error) throw error

    const { error: invokeError } = await supabase.functions.invoke('start_nesting', {
      body: { nestingId: data.id },
    })
    if (invokeError) {
      const detail = await (invokeError as { context?: Response }).context?.json?.().catch(() => null)
      throw new Error(detail?.error || getErrorMessage(invokeError))
    }
    return data.id as string
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('nesting_runs').delete().eq('id', id)
    if (error) throw error
  },

  async outputUrl(run: NestingRun): Promise<string> {
    return run.output_path ? projectFilesService.getDownloadUrl(run.output_path) : ''
  },
}

/** Estoque de retalhos: sobras de chapa que voltam a ser material. */
export const offcutService = {
  async listAvailable(): Promise<MaterialOffcut[]> {
    const { data, error } = await supabase
      .from('material_offcuts')
      .select('id, name, width_mm, length_mm, source_run, created')
      .eq('status', 'available')
      .order('created', { ascending: false })
    if (error) throw error
    return (data ?? []) as MaterialOffcut[]
  },

  async add(offcut: { name: string; widthMm: number; lengthMm: number; sourceRun?: string }) {
    const { error } = await supabase.from('material_offcuts').insert({
      name: offcut.name,
      width_mm: offcut.widthMm,
      length_mm: offcut.lengthMm,
      source_run: offcut.sourceRun ?? null,
    })
    if (error) throw error
  },

  async markUsed(id: string) {
    const { error } = await supabase
      .from('material_offcuts')
      .update({ status: 'used', used_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw error
  },

  async remove(id: string) {
    const { error } = await supabase.from('material_offcuts').delete().eq('id', id)
    if (error) throw error
  },
}
