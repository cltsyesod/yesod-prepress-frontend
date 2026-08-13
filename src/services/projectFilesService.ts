import pb from '@/lib/pocketbase/client'
import { getErrorMessage } from '@/lib/pocketbase/errors'

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

export const projectFilesService = {
  async registerFile(params: RegisterFileParams): Promise<{ id: string; status: string }> {
    return pb.send('/backend/v1/project-files/register', {
      method: 'POST',
      body: JSON.stringify(params),
      headers: { 'Content-Type': 'application/json' },
    })
  },

  async uploadFile(recordId: string, file: File): Promise<void> {
    const formData = new FormData()
    formData.append('file', file)
    await pb.collection('project_files').update(recordId, formData)
  },

  async confirmFile(recordId: string): Promise<ProjectFileRecord> {
    return pb.send(`/backend/v1/project-files/${recordId}/confirm`, {
      method: 'POST',
    })
  },

  async listFiles(projectId: string): Promise<ProjectFileRecord[]> {
    return pb.send(`/backend/v1/project-files/by-project/${projectId}`, {
      method: 'GET',
    })
  },

  async getFile(recordId: string): Promise<ProjectFileRecord> {
    return pb.send(`/backend/v1/project-files/${recordId}`, {
      method: 'GET',
    })
  },

  async removeFile(recordId: string): Promise<void> {
    await pb.send(`/backend/v1/project-files/${recordId}`, {
      method: 'DELETE',
    })
  },

  async setPrimaryFile(recordId: string): Promise<void> {
    await pb.send(`/backend/v1/project-files/${recordId}/set-primary`, {
      method: 'PATCH',
    })
  },

  getFileUrl(record: { id: string; file: string }): string {
    if (!record.file) return ''
    try {
      return pb.files.getUrl(
        { id: record.id, collectionId: 'project_files', collectionName: 'project_files' } as any,
        record.file,
      )
    } catch {
      return `${pb.baseUrl}/api/files/project_files/${record.id}/${record.file}`
    }
  },

  getErrorMessage(error: unknown): string {
    return getErrorMessage(error)
  },
}
