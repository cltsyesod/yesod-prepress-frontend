import { useRef, useState } from 'react'
import { UploadCloud, X, Check, AlertCircle, FileText } from 'lucide-react'
import { cn, formatFileSize } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { WizardData, UploadedFile } from '@/types'
import { ACCEPTED_EXTENSIONS, MAX_FILE_SIZE } from '@/lib/wizard'

const BLOCKED_FORMATS = ['ai', 'eps', 'psd', 'cdr', 'tiff', 'jpg', 'png', 'jpeg']
const BLOCKED_MESSAGE =
  'Este formato será disponibilizado em uma próxima fase. Para a análise real atual, envie um arquivo PDF.'

interface StepArquivosProps {
  data: WizardData
  updateFiles: (updater: (prev: UploadedFile[]) => UploadedFile[]) => void
  errors: Record<string, string>
}

export function StepArquivos({ data, updateFiles, errors }: StepArquivosProps) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFilesAdded = (newFiles: File[]) => {
    const fileObjects: UploadedFile[] = newFiles.map((f) => {
      const ext = (f.name.split('.').pop() || '').toLowerCase()
      const isAccepted = ACCEPTED_EXTENSIONS.includes(ext)
      const isBlocked = BLOCKED_FORMATS.includes(ext)
      const tooLarge = f.size > MAX_FILE_SIZE
      const isEmpty = f.size === 0

      let status: UploadedFile['status'] = 'selected'
      if (!isAccepted || isBlocked) {
        status = 'unsupported'
      } else if (tooLarge) {
        status = 'too_large'
      } else if (isEmpty) {
        status = 'error'
      }

      return {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: f.name,
        extension: ext.toUpperCase(),
        size: f.size,
        status,
        progress: 0,
        rawFile: f,
      }
    })
    updateFiles((prev) => [...prev, ...fileObjects])
  }

  const removeFile = (id: string) => {
    updateFiles((prev) => prev.filter((f) => f.id !== id))
  }

  return (
    <div className="space-y-3">
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
          handleFilesAdded(Array.from(e.dataTransfer.files))
        }}
        className={cn(
          'border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors',
          dragging ? 'border-blue-500 bg-blue-50/50' : 'border-slate-300 hover:border-slate-400',
        )}
      >
        <UploadCloud className="h-10 w-10 text-slate-400 mx-auto mb-2" />
        <p className="text-sm font-medium text-slate-700">
          Arraste um arquivo PDF aqui ou clique para selecionar
        </p>
        <p className="text-xs text-slate-400 mt-1">Formato aceito: PDF (máx. 100 MB)</p>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,application/pdf"
          className="hidden"
          onChange={(e) => {
            handleFilesAdded(Array.from(e.target.files || []))
            e.target.value = ''
          }}
        />
      </div>

      {data.files.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
          {data.files.map((file) => (
            <div key={file.id} className="flex items-center gap-3 p-3">
              <div className="p-2 bg-slate-100 rounded-lg shrink-0">
                <FileText className="h-5 w-5 text-slate-500" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-xs font-medium text-slate-800 truncate">{file.name}</span>
                  <span className="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px] font-medium shrink-0">
                    {file.extension}
                  </span>
                  <span className="text-[11px] text-slate-400 shrink-0">
                    {formatFileSize(file.size)}
                  </span>
                </div>
                <span
                  className={cn('text-[11px] font-medium', {
                    'text-green-600': file.status === 'selected',
                    'text-red-600': ['error', 'unsupported', 'too_large'].includes(file.status),
                  })}
                >
                  {file.status === 'selected' && 'Arquivo selecionado'}
                  {file.status === 'unsupported' && BLOCKED_MESSAGE}
                  {file.status === 'too_large' && 'Arquivo muito grande (máx. 100 MB)'}
                  {file.status === 'error' && 'Arquivo vazio ou inválido'}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {file.status === 'selected' && <Check className="h-4 w-4 text-green-500" />}
                {['error', 'unsupported', 'too_large'].includes(file.status) && (
                  <AlertCircle className="h-4 w-4 text-red-500" />
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeFile(file.id)}
                  className="h-6 w-6 text-slate-400 hover:text-slate-600"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-slate-400">
        Nota: O upload real do arquivo será realizado na aba Arquivos após a criação do projeto.
      </p>
      {errors.files && <p className="text-xs text-red-500">{errors.files}</p>}
    </div>
  )
}
