import { useNavigate } from 'react-router-dom'
import { Upload, FileSearch, MessageSquare, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ActivityWithProject } from '@/services/dashboardService'

interface Props {
  activities: ActivityWithProject[]
}

const EVENT_ICONS: Record<string, { icon: typeof Upload; color: string }> = {
  upload: { icon: Upload, color: 'text-primary' },
  analysis: { icon: FileSearch, color: 'text-purple-500' },
  comment: { icon: MessageSquare, color: 'text-muted-foreground' },
  status_change: { icon: RefreshCw, color: 'text-amber-500' },
}

function formatTs(ts: string): string {
  return new Date(ts).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function ActivitiesFeed({ activities }: Props) {
  const navigate = useNavigate()

  if (activities.length === 0) {
    return (
      <div className="bg-card border border-border rounded-lg p-4 text-center text-sm text-muted-foreground py-12">
        Sem atividades recentes.
      </div>
    )
  }

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <h2 className="text-sm font-semibold text-card-foreground mb-3">Atividades Recentes</h2>
      <div className="space-y-2.5 max-h-[420px] overflow-y-auto pr-1">
        {activities.map((event) => {
          const config = EVENT_ICONS[event.type] || EVENT_ICONS.status_change
          const Icon = config.icon
          return (
            <button
              key={event.id}
              onClick={() => navigate(`/projects/${event.projectId}`)}
              className="w-full flex items-start gap-2.5 text-left hover:bg-accent/50 rounded-md p-2 -m-2 transition-colors"
            >
              <Icon className={cn('h-4 w-4 shrink-0 mt-0.5', config.color)} />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-muted-foreground leading-snug">{event.message}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {event.projectName} · {formatTs(event.timestamp)}
                </p>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
