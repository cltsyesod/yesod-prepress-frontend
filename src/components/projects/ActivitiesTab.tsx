import { useEffect, useState } from 'react'
import { Upload, FileSearch, MessageSquare, RefreshCw, Inbox } from 'lucide-react'
import { activityService } from '@/services/activityService'
import type { Project, ActivityEvent } from '@/types'

interface ActivitiesTabProps {
  project: Project
}

const EVENT_ICONS: Record<string, { icon: typeof Upload; color: string }> = {
  upload: { icon: Upload, color: 'text-blue-500 bg-blue-50' },
  analysis: { icon: FileSearch, color: 'text-purple-500 bg-purple-50' },
  comment: { icon: MessageSquare, color: 'text-slate-500 bg-slate-50' },
  status_change: { icon: RefreshCw, color: 'text-amber-500 bg-amber-50' },
}

function formatTimestamp(ts: string): string {
  return new Date(ts).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function ActivitiesTab({ project }: ActivitiesTabProps) {
  const [activities, setActivities] = useState<ActivityEvent[]>([])

  useEffect(() => {
    const acts = activityService.listActivities(project.id, project)
    setActivities(acts)
  }, [project.id, project.updatedAt])

  if (activities.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4 text-center bg-white border border-slate-200 rounded-lg">
        <div className="p-3 bg-slate-100 rounded-full mb-3 text-slate-500">
          <Inbox className="h-8 w-8" />
        </div>
        <h3 className="text-base font-semibold text-slate-800 mb-1">Sem atividades</h3>
        <p className="text-sm text-slate-500 max-w-sm">
          Nenhuma atividade registrada para este projeto.
        </p>
      </div>
    )
  }

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <div className="relative">
        <div className="absolute left-[15px] top-2 bottom-2 w-px bg-slate-200" />
        <div className="space-y-4">
          {activities.map((event) => {
            const config = EVENT_ICONS[event.type] || EVENT_ICONS.status_change
            const Icon = config.icon
            return (
              <div key={event.id} className="flex items-start gap-3 relative">
                <div className={`p-1.5 rounded-full shrink-0 z-10 ${config.color}`}>
                  <Icon className="h-3 w-3" />
                </div>
                <div className="flex-1 min-w-0 pt-0.5">
                  <p className="text-xs font-medium text-slate-700">{event.message}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {formatTimestamp(event.timestamp)}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
