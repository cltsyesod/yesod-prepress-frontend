import { CheckCircle, AlertCircle, RefreshCw, XCircle, Files } from 'lucide-react'
import type { ReportIndicators as Indicators } from '@/services/reportService'
import { cn } from '@/lib/utils'

interface Props {
  indicators: Indicators
  onIndicatorClick: (filter: string) => void
  activeFilter: string
}

export function ReportIndicators({ indicators, onIndicatorClick, activeFilter }: Props) {
  const items = [
    { key: 'all', label: 'Total', value: indicators.total, icon: Files, color: 'text-blue-400' },
    {
      key: 'Aprovado',
      label: 'Aprovados',
      value: indicators.approved,
      icon: CheckCircle,
      color: 'text-green-400',
    },
    {
      key: 'Aprovado com ressalvas',
      label: 'C/ Ressalvas',
      value: indicators.approvedWithReservations,
      icon: AlertCircle,
      color: 'text-amber-400',
    },
    {
      key: 'Requer revisão',
      label: 'Requer Revisão',
      value: indicators.requiresRevision,
      icon: RefreshCw,
      color: 'text-orange-400',
    },
    {
      key: 'Reprovado tecnicamente',
      label: 'Reprovados',
      value: indicators.technicallyRejected,
      icon: XCircle,
      color: 'text-red-400',
    },
  ]

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
      {items.map((item) => {
        const Icon = item.icon
        const active = activeFilter === item.key
        return (
          <button
            key={item.key}
            onClick={() => onIndicatorClick(active ? 'all' : item.key)}
            className={cn(
              'flex items-center gap-2 bg-[#182233] border rounded-lg p-3 transition-colors text-left',
              active
                ? 'border-blue-500/50 bg-blue-500/10'
                : 'border-[#2A374A] hover:border-[#3A475A]',
            )}
          >
            <Icon className={cn('h-5 w-5 shrink-0', item.color)} />
            <div className="min-w-0">
              <p className="text-2xl font-bold text-slate-100 tabular-nums leading-none">
                {item.value}
              </p>
              <p className="text-xs text-slate-300 truncate mt-1">{item.label}</p>
            </div>
          </button>
        )
      })}
    </div>
  )
}
