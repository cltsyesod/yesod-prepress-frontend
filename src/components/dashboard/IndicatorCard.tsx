import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface IndicatorCardProps {
  title: string
  value: number | string
  icon: LucideIcon
  onClick?: () => void
  accent?: boolean
}

export function IndicatorCard({ title, value, icon: Icon, onClick, accent }: IndicatorCardProps) {
  const className = cn(
    'bg-card border border-border rounded-lg p-4 flex flex-col gap-2 text-left',
    onClick && 'cursor-pointer hover:border-primary/50 transition-colors',
  )
  const inner = (
    <>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">{title}</span>
        <Icon className={cn('h-5 w-5', accent ? 'text-primary' : 'text-muted-foreground')} />
      </div>
      <span
        className={cn(
          'text-3xl font-bold tracking-tight',
          accent ? 'text-primary' : 'text-foreground',
        )}
      >
        {value}
      </span>
    </>
  )
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className}>
        {inner}
      </button>
    )
  }
  return <div className={className}>{inner}</div>
}
