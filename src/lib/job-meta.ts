import type { JobStage, Priority } from '@/services/jobsService'

export const PRIORITIES: { id: Priority; label: string; className: string }[] = [
  { id: 'urgente', label: 'Urgente', className: 'bg-red-500/15 text-red-600 dark:text-red-400' },
  { id: 'alta', label: 'Alta', className: 'bg-orange-500/15 text-orange-700 dark:text-orange-400' },
  { id: 'normal', label: 'Normal', className: 'bg-muted text-muted-foreground' },
  { id: 'baixa', label: 'Baixa', className: 'bg-muted text-muted-foreground/70' },
]

export const priorityOf = (id?: Priority) => PRIORITIES.find((p) => p.id === id) ?? PRIORITIES[2]

/** Ordem de urgência para listas: urgente primeiro. */
export const PRIORITY_RANK: Record<Priority, number> = { urgente: 0, alta: 1, normal: 2, baixa: 3 }

/** Etapas da pré-impressão, na ordem do fluxo, com a cor de cada uma. */
export const STAGES: { id: JobStage; label: string; hint: string; dot: string; text: string }[] = [
  { id: 'waiting', label: 'Sem análise', hint: 'arquivo recebido, análise não iniciada', dot: 'bg-slate-400', text: 'text-muted-foreground' },
  { id: 'analyzing', label: 'Analisando', hint: 'no analisador agora', dot: 'bg-blue-500', text: 'text-blue-600 dark:text-blue-400' },
  { id: 'blocked', label: 'Bloqueados', hint: 'algo impede a impressão', dot: 'bg-red-500', text: 'text-red-600 dark:text-red-400' },
  { id: 'decision', label: 'Para decidir', hint: 'pontos esperando o operador', dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400' },
  { id: 'returned', label: 'Com o cliente', hint: 'devolvido, aguardando arquivo novo', dot: 'bg-orange-500', text: 'text-orange-600 dark:text-orange-400' },
  { id: 'failed', label: 'Falharam', hint: 'a análise não terminou', dot: 'bg-rose-700', text: 'text-rose-700 dark:text-rose-400' },
  { id: 'ready', label: 'Prontos', hint: 'podem ir para o RIP', dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' },
  { id: 'sent', label: 'No RIP', hint: 'pré-impressão concluída', dot: 'bg-violet-500', text: 'text-violet-600 dark:text-violet-400' },
]

export const stageOf = (id?: JobStage) => STAGES.find((s) => s.id === id)

const DAY = 86_400_000

/** Dias até o prazo (negativo = atrasado), contando datas, não horas. */
export function daysUntil(dueDate: string, now = new Date()): number {
  const [y, m, d] = dueDate.split('-').map(Number)
  const due = Date.UTC(y, m - 1, d)
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((due - today) / DAY)
}

/** "Atrasado 2 dias", "Vence hoje", "Amanhã", "Em 3 dias", "12/11". */
export function dueLabel(dueDate: string | null): { text: string; tone: 'late' | 'today' | 'soon' | 'later' } | null {
  if (!dueDate) return null
  const days = daysUntil(dueDate)
  if (days < 0) return { text: `Atrasado ${-days} ${days === -1 ? 'dia' : 'dias'}`, tone: 'late' }
  if (days === 0) return { text: 'Vence hoje', tone: 'today' }
  if (days === 1) return { text: 'Amanhã', tone: 'soon' }
  if (days <= 3) return { text: `Em ${days} dias`, tone: 'soon' }
  const [, m, d] = dueDate.split('-')
  return { text: `${d}/${m}`, tone: 'later' }
}

export const DUE_TONE = {
  late: 'text-red-600 dark:text-red-400 font-semibold',
  today: 'text-orange-600 dark:text-orange-400 font-semibold',
  soon: 'text-amber-600 dark:text-amber-400',
  later: 'text-muted-foreground',
}
