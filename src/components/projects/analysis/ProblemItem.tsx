import { useState } from 'react'
import { ChevronDown, Check, CheckCheck, X, EyeOff, FileSearch, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { TechnicalParams } from './TechnicalParams'
import type { AnalysisProblem, ProblemStatus } from '@/types'

const STATUS_LABELS: Record<ProblemStatus, string> = {
  pending: 'Pendente',
  approved: 'Aprovado',
  rejected: 'Rejeitado',
  ignored: 'Ignorado',
  corrected: 'Corrigido',
}

const STATUS_BADGES: Record<ProblemStatus, string> = {
  pending: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  approved: 'bg-green-500/15 text-green-600 dark:text-green-400',
  rejected: 'bg-red-500/15 text-red-600 dark:text-red-400',
  ignored: 'bg-muted text-muted-foreground',
  corrected: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
}

const SEVERITY_DOTS: Record<string, string> = {
  critical: 'bg-red-500',
  warning: 'bg-amber-500',
  info: 'bg-blue-500',
}

interface ProblemItemProps {
  problem: AnalysisProblem
  isExpanded: boolean
  isSelected: boolean
  onToggle: () => void
  onAction: (problemId: string, status: ProblemStatus, justification?: string) => void
  onViewInFile: (problemId: string) => void
}

export function ProblemItem({
  problem,
  isExpanded,
  isSelected,
  onToggle,
  onAction,
  onViewInFile,
}: ProblemItemProps) {
  const [actionMode, setActionMode] = useState<ProblemStatus | null>(null)
  const [justification, setJustification] = useState('')

  const handleConfirm = () => {
    if (actionMode) {
      onAction(problem.id, actionMode, justification || undefined)
      setActionMode(null)
      setJustification('')
    }
  }

  const handleAutoFix = () => {
    onAction(problem.id, 'corrected', 'Corrigido automaticamente pelo sistema')
  }

  return (
    <div
      className={cn(
        'border-b border-border/50 last:border-0 transition-colors',
        isSelected && 'bg-primary/5',
      )}
    >
      <button
        onClick={onToggle}
        className="w-full flex items-start gap-2 p-2.5 text-left hover:bg-accent/50 transition-colors"
      >
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0 transition-transform',
            isExpanded && 'rotate-180',
          )}
        />
        <span
          className={cn(
            'h-2 w-2 rounded-full mt-1.5 shrink-0',
            SEVERITY_DOTS[problem.severity] || 'bg-muted-foreground',
          )}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-medium text-foreground">{problem.name}</span>
            <span
              className={cn(
                'text-[10px] font-medium px-1.5 py-0.5 rounded',
                STATUS_BADGES[problem.status],
              )}
            >
              {STATUS_LABELS[problem.status]}
            </span>
            {problem.autoFixable && problem.status === 'pending' && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-600 dark:text-purple-400 flex items-center gap-0.5">
                <Wand2 className="h-2.5 w-2.5" />
                Auto
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-xs text-muted-foreground">{problem.category}</span>
            <span className="text-xs text-muted-foreground/60">·</span>
            <span className="text-xs text-muted-foreground">{problem.location}</span>
          </div>
        </div>
      </button>
      {isExpanded && (
        <div className="px-2.5 pb-3 pl-7 space-y-2.5 animate-fade-in">
          <p className="text-sm text-muted-foreground">{problem.description}</p>
          <TechnicalParams problem={problem} />
          {problem.justification && (
            <div className="text-xs text-muted-foreground bg-muted/50 rounded p-1.5">
              <span className="font-medium">Justificativa: </span>
              {problem.justification}
            </div>
          )}
          {actionMode ? (
            <div className="space-y-2">
              <Textarea
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
                placeholder="Digite a justificativa (obrigatório)..."
                className="text-xs min-h-[60px] bg-card"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={handleConfirm}
                  disabled={!justification.trim()}
                  className="h-7 text-xs"
                >
                  Confirmar
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setActionMode(null)
                    setJustification('')
                  }}
                  className="h-7 text-xs"
                >
                  Cancelar
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              <Button
                size="sm"
                variant="outline"
                onClick={() => onAction(problem.id, 'approved')}
                className="h-7 text-xs gap-1 bg-card"
              >
                <Check className="h-3 w-3" /> Aprovar
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onAction(problem.id, 'corrected')}
                className="h-7 text-xs gap-1 bg-card"
              >
                <CheckCheck className="h-3 w-3" /> Corrigir
              </Button>
              {problem.autoFixable && problem.status === 'pending' && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleAutoFix}
                  className="h-7 text-xs gap-1 bg-purple-500/10 border-purple-500/30 text-purple-600 dark:text-purple-400 hover:bg-purple-500/20"
                >
                  <Wand2 className="h-3 w-3" /> Auto-corrigir
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => setActionMode('rejected')}
                className="h-7 text-xs gap-1 bg-card"
              >
                <X className="h-3 w-3" /> Rejeitar
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setActionMode('ignored')}
                className="h-7 text-xs gap-1 bg-card"
              >
                <EyeOff className="h-3 w-3" /> Ignorar
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onViewInFile(problem.id)}
                className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
              >
                <FileSearch className="h-3 w-3" /> Ver no arquivo
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
