import { CalendarClock, Flag, UserRound } from 'lucide-react'
import { useTeam } from '@/hooks/use-team'
import { cn } from '@/lib/utils'
import { DUE_TONE, PRIORITIES, dueLabel } from '@/lib/job-meta'
import type { Priority } from '@/services/jobsService'

export interface JobMeta {
  assigneeId: string | null
  dueDate: string | null
  priority: Priority
}

const FIELD =
  'h-9 rounded-md border border-input bg-background px-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring'

/**
 * Responsável, prazo e prioridade do trabalho. `compact`: numa linha, para o cabeçalho
 * da tela do trabalho (cada mudança é salva na hora pela tela).
 */
export function JobMetaFields({
  value,
  onChange,
  compact,
  disabled,
}: {
  value: JobMeta
  onChange: (change: Partial<JobMeta>) => void
  compact?: boolean
  disabled?: boolean
}) {
  const { members } = useTeam()
  const due = dueLabel(value.dueDate)
  const people = members.filter((m) => m.active || m.userId === value.assigneeId)

  return (
    <div className={cn(compact ? 'flex flex-wrap items-center gap-2' : 'grid gap-3 sm:grid-cols-3')}>
      <label className={cn('space-y-1', compact && 'flex items-center gap-1.5 space-y-0')}>
        {compact ? (
          <UserRound className="h-4 w-4 text-muted-foreground" aria-label="Responsável" />
        ) : (
          <span className="block text-sm font-medium text-foreground">Responsável</span>
        )}
        <select
          className={cn(FIELD, !compact && 'w-full')}
          value={value.assigneeId ?? ''}
          disabled={disabled}
          onChange={(e) => onChange({ assigneeId: e.target.value || null })}
        >
          <option value="">Ninguém</option>
          {people.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name}
              {!m.active ? ' (inativo)' : ''}
            </option>
          ))}
        </select>
      </label>

      <label className={cn('space-y-1', compact && 'flex items-center gap-1.5 space-y-0')}>
        {compact ? (
          <CalendarClock className="h-4 w-4 text-muted-foreground" aria-label="Prazo" />
        ) : (
          <span className="block text-sm font-medium text-foreground">Prazo de entrega</span>
        )}
        <input
          type="date"
          className={cn(FIELD, !compact && 'w-full')}
          value={value.dueDate ?? ''}
          disabled={disabled}
          onChange={(e) => onChange({ dueDate: e.target.value || null })}
        />
        {compact && due && <span className={cn('text-xs', DUE_TONE[due.tone])}>{due.text}</span>}
      </label>

      <label className={cn('space-y-1', compact && 'flex items-center gap-1.5 space-y-0')}>
        {compact ? (
          <Flag className="h-4 w-4 text-muted-foreground" aria-label="Prioridade" />
        ) : (
          <span className="block text-sm font-medium text-foreground">Prioridade</span>
        )}
        <select
          className={cn(FIELD, !compact && 'w-full')}
          value={value.priority}
          disabled={disabled}
          onChange={(e) => onChange({ priority: e.target.value as Priority })}
        >
          {PRIORITIES.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
