import { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description?: string
  actionLabel?: string
  onAction?: () => void
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center bg-card border border-border rounded-lg">
      <div className="p-3 bg-muted rounded-full mb-3 text-muted-foreground">
        <Icon className="h-8 w-8" />
      </div>
      <h3 className="text-base font-semibold text-card-foreground mb-1">{title}</h3>
      {description && <p className="text-sm text-muted-foreground max-w-sm mb-4">{description}</p>}
      {actionLabel && onAction && (
        <Button
          onClick={onAction}
          className="navy-gradient text-white font-medium text-sm transition-all hover:brightness-125"
        >
          {actionLabel}
        </Button>
      )}
    </div>
  )
}
