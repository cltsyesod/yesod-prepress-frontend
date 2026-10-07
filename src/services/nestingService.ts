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
  cutLines: { add: boolean; name: string; offsetMm?: number; mergeMm?: number }
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
  efficiency: number
}

export interface NestingResult {
  widthMm?: number
  sheets?: NestingSheet[]
  totalLengthMm?: number
  placed?: number
  unplaced?: { label: string; copy: number; reason: string }[]
  dieLines?: string[]
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
