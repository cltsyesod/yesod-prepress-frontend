import { useEffect, useState, useCallback, useRef } from 'react'
import {
  FileText,
  Star,
  Check,
  Inbox,
  UploadCloud,
  X,
  AlertCircle,
  Loader2,
  Trash2,
  Download,
} from 'lucide-react'
import { cn, formatFileSize } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import pb from '@/lib/pocketbase/client'
import { projectFilesService } from '@/services/projectFilesService'
import { useRealtime } from '@/hooks/use-realtime'
import { activityService } from '@/services/activityService'
import { useAuth } from '@/hooks/use-auth'
import type { Project } from '@/types'

const FILE_STATUS_LABELS: Record<string, string> = {
  pending: 'Preparando',
  uploading: 'Enviando',
  uploaded: 'Validando',
  validating: 'Validando',
  ready_for_analysis: 'Concluído',
  failed: 'Falhou',
  removed: 'Removido',
}

interface UploadState {
  fileName: string
  fileSize: number
  status: 'preparing' | 'sending' | 'validating' | 'done' | 'error'
  error?: string
}

interface FilesTabProps {
  project: Project
}

export function FilesTab({ project }: FilesTabProps) {
  const [files, setFiles] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [uploadState, setUploadState] = useState<UploadState | null>(null)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const { user } = useAuth()

  const loadFiles = useCallback(async () => {
    try {
      const records = await pb.collection('project_files').getFullList({
        filter: `project = "${project.id}" && status != "removed"`,
        sort: '-created',
      })
      setFiles(records)
      setError(false)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [project.id])

  useEffect(() => {
    loadFiles()
  }, [loadFiles])
  useRealtime('project_files', () => {
    loadFiles()
  })

  const handleUpload = async (file: File) => {
    const ext = (file.name.split('.').pop() || '').toLowerCase()
    if (ext !== 'pdf' || file.type !== 'application/pdf') {
      setUploadState({
        fileName: file.name,
        fileSize: file.size,
        status: 'error',
        error:
          'Este formato será disponibilizado em uma próxima fase. Para a análise real atual, envie um arquivo PDF.',
      })
      return
    }
    if (file.size > 100 * 1024 * 1024) {
      setUploadState({
        fileName: file.name,
        fileSize: file.size,
        status: 'error',
        error: 'Arquivo muito grande (máx. 100 MB)',
      })
      return
    }
    if (file.size === 0) {
      setUploadState({
        fileName: file.name,
        fileSize: file.size,
        status: 'error',
        error: 'Arquivo vazio',
      })
      return
    }

    try {
      setUploadState({ fileName: file.name, fileSize: file.size, status: 'preparing' })
      const reg = await projectFilesService.registerFile({
        project: project.id,
        original_name: file.name,
        extension: 'PDF',
        mime_type: 'application/pdf',
        size_bytes: file.size,
      })

      setUploadState({ fileName: file.name, fileSize: file.size, status: 'sending' })
      await projectFilesService.uploadFile(reg.id, file)

      setUploadState({ fileName: file.name, fileSize: file.size, status: 'validating' })
      await projectFilesService.confirmFile(reg.id)

      setUploadState({ fileName: file.name, fileSize: file.size, status: 'done' })

      if (user) {
        activityService.addActivity(project.id, {
          id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          type: 'upload',
          projectId: project.id,
          userId: user.id,
          message: `Arquivo enviado: ${file.name}`,
          timestamp: new Date().toISOString(),
        })
      }

      await loadFiles()
      setTimeout(() => setUploadState(null), 2000)
    } catch (err: any) {
      setUploadState({
        fileName: file.name,
        fileSize: file.size,
        status: 'error',
        error: projectFilesService.getErrorMessage(err) || 'Erro ao enviar arquivo',
      })
    }
  }

  const handleSetPrimary = async (fileId: string) => {
    try {
      await projectFilesService.setPrimaryFile(fileId)
    } catch {
      /* intentionally ignored */
    }
  }

  const handleRemove = async (fileId: string) => {
    try {
      await projectFilesService.removeFile(fileId)
    } catch {
      /* intentionally ignored */
    }
  }

  const getFileUrl = (record: any): string => {
    if (!record.file) return ''
    try {
      return pb.files.getUrl(record, record.file)
    } catch {
      return ''
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={(e) => {
          e.preventDefault()
          setDragging(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          handleUpload(Array.from(e.dataTransfer.files)[0])
        }}
        className={cn(
          'border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors',
          dragging ? 'border-blue-500 bg-blue-50/50' : 'border-slate-300 hover:border-slate-400',
        )}
      >
        <UploadCloud className="h-8 w-8 text-slate-400 mx-auto mb-2" />
        <p className="text-sm font-medium text-slate-700">Enviar arquivo PDF</p>
        <p className="text-xs text-slate-400 mt-1">Arraste ou clique (máx. 100 MB)</p>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) handleUpload(f)
            e.target.value = ''
          }}
        />
      </div>

      {uploadState && (
        <div className="bg-white border border-slate-200 rounded-lg p-3 flex items-center gap-3">
          <div className="p-2 bg-slate-100 rounded-lg shrink-0">
            <FileText className="h-5 w-5 text-slate-500" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-xs font-medium text-slate-800 truncate">
                {uploadState.fileName}
              </span>
              <span className="text-[11px] text-slate-400 shrink-0">
                {formatFileSize(uploadState.fileSize)}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              {(uploadState.status === 'preparing' ||
                uploadState.status === 'sending' ||
                uploadState.status === 'validating') && (
                <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
              )}
              {uploadState.status === 'done' && <Check className="h-3 w-3 text-green-500" />}
              {uploadState.status === 'error' && <AlertCircle className="h-3 w-3 text-red-500" />}
              <span
                className={cn('text-[11px] font-medium', {
                  'text-blue-600': ['preparing', 'sending', 'validating'].includes(
                    uploadState.status,
                  ),
                  'text-green-600': uploadState.status === 'done',
                  'text-red-600': uploadState.status === 'error',
                })}
              >
                {uploadState.status === 'preparing' && 'Preparando...'}
                {uploadState.status === 'sending' && 'Enviando...'}
                {uploadState.status === 'validating' && 'Validando...'}
                {uploadState.status === 'done' && 'Concluído'}
                {uploadState.status === 'error' && (uploadState.error || 'Erro')}
              </span>
            </div>
          </div>
          {uploadState.status === 'error' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setUploadState(null)}
              className="h-6 text-xs"
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
      )}

      {error ? (
        <div className="flex flex-col items-center py-12 text-center">
          <AlertCircle className="h-8 w-8 text-red-400 mb-2" />
          <p className="text-sm text-slate-500 mb-3">Erro ao carregar arquivos</p>
          <Button onClick={loadFiles} variant="outline" size="sm">
            Tentar novamente
          </Button>
        </div>
      ) : files.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center bg-white border border-slate-200 rounded-lg">
          <div className="p-3 bg-slate-100 rounded-full mb-3 text-slate-500">
            <Inbox className="h-8 w-8" />
          </div>
          <h3 className="text-base font-semibold text-slate-800 mb-1">Sem arquivos</h3>
          <p className="text-sm text-slate-500 max-w-sm">
            Nenhum arquivo foi enviado para este projeto. Use a área acima para enviar um PDF.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
          {files.map((file) => (
            <div key={file.id} className="flex items-center gap-3 p-3">
              <div className="p-2 bg-slate-100 rounded-lg shrink-0">
                <FileText className="h-5 w-5 text-slate-500" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-slate-800 truncate">
                    {file.original_name}
                  </span>
                  {file.is_primary && (
                    <span className="flex items-center gap-0.5 px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded text-[10px] font-medium shrink-0">
                      <Star className="h-2.5 w-2.5 fill-blue-600" /> Principal
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px] font-medium">
                    {file.extension}
                  </span>
                  <span className="text-[11px] text-slate-400">
                    {formatFileSize(file.size_bytes)}
                  </span>
                  <span
                    className={cn('text-[11px] font-medium', {
                      'text-green-600': file.status === 'ready_for_analysis',
                      'text-blue-600': ['pending', 'uploading', 'uploaded', 'validating'].includes(
                        file.status,
                      ),
                      'text-red-600': file.status === 'failed',
                    })}
                  >
                    {FILE_STATUS_LABELS[file.status] || file.status}
                  </span>
                  {file.error && file.status === 'failed' && (
                    <span className="text-[11px] text-red-400 truncate">— {file.error}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {file.file && file.status === 'ready_for_analysis' && (
                  <a href={getFileUrl(file)} target="_blank" rel="noopener noreferrer">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-slate-400 hover:text-slate-600"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                  </a>
                )}
                {!file.is_primary && file.status === 'ready_for_analysis' && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleSetPrimary(file.id)}
                    className="h-7 w-7 text-slate-400 hover:text-blue-600"
                    title="Definir como principal"
                  >
                    <Star className="h-3.5 w-3.5" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleRemove(file.id)}
                  className="h-7 w-7 text-slate-400 hover:text-red-500"
                  title="Remover"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
