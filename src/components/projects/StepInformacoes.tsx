import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { TagInput } from '@/components/projects/TagInput'
import { cn } from '@/lib/utils'
import { PlusCircle } from 'lucide-react'
import type { WizardData, Client } from '@/types'
import { MOCK_USERS } from '@/services/mockData'

interface StepInformacoesProps {
  data: WizardData
  updateData: (updates: Partial<WizardData>) => void
  clients: Client[]
  onNewClient: () => void
  errors: Record<string, string>
}

export function StepInformacoes({
  data,
  updateData,
  clients,
  onNewClient,
  errors,
}: StepInformacoesProps) {
  const today = new Date().toISOString().split('T')[0]

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
      <div className="space-y-1">
        <Label className="text-xs font-medium text-slate-700">Nome do projeto *</Label>
        <Input
          value={data.name}
          onChange={(e) => updateData({ name: e.target.value })}
          placeholder="Ex: Catálogo Coleção Verão"
          className={cn('text-sm bg-slate-50/50', errors.name && 'border-red-500')}
        />
        {errors.name && <p className="text-xs text-red-500">{errors.name}</p>}
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label className="text-xs font-medium text-slate-700">Cliente *</Label>
          <Select value={data.clientId} onValueChange={(v) => updateData({ clientId: v })}>
            <SelectTrigger className={cn('text-sm', errors.clientId && 'border-red-500')}>
              <SelectValue placeholder="Selecione um cliente" />
            </SelectTrigger>
            <SelectContent>
              {clients.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.clientId && <p className="text-xs text-red-500">{errors.clientId}</p>}
          <button
            type="button"
            onClick={onNewClient}
            className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1 mt-1"
          >
            <PlusCircle className="h-3 w-3" /> Criar novo cliente
          </button>
        </div>

        <div className="space-y-1">
          <Label className="text-xs font-medium text-slate-700">Número do pedido</Label>
          <Input
            value={data.orderNumber}
            onChange={(e) => updateData({ orderNumber: e.target.value })}
            placeholder="Ex: PED-2025-00123"
            className="text-sm bg-slate-50/50"
          />
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label className="text-xs font-medium text-slate-700">Responsável *</Label>
          <Select
            value={data.responsibleId}
            onValueChange={(v) => updateData({ responsibleId: v })}
          >
            <SelectTrigger className={cn('text-sm', errors.responsibleId && 'border-red-500')}>
              <SelectValue placeholder="Selecione um responsável" />
            </SelectTrigger>
            <SelectContent>
              {MOCK_USERS.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.responsibleId && <p className="text-xs text-red-500">{errors.responsibleId}</p>}
        </div>

        <div className="space-y-1">
          <Label className="text-xs font-medium text-slate-700">Prazo *</Label>
          <Input
            type="date"
            value={data.deadline}
            min={today}
            onChange={(e) => updateData({ deadline: e.target.value })}
            className={cn('text-sm bg-slate-50/50', errors.deadline && 'border-red-500')}
          />
          {errors.deadline && <p className="text-xs text-red-500">{errors.deadline}</p>}
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-xs font-medium text-slate-700">Descrição</Label>
        <Textarea
          value={data.description}
          onChange={(e) => updateData({ description: e.target.value })}
          placeholder="Descreva o projeto..."
          rows={3}
          className="text-sm bg-slate-50/50"
        />
      </div>

      <div className="space-y-1">
        <Label className="text-xs font-medium text-slate-700">Observações</Label>
        <Textarea
          value={data.observations}
          onChange={(e) => updateData({ observations: e.target.value })}
          placeholder="Observações internas..."
          rows={2}
          className="text-sm bg-slate-50/50"
        />
      </div>

      <div className="space-y-1">
        <Label className="text-xs font-medium text-slate-700">Tags</Label>
        <TagInput
          tags={data.tags}
          onChange={(tags) => updateData({ tags })}
          placeholder="Digite uma tag e pressione Enter"
        />
      </div>
    </div>
  )
}
