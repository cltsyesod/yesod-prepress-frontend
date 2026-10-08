import supabase from '@/lib/supabase/client'
import { getErrorMessage } from '@/lib/supabase/errors'
import {
  DEFAULT_LABEL_BOTTOM,
  DEFAULT_LABEL_TOP,
  fillLabel,
  isLegacy,
  migrateLegacy,
  type LabelContext,
  type GridRequest,
  type ProjectGeometry,
  type TilingProjectModel,
} from '@/domain/tiling'

const BUCKET = 'tiling'

/** Imagem do local de instalação: só referência na tela e no guia, nunca impressa. */
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
  /** Marcas de corte nos cantos do painel físico. */
  cropMarks: boolean
  /** Marcas tracejadas de início/fim da sobreposição (sem valor: segue as de corte). */
  overlapMarks?: boolean
  /** Marcas no meio de cada borda, para alinhar os painéis na instalação. */
  centerMarks?: boolean
  label: boolean
  /** Modelos das duas linhas da etiqueta (margem de cima e de baixo). */
  labelTop?: string
  labelBottom?: string
}

/** O que fica salvo: o projeto do motor + o que é só desta tela. */
export interface TilingConfig {
  version: 2
  page: number
  project: TilingProjectModel
  request: GridRequest
  marks: TilingMarksConfig
  /** Revisão dos arquivos: sobe a cada exportação de um projeto alterado. */
  revision?: number
  /** Impressão digital do conteúdo na última exportação (para saber se ficou desatualizada). */
  exportedHash?: string
}

/** JSON com chaves em ordem e números arredondados: o mesmo conteúdo dá sempre o mesmo texto. */
function stable(value: unknown): string {
  if (typeof value === 'number') return String(Math.round(value * 100) / 100)
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

/** Impressão digital (FNV-1a) do que define os arquivos: projeto, nome, página, marcas e imagem do guia. */
export function contentHash(values: {
  project: TilingProjectModel
  name: string
  page: number
  marks: TilingMarksConfig
  background: TilingBackground | null
}): string {
  const text = stable([values.project, values.name, values.page, values.marks, values.background])
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** Exportado e alterado depois: os arquivos baixados não correspondem mais ao projeto. */
export function isOutdated(row: TilingProject): boolean {
  if (row.status !== 'completed' || !row.config?.exportedHash || !row.config.project) return false
  return (
    contentHash({
      project: row.config.project,
      name: row.name,
      page: row.config.page || 1,
      marks: row.config.marks,
      background: row.background,
    }) !== row.config.exportedHash
  )
}

export interface TilingResult {
  panels?: number
  files?: {
    number: number
    id?: string
    file: string
    region?: string
    printedMm: [number, number]
    physicalMm?: [number, number]
    rotation?: number
  }[]
  revision?: number
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

/** O que o analisador recebe: só os painéis ligados, já calculados pelo motor, com a etiqueta pronta. */
export function exportPayload(
  geometry: ProjectGeometry,
  labels?: { marks: TilingMarksConfig; context: Omit<LabelContext, 'total' | 'numberOf'> },
) {
  const active = geometry.tiles.filter((t) => t.enabled)
  const numbers = new Map(active.map((t) => [t.id, t.number]))
  const context: LabelContext | null = labels
    ? { ...labels.context, total: active.length, numberOf: (id) => numbers.get(id) }
    : null
  const tiles = active
    .map((t) => ({
      ...(context && labels
        ? {
            labelTop: labels.marks.label ? fillLabel(labels.marks.labelTop ?? DEFAULT_LABEL_TOP, t, context) : '',
            labelBottom: labels.marks.label ? fillLabel(labels.marks.labelBottom ?? DEFAULT_LABEL_BOTTOM, t, context) : '',
          }
        : {}),
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
      install: t.install,
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
      labels?: Parameters<typeof exportPayload>[1]
    },
  ): Promise<string> {
    const { tiles, seams } = exportPayload(values.geometry, values.labels)
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
