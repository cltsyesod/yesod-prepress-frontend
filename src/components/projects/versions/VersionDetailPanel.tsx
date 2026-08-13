import { ArrowLeft, Star, CheckCircle2, FileText, AlertTriangle, Info, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatFileSize, formatDate } from '@/lib/utils'
import { VersionStatusBadge, VERSION_ORIGIN_LABELS } from './versionStatus'
import type { ProjectVersion } from '@/types'

interface VersionDetailPanelProps {
  version: ProjectVersion
  hasPrevious: boolean
  onBack: () => void
  onSetCurrent: () => void
}

function ProblemRow({
  icon: Icon,
  label,
  count,
  color,
}: {
  icon: typeof AlertTriangle
  label: string
  count: number
  color: string
}) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0">
      <div className="flex items-center gap-2">
        <Icon className={`h-3.5 w-3.5 ${color}`} />
        <span className="text-xs text-slate-600">{label}</span>
      </div>
      <span className="text-xs font-medium text-slate-800">{count}</span>
    </div>
  )
}

export function VersionDetailPanel({
  version: v,
  hasPrevious,
  onBack,
  onSetCurrent,
}: VersionDetailPanelProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="text-xs gap-1.5 h-8 text-slate-600"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Voltar
        </Button>
        {!v.isCurrent && (
          <Button
            onClick={onSetCurrent}
            size="sm"
            className="text-xs gap-1.5 h-8 bg-blue-600 hover:bg-blue-700 text-white"
          >
            <Star className="h-3.5 w-3.5" /> Definir como atual
          </Button>
        )}
      </div>
      <div className="bg-white border border-slate-200 rounded-lg p-4 mb-3">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-base font-semibold text-slate-800">Versão #{v.versionNumber}</span>
          {v.isCurrent && (
            <span className="flex items-center gap-0.5 px-2 py-0.5 bg-blue-50 text-blue-600 rounded text-[10px] font-medium">
              <Star className="h-2.5 w-2.5 fill-blue-600" /> Atual
            </span>
          )}
          <VersionStatusBadge status={v.status} />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <p className="text-[10px] text-slate-400 uppercase mb-0.5">Arquivo</p>
            <p className="text-xs text-slate-700 truncate">{v.fileName}</p>
          </div>
          <div>
            <p className="text-[10px] text-slate-400 uppercase mb-0.5">Formato</p>
            <p className="text-xs text-slate-700">{v.format}</p>
          </div>
          <div>
            <p className="text-[10px] text-slate-400 uppercase mb-0.5">Tamanho</p>
            <p className="text-xs text-slate-700">{formatFileSize(v.size)}</p>
          </div>
          <div>
            <p className="text-[10px] text-slate-400 uppercase mb-0.5">Data</p>
            <p className="text-xs text-slate-700">{formatDate(v.createdAt)}</p>
          </div>
          <div>
            <p className="text-[10px] text-slate-400 uppercase mb-0.5">Responsável</p>
            <p className="text-xs text-slate-700">{v.responsibleName}</p>
          </div>
          <div>
            <p className="text-[10px] text-slate-400 uppercase mb-0.5">Origem</p>
            <p className="text-xs text-slate-700">{VERSION_ORIGIN_LABELS[v.origin]}</p>
          </div>
        </div>
        {v.comment && (
          <div className="mt-3 pt-3 border-t border-slate-100">
            <p className="text-[10px] text-slate-400 uppercase mb-1">Comentário</p>
            <p className="text-xs text-slate-600">{v.comment}</p>
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <h4 className="text-xs font-semibold text-slate-700 mb-2 flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5" /> Resumo da Análise
          </h4>
          <ProblemRow
            icon={AlertTriangle}
            label="Críticos"
            count={v.problemSummary.critical}
            color="text-red-500"
          />
          <ProblemRow
            icon={AlertTriangle}
            label="Atenção"
            count={v.problemSummary.warning}
            color="text-amber-500"
          />
          <ProblemRow
            icon={Info}
            label="Informativos"
            count={v.problemSummary.info}
            color="text-blue-500"
          />
          <ProblemRow
            icon={CheckCircle2}
            label="Correções aprovadas"
            count={v.problemSummary.approved}
            color="text-green-500"
          />
          <ProblemRow
            icon={Clock}
            label="Pendentes"
            count={v.problemSummary.pending}
            color="text-slate-400"
          />
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <h4 className="text-xs font-semibold text-slate-700 mb-2">
            Alterações {hasPrevious ? 'da versão anterior' : ''}
          </h4>
          {v.changes.length > 0 ? (
            <ul className="space-y-1.5">
              {v.changes.map((c, i) => (
                <li key={i} className="text-xs text-slate-600 flex items-start gap-1.5">
                  <span className="text-blue-500 mt-0.5">•</span> {c}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-slate-400">
              Esta é a versão inicial, sem alterações anteriores.
            </p>
          )}
          <div className="mt-3 pt-3 border-t border-slate-100">
            <h4 className="text-xs font-semibold text-slate-700 mb-2">Histórico</h4>
            <div className="space-y-1.5">
              {v.history.map((h) => (
                <div key={h.id} className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-slate-300 mt-1.5 shrink-0" />
                  <div>
                    <p className="text-[11px] text-slate-600">{h.note}</p>
                    <p className="text-[10px] text-slate-400">
                      {formatDate(h.timestamp)} ·{' '}
                      {new Date(h.timestamp).toLocaleTimeString('pt-BR', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
