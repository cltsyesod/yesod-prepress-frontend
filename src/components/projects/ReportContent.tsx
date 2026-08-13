import { type ReactNode } from 'react'
import { StatusBadge, SeverityBadge } from '@/components/Badges'
import { formatDate, formatFileSize } from '@/lib/utils'
import type { Project, AnalysisProblem, ProjectVersion, ActivityEvent } from '@/types'
import type { ProjectClassification } from '@/services/reportService'

const CLASSIFICATION_STYLES: Record<ProjectClassification, string> = {
  Aprovado: 'bg-green-500/15 text-green-400 border-green-500/30',
  'Aprovado com ressalvas': 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  'Requer revisão': 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  'Reprovado tecnicamente': 'bg-red-500/15 text-red-400 border-red-500/30',
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendente',
  approved: 'Aprovado',
  rejected: 'Rejeitado',
  ignored: 'Ignorado',
}

const CONCLUSION_TEXT: Record<ProjectClassification, string> = {
  Aprovado:
    'O projeto foi aprovado tecnicamente. Todos os problemas foram resolvidos ou não há problemas pendentes.',
  'Aprovado com ressalvas':
    'O projeto foi aprovado com ressalvas. Existem justificativas registradas ou problemas pendentes não críticos.',
  'Requer revisão':
    'O projeto requer revisão. Existem problemas rejeitados ou ignorados que precisam de atenção.',
  'Reprovado tecnicamente':
    'O projeto foi reprovado tecnicamente. Existem problemas críticos não resolvidos que impedem o prosseguimento.',
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="report-section bg-[#182233] border border-[#2A374A] rounded-lg p-4">
      <h3 className="text-sm font-semibold text-slate-200 mb-3">{title}</h3>
      {children}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <dt className="text-slate-400 shrink-0">{label}:</dt>
      <dd className="text-slate-200 font-medium truncate">{value || '—'}</dd>
    </div>
  )
}

function StatBox({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="border border-[#2A374A] rounded p-2.5">
      <p className="text-[11px] text-slate-400">{label}</p>
      <p className={`text-lg font-semibold ${color || 'text-slate-200'}`}>{value}</p>
    </div>
  )
}

interface ReportContentProps {
  project: Project
  problems: AnalysisProblem[]
  currentVersion?: ProjectVersion
  activities: ActivityEvent[]
  classification: ProjectClassification
}

export function ReportContent({
  project,
  problems,
  currentVersion,
  activities,
  classification,
}: ReportContentProps) {
  const sev = {
    critical: problems.filter((p) => p.severity === 'critical').length,
    warning: problems.filter((p) => p.severity === 'warning').length,
    info: problems.filter((p) => p.severity === 'info').length,
  }
  const st = {
    approved: problems.filter((p) => p.status === 'approved').length,
    rejected: problems.filter((p) => p.status === 'rejected').length,
    ignored: problems.filter((p) => p.status === 'ignored').length,
    pending: problems.filter((p) => p.status === 'pending').length,
  }
  const cls = CLASSIFICATION_STYLES[classification]
  const analysisDate = activities.find((a) => a.type === 'analysis')?.timestamp || project.updatedAt

  return (
    <div className="report-printable space-y-4">
      <Section title="Classificação Técnica">
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium border ${cls}`}
          >
            {classification}
          </span>
          <span className="text-xs text-slate-400">
            {problems.length === 0
              ? 'Arquivo analisado sem problemas técnicos.'
              : `${problems.length} problema(s) encontrado(s).`}
          </span>
        </div>
      </Section>

      <Section title="Informações do Projeto">
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-xs">
          <InfoRow label="Nome da empresa" value={project.clientName} />
          <InfoRow label="Cliente" value={project.clientName} />
          <InfoRow label="Nome do projeto" value={project.name} />
          <InfoRow label="Número do pedido" value={project.orderNumber} />
          <InfoRow label="Responsável" value={project.responsibleName} />
          <InfoRow label="Perfil de produção" value={project.productionProfile} />
          <InfoRow
            label="Arquivo e versão atual"
            value={
              currentVersion
                ? `${currentVersion.fileName} (v${currentVersion.versionNumber})`
                : project.filename
            }
          />
          <InfoRow label="Data da análise" value={formatDate(analysisDate)} />
          <div className="flex items-center gap-1.5">
            <dt className="text-slate-400 shrink-0">Status geral:</dt>
            <dd>
              <StatusBadge status={project.status} />
            </dd>
          </div>
        </dl>
      </Section>

      <Section title="Resumo da Análise">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-3">
          <StatBox label="Encontrados" value={problems.length} />
          <StatBox label="Aprovados" value={st.approved} color="text-green-400" />
          <StatBox label="Rejeitados" value={st.rejected} color="text-red-400" />
          <StatBox label="Ignorados" value={st.ignored} color="text-slate-400" />
          <StatBox label="Pendentes" value={st.pending} color="text-amber-400" />
        </div>
        <div className="flex flex-wrap gap-4 text-xs">
          <span className="text-red-400">Críticos: {sev.critical}</span>
          <span className="text-amber-400">Atenção: {sev.warning}</span>
          <span className="text-blue-400">Informativo: {sev.info}</span>
        </div>
      </Section>

      <Section title="Problemas Encontrados">
        {problems.length === 0 ? (
          <p className="text-xs text-slate-400">Nenhum problema encontrado.</p>
        ) : (
          <div className="space-y-2">
            {problems.map((p) => (
              <div key={p.id} className="border border-[#2A374A] rounded p-3 text-xs">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-slate-200">{p.name}</span>
                  <div className="flex items-center gap-2">
                    <SeverityBadge severity={p.severity} />
                    <span className="text-slate-400">{STATUS_LABELS[p.status] || p.status}</span>
                  </div>
                </div>
                <p className="text-slate-400">{p.description}</p>
                {p.justification && (
                  <p className="text-slate-500 mt-1 italic">Justificativa: {p.justification}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      {currentVersion && (
        <Section title="Versão Atual">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-xs">
            <InfoRow label="Arquivo" value={currentVersion.fileName} />
            <InfoRow label="Versão" value={`#${currentVersion.versionNumber}`} />
            <InfoRow label="Formato" value={currentVersion.format} />
            <InfoRow label="Tamanho" value={formatFileSize(currentVersion.size)} />
            <InfoRow label="Responsável" value={currentVersion.responsibleName} />
            <InfoRow label="Comentário" value={currentVersion.comment} />
          </dl>
        </Section>
      )}

      {(project.observations || problems.some((p) => p.justification)) && (
        <Section title="Observações e Justificativas">
          {project.observations && (
            <p className="text-xs text-slate-400 mb-2">{project.observations}</p>
          )}
          {problems
            .filter((p) => p.justification)
            .map((p) => (
              <p key={p.id} className="text-xs text-slate-500 italic mb-1">
                {p.name}: {p.justification}
              </p>
            ))}
        </Section>
      )}

      <Section title="Histórico Resumido">
        <div className="space-y-1.5">
          {activities.slice(0, 10).map((a) => (
            <div key={a.id} className="flex items-start gap-2 text-xs">
              <span className="text-slate-500 shrink-0 w-20">{formatDate(a.timestamp)}</span>
              <span className="text-slate-300">{a.message}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Conclusão Técnica">
        <p className="text-xs text-slate-300">{CONCLUSION_TEXT[classification]}</p>
      </Section>
    </div>
  )
}
