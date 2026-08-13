import { useMemo } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { Check } from 'lucide-react'
import { profileService } from '@/services/profileService'
import type { WizardData, ProductionProfile } from '@/types'

interface StepProducaoProps {
  data: WizardData
  updateData: (updates: Partial<WizardData>) => void
  errors: Record<string, string>
}

function ProfileCard({
  profile,
  selected,
  onSelect,
}: {
  profile: ProductionProfile
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'text-left p-3 border-2 rounded-lg transition-all w-full',
        selected
          ? 'border-blue-500 bg-blue-50/50'
          : 'border-slate-200 hover:border-slate-300 bg-white',
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-slate-800">{profile.name}</span>
        {selected && <Check className="h-4 w-4 text-blue-600" />}
      </div>
      {profile.category !== 'Personalizado' && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
          <div>
            <span className="text-slate-400">Cor:</span>{' '}
            <span className="text-slate-600">{profile.colorMode}</span>
          </div>
          <div>
            <span className="text-slate-400">Resolução:</span>{' '}
            <span className="text-slate-600">{profile.minResolution} dpi</span>
          </div>
          <div>
            <span className="text-slate-400">Sangria:</span>{' '}
            <span className="text-slate-600">{profile.minBleed} mm</span>
          </div>
          <div>
            <span className="text-slate-400">Escala:</span>{' '}
            <span className="text-slate-600">{profile.scale}</span>
          </div>
          <div>
            <span className="text-slate-400">Layer corte:</span>{' '}
            <span className="text-slate-600">{profile.cutLayerRequired ? 'Sim' : 'Não'}</span>
          </div>
        </div>
      )}
    </button>
  )
}

export function StepProducao({ data, updateData, errors }: StepProducaoProps) {
  const profiles = useMemo(
    () => profileService.getProfilesSync().filter((p) => p.status === 'active'),
    [],
  )
  const selectedProfile = profiles.find((p) => p.id === data.productionProfileId)
  const isCustom = selectedProfile?.category === 'Personalizado'

  if (profiles.length === 0) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-3">
        {profiles.map((profile) => (
          <ProfileCard
            key={profile.id}
            profile={profile}
            selected={data.productionProfileId === profile.id}
            onSelect={() => updateData({ productionProfileId: profile.id })}
          />
        ))}
      </div>

      {isCustom && (
        <div className="space-y-1">
          <Label className="text-xs font-medium text-slate-700">
            Nome do perfil personalizado *
          </Label>
          <Input
            value={data.customProfileName}
            onChange={(e) => updateData({ customProfileName: e.target.value })}
            placeholder="Ex: Perfil especial para cliente X"
            className={cn('text-sm bg-slate-50/50', errors.customProfileName && 'border-red-500')}
          />
          {errors.customProfileName && (
            <p className="text-xs text-red-500">{errors.customProfileName}</p>
          )}
        </div>
      )}

      {errors.productionProfileId && (
        <p className="text-xs text-red-500">{errors.productionProfileId}</p>
      )}
    </div>
  )
}
