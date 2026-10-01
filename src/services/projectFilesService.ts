import supabase from '@/lib/supabase/client'
import { getErrorMessage, normalizeRow, unwrap } from '@/lib/supabase/errors'

export interface RegisterFileParams {
  project: string
  version?: string
  original_name: string
  extension: string
  mime_type: string
  size_bytes: number
}

export interface ProjectFileRecord {
  id: string
  project: string
  version: string
  original_name: string
  safe_name: string
  extension: string
  mime_type: string
  size_bytes: number
  sha256: string
  user: string
  status: string
  error: string
  is_primary: boolean
  file: string
  created: string
  updated: string
}

const BUCKET = 'project-files'

function toRecord(row: Record<string, unknown>): ProjectFileRecord {
  const rec = normalizeRow<ProjectFileRecord & { storage_path: string }>(row)
  // `file` mantém o contrato antigo: preenchido somente quando há PDF enviado
  return { ...rec, file: rec.storage_path }
}

export const projectFilesService = {
  async registerFile(params: RegisterFileParams): Promise<{ id: string; status: string }> {
    const row = unwrap(
      await supabase.rpc('register_project_file', {
        p_project: params.project,
        p_original_name: params.original_name,
        p_extension: params.extension,
        p_mime_type: params.mime_type,
        p_size_bytes: params.size_bytes,
        p_version: params.version ?? '',
      }),
    ) as { id: string; status: string }
    return { id: row.id, status: row.status }
  },

  async uploadFile(recordId: string, file: File): Promise<void> {
    const { data: auth } = await supabase.auth.getUser()
    const userId = auth.user?.id
    if (!userId) throw new Error('Autenticação necessária')

    const path = `${userId}/${recordId}.pdf`
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { contentType: 'application/pdf', upsert: true })
    if (upErr) throw upErr

    const { error } = await supabase
      .from('project_files')
      .update({ storage_path: path, status: 'uploaded' })
      .eq('id', recordId)
    if (error) throw error
  },

  async confirmFile(recordId: string): Promise<ProjectFileRecord> {
    return toRecord(unwrap(await supabase.rpc('confirm_project_file', { p_id: recordId })))
  },

  async listFiles(projectId: string): Promise<ProjectFileRecord[]> {
    const rows = unwrap(
      await supabase
        .from('project_files')
        .select('*')
        .eq('project', projectId)
        .neq('status', 'removed')
        .order('created', { ascending: false }),
    )
    return rows.map(toRecord)
  },

  async getFile(recordId: string): Promise<ProjectFileRecord> {
    return toRecord(
      unwrap(await supabase.from('project_files').select('*').eq('id', recordId).single()),
    )
  },

  async removeFile(recordId: string): Promise<void> {
    const { error } = await supabase
      .from('project_files')
      .update({ status: 'removed' })
      .eq('id', recordId)
    if (error) throw error
  },

  async setPrimaryFile(recordId: string): Promise<void> {
    unwrap(await supabase.rpc('set_primary_project_file', { p_id: recordId }))
  },

  /** URL assinada (1h) para abrir/baixar o PDF privado. */
  async getFileUrl(record: { file: string }): Promise<string> {
    if (!record.file) return ''
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(record.file, 3600)
    if (error) throw error
    return data.signedUrl
  },

  getErrorMessage(error: unknown): string {
    return getErrorMessage(error)
  },
}
