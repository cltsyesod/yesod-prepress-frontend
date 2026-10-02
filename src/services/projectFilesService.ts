import supabase from '@/lib/supabase/client'
import { getErrorMessage, normalizeRow, unwrap } from '@/lib/supabase/errors'
import type { ProjectFile } from '@/types'

export type ProjectFileRecord = ProjectFile

export interface RegisterFileParams {
  project: string
  version?: string
  original_name: string
  extension: string
  mime_type: string
  size_bytes: number
}

const PRIMARY_BUCKET = 'pdfs'
const FALLBACK_BUCKET = 'project-files'

async function calculateSHA256(file: File): Promise<string> {
  try {
    const buffer = await file.arrayBuffer()
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return ''
  }
}

function toRecord(row: Record<string, unknown>): ProjectFile {
  const rec = normalizeRow<ProjectFile>(row)
  return {
    ...rec,
    file: (row.storage_path as string) || (rec.file ?? ''),
    storage_path: (row.storage_path as string) || (rec.file ?? ''),
  }
}

export const projectFilesService = {
  /**
   * Upload direto de PDF para o bucket `pdfs` e registro na tabela `project_files`.
   */
  async uploadPDF(file: File, projectId: string): Promise<ProjectFile> {
    const { data: auth, error: authErr } = await supabase.auth.getUser()
    const userId = auth.user?.id
    if (authErr || !userId) {
      throw new Error('Autenticação necessária')
    }

    const sha256Hash = await calculateSHA256(file)
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const storagePath = `${userId}/${projectId}/${Date.now()}_${safeName}`

    // 1. Upload para o bucket pdfs (ou fallback project-files)
    let uploadError: unknown = null
    const { error: upErr1 } = await supabase.storage
      .from(PRIMARY_BUCKET)
      .upload(storagePath, file, { contentType: 'application/pdf', upsert: true })

    if (upErr1) {
      const { error: upErr2 } = await supabase.storage
        .from(FALLBACK_BUCKET)
        .upload(storagePath, file, { contentType: 'application/pdf', upsert: true })
      uploadError = upErr2
    }

    if (uploadError) {
      throw uploadError
    }

    // 2. Registro no banco
    const { data, error: dbErr } = await supabase
      .from('project_files')
      .insert({
        project: projectId,
        original_name: file.name,
        safe_name: safeName,
        extension: 'PDF',
        mime_type: 'application/pdf',
        size_bytes: file.size,
        sha256: sha256Hash,
        user_id: userId,
        storage_path: storagePath,
        status: 'ready_for_analysis',
        is_primary: true,
      })
      .select()
      .single()

    if (dbErr) throw dbErr
    return toRecord(data)
  },

  /**
   * Lista arquivos de um projeto.
   */
  async getProjectFiles(projectId: string): Promise<ProjectFile[]> {
    const { data, error } = await supabase
      .from('project_files')
      .select('*')
      .eq('project', projectId)
      .neq('status', 'removed')
      .order('created', { ascending: false })

    if (error) throw error
    return (data || []).map(toRecord)
  },

  /** Alias para manter compatibilidade com componentes existentes */
  async listFiles(projectId: string): Promise<ProjectFile[]> {
    return this.getProjectFiles(projectId)
  },

  /**
   * Obtém detalhes de um arquivo por ID.
   */
  async getFile(fileId: string): Promise<ProjectFile> {
    const { data, error } = await supabase
      .from('project_files')
      .select('*')
      .eq('id', fileId)
      .single()

    if (error) throw error
    return toRecord(data)
  },

  /**
   * Gera URL assinada de download (1 hora de validade).
   */
  async getDownloadUrl(storagePath: string): Promise<string> {
    if (!storagePath) return ''

    // Tenta no bucket pdfs
    const { data: d1 } = await supabase.storage.from(PRIMARY_BUCKET).createSignedUrl(storagePath, 3600)
    if (d1?.signedUrl) return d1.signedUrl

    // Fallback para project-files
    const { data: d2, error } = await supabase.storage.from(FALLBACK_BUCKET).createSignedUrl(storagePath, 3600)
    if (error) throw error
    return d2.signedUrl
  },

  /** Alias para compatibilidade com registros que contêm o campo `file` */
  async getFileUrl(record: { file?: string; storage_path?: string }): Promise<string> {
    const path = record.storage_path || record.file || ''
    return this.getDownloadUrl(path)
  },

  /**
   * Remove arquivo do Storage e marca como removido no banco.
   */
  async deleteFile(fileId: string, storagePath?: string): Promise<void> {
    if (storagePath) {
      await supabase.storage.from(PRIMARY_BUCKET).remove([storagePath]).catch(() => null)
      await supabase.storage.from(FALLBACK_BUCKET).remove([storagePath]).catch(() => null)
    }

    const { error } = await supabase
      .from('project_files')
      .update({ status: 'removed' })
      .eq('id', fileId)

    if (error) throw error
  },

  /** Alias para deleteFile */
  async removeFile(fileId: string): Promise<void> {
    return this.deleteFile(fileId)
  },

  // ---------- Métodos mantidos para retrocompatibilidade ----------
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
    let { error: upErr } = await supabase.storage
      .from(PRIMARY_BUCKET)
      .upload(path, file, { contentType: 'application/pdf', upsert: true })

    if (upErr) {
      const { error: upErr2 } = await supabase.storage
        .from(FALLBACK_BUCKET)
        .upload(path, file, { contentType: 'application/pdf', upsert: true })
      upErr = upErr2
    }
    if (upErr) throw upErr

    const { error } = await supabase
      .from('project_files')
      .update({ storage_path: path, status: 'uploaded' })
      .eq('id', recordId)
    if (error) throw error
  },

  async confirmFile(recordId: string): Promise<ProjectFile> {
    return toRecord(unwrap(await supabase.rpc('confirm_project_file', { p_id: recordId })))
  },

  async setPrimaryFile(recordId: string): Promise<void> {
    unwrap(await supabase.rpc('set_primary_project_file', { p_id: recordId }))
  },

  getErrorMessage(error: unknown): string {
    return getErrorMessage(error)
  },
}
