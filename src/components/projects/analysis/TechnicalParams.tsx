import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AnalysisProblem } from '@/types'

interface TechnicalParamsProps {
  problem: AnalysisProblem
}

export function TechnicalParams({ problem }: TechnicalParamsProps) {
  const [showAdvanced, setShowAdvanced] = useState(false)

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Essencial
        </h5>
        <div className="space-y-1 text-xs">
          <div>
            <span className="text-muted-foreground">Regra técnica: </span>
            <span className="text-foreground">{problem.technicalRule}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Valor encontrado: </span>
            <span className="text-red-600 dark:text-red-400 font-medium">{problem.foundValue}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Valor recomendado: </span>
            <span className="text-green-600 dark:text-green-400 font-medium">
              {problem.recommendedValue}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Sugestão: </span>
            <span className="text-foreground">{problem.correctionSuggestion}</span>
          </div>
        </div>
      </div>
      <div>
        <button
          onClick={() => setShowAdvanced((v) => !v)}
          className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronDown
            className={cn('h-3 w-3 transition-transform', showAdvanced && 'rotate-180')}
          />
          Avançado
        </button>
        {showAdvanced && (
          <div className="space-y-1 text-xs mt-1 animate-fade-in">
            <div>
              <span className="text-muted-foreground">Confiança: </span>
              <span className="text-foreground">{problem.confidence}%</span>
            </div>
            <div>
              <span className="text-muted-foreground">Localização: </span>
              <span className="text-foreground">{problem.location}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Página: </span>
              <span className="text-foreground">{problem.page}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Categoria: </span>
              <span className="text-foreground">{problem.category}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
