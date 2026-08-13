import { cn } from '@/lib/utils'
import type { VersionStatus, VersionOrigin } from '@/types'

export const VERSION_STATUS_CONFIG: Record<VersionStatus, { label: string; className: string }> = {
  em_analise: { label: 'Em análise', className: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  requer_revisao: {
    label: 'Requer revisão',
    className: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  },
  aguardando_aprovacao: {
    label: 'Aguardando aprovação',
    className: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  },
  aprovada: { label: 'Aprovada', className: 'bg-green-500/15 text-green-400 border-green-500/30' },
  substituida: {
    label: 'Substituída',
    className: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
  },
}

export const VERSION_ORIGIN_LABELS: Record<VersionOrigin, string> = {
  cliente: 'Cliente',
  interno: 'Interno',
  revisao: 'Revisão',
}

export function VersionStatusBadge({ status }: { status: VersionStatus }) {
  const config = VERSION_STATUS_CONFIG[status]
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border whitespace-nowrap',
        config.className,
      )}
    >
      {config.label}
    </span>
  )
}
