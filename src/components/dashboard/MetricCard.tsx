import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface MetricCardProps {
  title: string
  value: number | string
  context: string
  icon: LucideIcon
  link: string
  linkLabel: string
  accent?: boolean
}

export function MetricCard({
  title,
  value,
  context,
  icon: Icon,
  link,
  linkLabel,
  accent,
}: MetricCardProps) {
  return (
    <div className="bg-card border border-border rounded-lg p-4 flex flex-col gap-2">
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
      <span className="text-xs text-muted-foreground leading-tight">{context}</span>
      <Link
        to={link}
        className="text-xs font-medium text-primary hover:text-primary/80 inline-flex items-center gap-0.5 mt-auto"
      >
        {linkLabel}
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  )
}
