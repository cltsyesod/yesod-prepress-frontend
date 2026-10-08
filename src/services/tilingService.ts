import supabase from '@/lib/supabase/client'
import { getErrorMessage } from '@/lib/supabase/errors'
import {
  isLegacy,
  migrateLegacy,
  type GridRequest,
  type ProjectGeometry,
  type TilingProjectModel,
} from '@/domain/tiling'

const BUCKET = 'tiling'

/** Imagem do veículo/fachada: só referência na tela e no guia, nunca impressa. */
export interface TilingBackground {
  path: string
  xMm: number
  yMm: number
  widthMm: number
  opacity: number
  visible: boolean
  visibleInGuide: boolean
}

export interface TilingMarksConfig {
  marginMm: number
  cropMarks: boolean
  label: boolean
}

/** O que fica salvo: o projeto do motor + o que é só desta tela. */
export interface TilingConfig {
  version: 2
  page: number
  project: TilingProjectModel
  request: GridRequest
  marks: TilingMarksConfig
}

export interface TilingResult {
  panels?: number
  files?: { number: number; file: string; printedMm: [number, number] }[]
  sizes?: { pdf: number; guide: number; zip: number }
  warnings?: string[]
}

export interface TilingProject {
  id: string
  project_id: string | null
  file_id: string | null
  name: string
  status: 'draft' | 'queued' | 'running' | 'completed' | 'failed'
  progress: number
  current_step: string
  config: TilingConfig
  tiles: unknown[]
  seams: unknown[]
  background: TilingBackground | null
  result: TilingResult
  output: { pdf?: string; zip?: string; guide?: string }
  error_message: string
  updated: string
  completed_at: string | null
}

export interface TilingTemplate {
  id: string
  name: string
  config: TilingConfig
  background: TilingBackground | null
  created: string
}

export const TILING_ACTIVE = ['queued', 'running']

const DEFAULT_MARKS: TilingMarksConfig = { marginMm: 10, cropMarks: true, label: true }

/** Configuração salva em qualquer formato -> formato atual (os antigos são convertidos). */
export function readConfig(raw: unknown): TilingConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  if (value.version === 2 && value.project) return raw as TilingConfig
  if (isLegacy(raw)) {
    const project = migrateLegacy(raw as Parameters<typeof migrateLegacy>[0])
    if (!project) return null
    const settings = (value.settings ?? {}) as { mode?: 'equal' | 'max' }
    return {
      version: 2,
      page: Number(value.page) || 1,
      project,
      request: { mode: settings.mode ?? 'equal' },
      marks: { ...DEFAULT_MARKS, ...((value.marks as TilingMarksConfig) ?? {}) },
    }
  }
  return null
}

/** O que o analisador recebe: só os painéis ligados, já calculados pelo motor. */
export function exportPayload(geometry: ProjectGeometry) {
  const tiles = geometry.tiles
    .filter((t) => t.enabled)
    .map((t) => ({
      number: t.number,
      id: t.id,
      name: t.name,
      zone: t.zone,
      column: t.column,
      row: t.row,
      logical: t.logical,
      print: t.print,
      white: t.white,
      rotation: t.rotation,
    }))
  const seams = geometry.seams.map((s) => ({
    orientation: s.orientation,
    position: s.position,
    start: s.start,
    end: s.end,
    kind: s.gap ? 'gap' : 'overlap',
    widthMm: s.gap?.width ?? 0,
  }))
  return { tiles, seams }
}

export const tilingService = {
  async list(): Promise<TilingProject[]> {
    const { data, error } = await supabase
      .from('tiling_projects')
      .select('*')
      .order('updated', { ascending: false })
      .limit(30)
    if (error) throw error
    return (data ?? []) as TilingProject[]
  },

  /** Cria ou atualiza o rascunho; devolve o id. */
  async save(
    id: string | null,
    values: {
      name: string
      projectId: string
      fileId: string
      config: TilingConfig
      geometry: ProjectGeometry
      background: TilingBackground | null
    },
  ): Promise<string> {
    const { tiles, seams } = exportPayload(values.geometry)
    const row = {
      name: values.name,
      project_id: values.projectId,
      file_id: values.fileId,
      config: values.config,
      tiles,
      seams,
      background: values.background,
      updated: new Date().toISOString(),
    }
    if (id) {
      const { error } = await supabase.from('tiling_projects').update(row).eq('id', id)
      if (error) throw error
      return id
    }
    const { data, error } = await supabase.from('tiling_projects').insert(row).select('id').single()
    if (error) throw error
    return data.id as string
  },

  async export(id: string): Promise<void> {
    const { error } = await supabase.functions.invoke('start_tiling', { body: { tilingId: id } })
    if (error) {
      const detail = await (error as { context?: Response }).context?.json?.().catch(() => null)
      throw new Error(detail?.error || getErrorMessage(error))
    }
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('tiling_projects').delete().eq('id', id)
    if (error) throw error
  },

  /** Envia a imagem de referência; devolve o caminho no armazenamento. */
  async uploadBackground(userId: string, file: File): Promise<string> {
    const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '')
    const path = `${userId}/referencias/${crypto.randomUUID()}.${ext}`
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type })
    if (error) throw error
    return path
  },

  async signedUrl(path: string): Promise<string> {
    if (!path) return ''
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600)
    if (error) throw error
    return data.signedUrl
  },

  async listTemplates(): Promise<TilingTemplate[]> {
    const { data, error } = await supabase
      .from('tiling_templates')
      .select('id, name, config, background, created')
      .order('created', { ascending: false })
    if (error) throw error
    return (data ?? []) as TilingTemplate[]
  },

  async saveTemplate(name: string, config: TilingConfig, background: TilingBackground | null): Promise<void> {
    const { error } = await supabase.from('tiling_templates').insert({ name, config, background })
    if (error) throw error
  },

  async removeTemplate(id: string): Promise<void> {
    const { error } = await supabase.from('tiling_templates').delete().eq('id', id)
    if (error) throw error
  },
}
