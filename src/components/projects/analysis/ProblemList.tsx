import { useState, useEffect } from 'react'
import { ChevronRight } from 'lucide-react'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { ProblemItem } from './ProblemItem'
import { cn } from '@/lib/utils'
import type { AnalysisProblem, ProblemStatus } from '@/types'

interface ProblemListProps {
  problems: AnalysisProblem[]
  selectedProblemId: string | null
  onAction: (problemId: string, status: ProblemStatus, justification?: string) => void
  onViewInFile: (problemId: string) => void
  onSelect?: (problemId: string) => void
}

const GROUPS = [
  { key: 'critical', label: 'Crítico', color: 'text-red-600 dark:text-red-400', dot: 'bg-red-500' },
  {
    key: 'warning',
    label: 'Atenção',
    color: 'text-amber-600 dark:text-amber-400',
    dot: 'bg-amber-500',
  },
  {
    key: 'info',
    label: 'Informativo',
    color: 'text-blue-600 dark:text-blue-400',
    dot: 'bg-blue-500',
  },
] as const

export function ProblemList({
  problems,
  selectedProblemId,
  onAction,
  onViewInFile,
  onSelect,
}: ProblemListProps) {
  const [expandedProblem, setExpandedProblem] = useState<string | null>(null)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    critical: true,
    warning: true,
    info: true,
  })

  useEffect(() => {
    if (selectedProblemId) {
      setExpandedProblem(selectedProblemId)
      const problem = problems.find((p) => p.id === selectedProblemId)
      if (problem) {
        setOpenGroups((s) => ({ ...s, [problem.severity]: true }))
      }
    }
  }, [selectedProblemId, problems])

  const toggleProblem = (id: string) => {
    setExpandedProblem((prev) => (prev === id ? null : id))
    onSelect?.(id)
  }

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="px-3 py-2 border-b border-border/50 bg-muted/50">
        <h3 className="text-sm font-semibold text-foreground">
          Problemas Detectados
          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
            ({problems.length})
          </span>
        </h3>
      </div>
      {GROUPS.map((group) => {
        const groupProblems = problems.filter((p) => p.severity === group.key)
        if (groupProblems.length === 0) return null
        const pendingCount = groupProblems.filter((p) => p.status === 'pending').length
        return (
          <Collapsible
            key={group.key}
            open={openGroups[group.key]}
            onOpenChange={(v) => setOpenGroups((s) => ({ ...s, [group.key]: v }))}
          >
            <CollapsibleTrigger className="w-full flex items-center gap-2 px-3 py-2 hover:bg-accent/50 border-b border-border/50 transition-colors">
              <ChevronRight
                className={cn(
                  'h-3.5 w-3.5 text-muted-foreground transition-transform',
                  openGroups[group.key] && 'rotate-90',
                )}
              />
              <span className={cn('h-2 w-2 rounded-full', group.dot)} />
              <span className={cn('text-xs font-semibold', group.color)}>{group.label}</span>
              <span className="text-xs text-muted-foreground">
                {groupProblems.length} problema(s) · {pendingCount} pendente(s)
              </span>
            </CollapsibleTrigger>
            <CollapsibleContent>
              {groupProblems.map((p) => (
                <ProblemItem
                  key={p.id}
                  problem={p}
                  isExpanded={expandedProblem === p.id}
                  isSelected={selectedProblemId === p.id}
                  onToggle={() => toggleProblem(p.id)}
                  onAction={onAction}
                  onViewInFile={onViewInFile}
                />
              ))}
            </CollapsibleContent>
          </Collapsible>
        )
      })}
      {problems.length === 0 && (
        <div className="py-8 text-center">
          <p className="text-sm text-muted-foreground">Nenhum problema corresponde aos filtros.</p>
        </div>
      )}
    </div>
  )
}
