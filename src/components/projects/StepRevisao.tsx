import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Pencil } from 'lucide-react'
import { WIZARD_PROFILES, MOCK_USERS } from '@/services/mockData'
import { formatDate, formatFileSize } from '@/lib/utils'
import type { WizardData, Client } from '@/types'

interface StepRevisaoProps {
  data: WizardData
  clients: Client[]
  onEdit: (step: number) => void
}

function ReviewSection({
  title,
  onEdit,
  children,
}: {
  title: string
  onEdit: () => void
  children: ReactNode
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={onEdit}
          className="text-xs text-blue-600 hover:text-blue-700"
        >
          <Pencil className="h-3 w-3 mr-1" /> Editar
        </Button>
      </div>
      {children}
    </div>
  )
}

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex justify-between gap-2 text-xs py-0.5">
      <span className="text-slate-400 shrink-0">{label}:</span>
      <span className="text-slate-700 text-right">{value || '—'}</span>
    </div>
  )
}

export function StepRevisao({ data, clients, onEdit }: StepRevisaoProps) {
  const client = clients.find((c) => c.id === data.clientId)
  const user = MOCK_USERS.find((u) => u.id === data.responsibleId)
  const profile = WIZARD_PROFILES.find((p) => p.id === data.productionProfileId)
  const completedFiles = data.files.filter((f) => f.status === 'completed' || f.status === 'selected')
  const profileName = profile?.isCustom ? data.customProfileName : profile?.name

  return (
    <div className="space-y-3">
      <ReviewSection title="Informações do Projeto" onEdit={() => onEdit(1)}>
        <div className="space-y-0.5">
          <Field label="Nome" value={data.name} />
          <Field label="Cliente" value={client?.name} />
          <Field label="Número do pedido" value={data.orderNumber} />
          <Field label="Responsável" value={user?.name} />
          <Field
            label="Prazo"
            value={data.deadline ? formatDate(new Date(data.deadline).toISOString()) : ''}
          />
          <Field label="Descrição" value={data.description} />
          <Field label="Observações" value={data.observations} />
          <div className="flex justify-between gap-2 text-xs py-0.5">
            <span className="text-slate-400 shrink-0">Tags:</span>
            <div className="flex flex-wrap gap-1 justify-end">
              {data.tags.length > 0 ? (
                data.tags.map((t) => (
                  <span
                    key={t}
                    className="px-1.5 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded text-[10px]"
                  >
                    {t}
                  </span>
                ))
              ) : (
                <span className="text-slate-700">—</span>
              )}
            </div>
          </div>
        </div>
      </ReviewSection>

      <ReviewSection title="Perfil de Produção" onEdit={() => onEdit(2)}>
        {profile ? (
          <div className="space-y-0.5">
            <Field label="Perfil" value={profileName} />
            {!profile.isCustom && (
              <>
                <Field label="Cor esperada" value={profile.corEsperada} />
                <Field label="Resolução mínima" value={profile.resolucaoMinima} />
                <Field label="Sangria" value={profile.sangria} />
                <Field label="Escala" value={profile.escala} />
                <Field label="Layer de corte" value={profile.layerCorte} />
              </>
            )}
          </div>
        ) : (
          <p className="text-xs text-slate-400">Nenhum perfil selecionado</p>
        )}
      </ReviewSection>

      <ReviewSection title="Arquivos" onEdit={() => onEdit(3)}>
        {completedFiles.length > 0 ? (
          <div className="space-y-1">
            {completedFiles.map((f) => (
              <div key={f.id} className="flex items-center justify-between text-xs">
                <span className="text-slate-700">{f.name}</span>
                <span className="text-slate-400">{formatFileSize(f.size)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-400">Nenhum arquivo enviado</p>
        )}
      </ReviewSection>
    </div>
  )
}
