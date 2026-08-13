import { useMemo } from 'react'
import { Progress } from '@/components/ui/progress'
import { SeverityBadge } from '@/components/Badges'
import { formatDate } from '@/lib/utils'
import { Circle } from 'lucide-react'
import { profileService } from '@/services/profileService'
import type { Project } from '@/types'

const STATUS_PROGRESS: Record<string, number> = {
  draft: 10,
  pending_analysis: 25,
  analyzing: 50,
  needs_review: 55,
  failed: 50,
  pending_approval: 75,
  approved: 90,
  completed: 100,
  active: 40,
  paused: 40,
  archived: 100,
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Rascunho',
  pending_analysis: 'Aguardando Análise',
  analyzing: 'Analisando',
  needs_review: 'Requer Revisão',
  failed: 'Falhou',
  pending_approval: 'Aguardando Aprovação',
  approved: 'Aprovado',
  completed: 'Concluído',
  active: 'Ativo',
  paused: 'Pausado',
  archived: 'Arquivado',
}

function getNextSteps(status: string): string[] {
  switch (status) {
    case 'draft':
      return [
        'Completar configuração do projeto',
        'Selecionar perfil de produção',
        'Enviar arquivos para análise',
      ]
    case 'pending_analysis':
      return ['Iniciar análise técnica', 'Verificar conformidade dos arquivos']
    case 'analyzing':
      return ['Aguardar conclusão da análise automática']
    case 'needs_review':
      return [
        'Revisar problemas encontrados',
        'Solicitar correções ao cliente',
        'Reenviar arquivo corrigido',
      ]
    case 'pending_approval':
      return ['Aguardar aprovação do cliente', 'Comunicar cliente sobre o prazo']
    case 'approved':
      return ['Enviar para produção', 'Gerar relatório final']
    case 'completed':
      return ['Arquivar projeto', 'Avaliar qualidade do processo']
    case 'failed':
      return ['Corrigir problemas identificados', 'Reenviar arquivo corrigido']
    default:
      return ['Acompanhar andamento do projeto']
  }
}

interface OverviewTabProps {
  project: Project
  analysisSummary?: string
}

export function OverviewTab({ project, analysisSummary }: OverviewTabProps) {
  const progress = STATUS_PROGRESS[project.status] ?? 30
  const nextSteps = getNextSteps(project.status)
  const profileName = useMemo(() => {
    const profiles = profileService.getProfilesSync()
    return profiles.find((p) => p.id === project.profileId)?.name || project.productionProfile
  }, [project.profileId, project.productionProfile])

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-slate-800">Progresso do Projeto</h3>
          <span className="text-xs font-medium text-slate-500">
            {STATUS_LABELS[project.status] || project.status}
          </span>
        </div>
        <Progress value={progress} className="h-2" />
        <p className="text-[11px] text-slate-400 mt-1.5">{progress}% concluído</p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-slate-800 mb-3">Informações do Projeto</h3>
          <dl className="space-y-2 text-xs">
            <div>
              <dt className="text-slate-400 inline">Descrição: </dt>
              <dd className="text-slate-700 inline">{project.description || '—'}</dd>
            </div>
            <div>
              <dt className="text-slate-400 inline">Perfil de produção: </dt>
              <dd className="text-slate-700 inline">{profileName}</dd>
            </div>
            <div>
              <dt className="text-slate-400 inline">Tipo de produção: </dt>
              <dd className="text-slate-700 inline">{project.productionType}</dd>
            </div>
            <div>
              <dt className="text-slate-400 inline">Criado em: </dt>
              <dd className="text-slate-700 inline">{formatDate(project.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-slate-400 inline">Prazo: </dt>
              <dd className="text-slate-700 inline">{formatDate(project.deadline)}</dd>
            </div>
            {project.observations && (
              <div>
                <dt className="text-slate-400 inline">Observações: </dt>
                <dd className="text-slate-700 inline">{project.observations}</dd>
              </div>
            )}
            {project.tags && project.tags.length > 0 && (
              <div className="flex items-center gap-1 flex-wrap pt-1">
                {project.tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px]"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </dl>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-slate-800 mb-3">Resumo da Análise</h3>
          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Problemas encontrados</span>
              <span className="font-medium text-slate-700">{project.issueCount}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Criticidade</span>
              <SeverityBadge severity={project.severity} />
            </div>
            <p className="text-slate-600 pt-1">{analysisSummary || 'Análise não executada.'}</p>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-slate-800 mb-3">Próximos Passos</h3>
        <div className="space-y-2">
          {nextSteps.map((step, i) => (
            <div key={i} className="flex items-center gap-2 text-xs text-slate-600">
              <Circle className="h-3.5 w-3.5 text-slate-300 shrink-0" />
              {step}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
