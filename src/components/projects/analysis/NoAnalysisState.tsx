import { Loader2, FileSearch, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Project } from '@/types'
import type { ProjectFileRecord } from '@/services/projectFilesService'

interface NoAnalysisStateProps {
  file: ProjectFileRecord
  project: Project
  starting: boolean
  disabled?: boolean
  disabledReason?: string
  onStart: () => void
}

export function NoAnalysisState({
  file,
  project,
  starting,
  disabled,
  disabledReason,
  onStart,
}: NoAnalysisStateProps) {
  const fileReady = file.status === 'ready_for_analysis'

  if (!fileReady) {
    return (
      <div className="flex flex-col items-center justify-center py-16 bg-card border border-border rounded-lg">
        <Clock className="h-10 w-10 text-amber-500 mb-2" />
        <h3 className="text-sm font-semibold text-foreground">Arquivo não está pronto</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Status atual: {file.status}. Aguarde a validação do arquivo.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center py-16 bg-card border border-border rounded-lg">
      <FileSearch className="h-10 w-10 text-blue-500 mb-2" />
      <h3 className="text-sm font-semibold text-foreground">Nenhuma análise iniciada</h3>
      <div className="text-xs text-muted-foreground mt-1 mb-4 text-center max-w-sm">
        <p>
          Arquivo: <span className="font-medium text-foreground">{file.original_name}</span>
        </p>
        <p>
          Status: <span className="font-medium text-green-600">Pronto para análise</span>
        </p>
        <p>
          Perfil de produção:{' '}
          <span className="font-medium text-foreground">
            {project.productionProfile || 'Não definido'}
          </span>
        </p>
      </div>
      <Button onClick={onStart} disabled={starting || disabled}>
        {starting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
        {starting ? 'Iniciando...' : 'Iniciar análise real'}
      </Button>
      {disabledReason && !starting && <p className="text-xs text-red-500 mt-2">{disabledReason}</p>}
    </div>
  )
}
