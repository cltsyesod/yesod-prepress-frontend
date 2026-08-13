import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

export type QuickFilter =
  | 'all'
  | 'critical'
  | 'pending'
  | 'fixed'
  | 'rejected'
  | 'ignored'
  | 'corrected'
  | 'autoFixable'
  | 'currentPage'

interface FilterChip {
  key: QuickFilter
  label: string
}

const CHIPS: FilterChip[] = [
  { key: 'all', label: 'Todos' },
  { key: 'critical', label: 'Crítico' },
  { key: 'pending', label: 'Pendente' },
  { key: 'fixed', label: 'Aprovado' },
  { key: 'corrected', label: 'Corrigido' },
  { key: 'rejected', label: 'Rejeitado' },
  { key: 'ignored', label: 'Ignorado' },
  { key: 'autoFixable', label: 'Auto-corrigível' },
  { key: 'currentPage', label: 'Pág. atual' },
]

interface QuickFiltersProps {
  search: string
  onSearchChange: (value: string) => void
  activeFilter: QuickFilter
  onFilterChange: (filter: QuickFilter) => void
  category: string
  categories: string[]
  onCategoryChange: (category: string) => void
  currentPage: number
  counts: Record<QuickFilter, number>
}

export function QuickFilters({
  search,
  onSearchChange,
  activeFilter,
  onFilterChange,
  category,
  categories,
  onCategoryChange,
  counts,
}: QuickFiltersProps) {
  const hasSearch = search.length > 0

  return (
    <div className="flex flex-wrap items-center gap-2 mb-3">
      <div className="relative flex-1 min-w-[140px]">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Buscar problema..."
          className="h-8 pl-7 pr-7 text-xs bg-card"
        />
        {hasSearch && (
          <button
            onClick={() => onSearchChange('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {CHIPS.map((chip) => {
          const isActive = activeFilter === chip.key
          const count = counts[chip.key] ?? 0
          return (
            <Button
              key={chip.key}
              variant={isActive ? 'default' : 'outline'}
              size="sm"
              onClick={() => onFilterChange(chip.key)}
              className={cn(
                'h-8 text-xs gap-1.5 rounded-full px-3 transition-all',
                !isActive && 'bg-card text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              {chip.label}
              <span
                className={cn(
                  'text-[10px] font-bold tabular-nums',
                  isActive ? 'text-white/80' : 'text-muted-foreground',
                )}
              >
                {count}
              </span>
            </Button>
          )
        })}
      </div>
      <Select value={category} onValueChange={onCategoryChange}>
        <SelectTrigger className="h-8 w-[150px] text-xs bg-card">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todas categorias</SelectItem>
          {categories.map((c) => (
            <SelectItem key={c} value={c}>
              {c}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
