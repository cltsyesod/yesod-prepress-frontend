import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { JobTicket } from '@/services/jobsService'
import type { ProductionProfile } from '@/types'

interface JobTicketFieldsProps {
  ticket: JobTicket
  onChange: (ticket: JobTicket) => void
  profiles: ProductionProfile[]
  profileId: string
  onProfileChange: (id: string) => void
}

const numberOrUndefined = (value: string) => {
  const n = Number(value.replace(',', '.'))
  return value.trim() === '' || !Number.isFinite(n) ? undefined : n
}

/** Parâmetros do pedido. Campos vazios usam o valor do perfil de produção. */
export function JobTicketFields({
  ticket,
  onChange,
  profiles,
  profileId,
  onProfileChange,
}: JobTicketFieldsProps) {
  const profile = profiles.find((p) => p.id === profileId)
  const set = (patch: Partial<JobTicket>) => onChange({ ...ticket, ...patch })

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div className="space-y-1.5 sm:col-span-2">
        <Label>Perfil de produção</Label>
        <Select value={profileId} onValueChange={onProfileChange}>
          <SelectTrigger>
            <SelectValue placeholder="Escolha um perfil" />
          </SelectTrigger>
          <SelectContent>
            {profiles.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5 sm:col-span-2">
        <Label>Medida final (L × A, mm)</Label>
        <div className="flex items-center gap-2">
          <Input
            inputMode="decimal"
            placeholder="Largura"
            value={ticket.finalWidthMm ?? ''}
            onChange={(e) => set({ finalWidthMm: numberOrUndefined(e.target.value) })}
          />
          <span className="text-muted-foreground">×</span>
          <Input
            inputMode="decimal"
            placeholder="Altura"
            value={ticket.finalHeightMm ?? ''}
            onChange={(e) => set({ finalHeightMm: numberOrUndefined(e.target.value) })}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Escala do arquivo</Label>
        <Input
          placeholder={profile?.scale || '1:1'}
          value={ticket.fileScale ?? ''}
          onChange={(e) => set({ fileScale: e.target.value || undefined })}
        />
      </div>

      <div className="space-y-1.5">
        <Label>Resolução mínima (ppi final)</Label>
        <Input
          inputMode="numeric"
          placeholder={profile?.minResolution ? String(profile.minResolution) : '300'}
          value={ticket.minResolution ?? ''}
          onChange={(e) => set({ minResolution: numberOrUndefined(e.target.value) })}
        />
      </div>

      <div className="space-y-1.5">
        <Label>Sangria mínima (mm)</Label>
        <Input
          inputMode="decimal"
          placeholder={profile?.minBleed !== undefined ? String(profile.minBleed) : '3'}
          value={ticket.minBleed ?? ''}
          onChange={(e) => set({ minBleed: numberOrUndefined(e.target.value) })}
        />
      </div>

      <div className="space-y-1.5">
        <Label>Faca obrigatória</Label>
        <div className="flex h-10 items-center gap-2">
          <Switch
            checked={ticket.cutLayerRequired ?? profile?.cutLayerRequired ?? false}
            onCheckedChange={(checked) => set({ cutLayerRequired: checked })}
          />
          <span className="text-sm text-muted-foreground">
            {(ticket.cutLayerRequired ?? profile?.cutLayerRequired) ? 'Sim' : 'Não'}
          </span>
        </div>
      </div>

      <div className="space-y-1.5 sm:col-span-2 lg:col-span-4">
        <div className="flex items-center gap-2">
          <Switch
            checked={(ticket.rgbPolicy ?? 'managed') === 'managed'}
            onCheckedChange={(checked) => set({ rgbPolicy: checked ? 'managed' : 'cmyk_only' })}
          />
          <Label className="font-normal">
            {(ticket.rgbPolicy ?? 'managed') === 'managed'
              ? 'O RIP converte o RGB: apontar só RGB sem perfil ICC'
              : 'Exigir CMYK: apontar todo conteúdo RGB'}
          </Label>
        </div>
      </div>
    </div>
  )
}
