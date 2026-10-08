import supabase from '@/lib/supabase/client'
import { getErrorMessage } from '@/lib/supabase/errors'
import type { Seam, Tile, TilingLayout, TilingSettings } from '@/lib/tiling'

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

export interface TilingConfig {
  page: number
  fileScale: number
  /** Tamanho do formato final no arquivo (mm, escala 1:1), para refazer a escala. */
  trimMm: { w: number; h: number }
  settings: TilingSettings
  layout: TilingLayout
  marks: TilingMarksConfig
  /** Painéis em pé (largura do material = largura do painel) ou deitados. */
  direction: 'standing' | 'lying'
  materialWidthMm: number
  materialLengthMm: number
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
}

export interface TilingTemplate {
  id: string
  name: string
  config: TilingConfig
  background: TilingBackground | null
  created: string
}

export const TILING_ACTIVE = ['queued', 'running']

/** O que o analisador recebe de cada painel. */
export function tilesForExport(tiles: Tile[]) {
  return tiles.map((t) => ({
    number: t.number,
    name: t.name,
    region: t.region,
    column: t.column,
    row: t.row,
    visible: t.visible,
    printed: t.printed,
  }))
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

  async get(id: string): Promise<TilingProject | null> {
    const { data, error } = await supabase.from('tiling_projects').select('*').eq('id', id).maybeSingle()
    if (error) throw error
    return data as TilingProject | null
  },

  /** Cria ou atualiza o rascunho; devolve o id. */
  async save(
    id: string | null,
    values: {
      name: string
      projectId: string
      fileId: string
      config: TilingConfig
      tiles: Tile[]
      seams: Seam[]
      background: TilingBackground | null
    },
  ): Promise<string> {
    const row = {
      name: values.name,
      project_id: values.projectId,
      file_id: values.fileId,
      config: values.config,
      tiles: tilesForExport(values.tiles),
      seams: values.seams.map((s) => ({
        orientation: s.orientation,
        position: s.position,
        start: s.start,
        end: s.end,
        kind: s.kind,
        widthMm: s.widthMm,
      })),
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
