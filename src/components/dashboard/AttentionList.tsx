import { useNavigate } from 'react-router-dom'
import { AlertCircle } from 'lucide-react'
import { StatusBadge } from '@/components/Badges'
import { cn } from '@/lib/utils'
import type { Project } from '@/types'

interface Props {
  projects: Project[]
}

export function AttentionList({ projects }: Props) {
  const navigate = useNavigate()

  if (projects.length === 0) {
    return (
      <div className="bg-card border border-border rounded-lg p-4 text-center text-sm text-muted-foreground py-12">
        Nenhum projeto requer atenção no momento.
      </div>
    )
  }

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <h2 className="text-sm font-semibold text-card-foreground mb-3">Requerem Atenção</h2>
      <div className="space-y-2">
        {projects.map((p) => (
          <button
            key={p.id}
            onClick={() => navigate(`/projects/${p.id}`)}
            className="w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-md hover:bg-accent/50 transition-colors text-left border border-border/50"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <AlertCircle
                className={cn(
                  'h-4 w-4 shrink-0',
                  p.severity === 'critical' ? 'text-destructive' : 'text-amber-500',
                )}
              />
              <div className="min-w-0">
                <p className="text-sm font-medium text-card-foreground truncate">{p.name}</p>
                <p className="text-xs text-muted-foreground">
                  {p.clientName} · {p.orderNumber}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <StatusBadge status={p.status} />
              <span className="text-xs text-muted-foreground hidden sm:block">
                {new Date(p.deadline).toLocaleDateString('pt-BR')}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
