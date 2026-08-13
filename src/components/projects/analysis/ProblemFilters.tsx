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

export interface AnalysisFilters {
  search: string
  severity: string
  category: string
  status: string
  page: string
}

interface ProblemFiltersProps {
  filters: AnalysisFilters
  categories: string[]
  pages: number[]
  onFilterChange: (key: keyof AnalysisFilters, value: string) => void
  onClear: () => void
}

export function ProblemFilters({
  filters,
  categories,
  pages,
  onFilterChange,
  onClear,
}: ProblemFiltersProps) {
  const hasActiveFilters =
    filters.search ||
    filters.severity !== 'all' ||
    filters.category !== 'all' ||
    filters.status !== 'all' ||
    filters.page !== 'all'

  return (
    <div className="flex flex-wrap items-center gap-2 mb-3">
      <div className="relative flex-1 min-w-[150px]">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={filters.search}
          onChange={(e) => onFilterChange('search', e.target.value)}
          placeholder="Buscar problema..."
          className="h-8 pl-7 text-xs bg-card"
        />
      </div>
      <Select value={filters.severity} onValueChange={(v) => onFilterChange('severity', v)}>
        <SelectTrigger className="h-8 w-[120px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Toda criticidade</SelectItem>
          <SelectItem value="critical">Crítico</SelectItem>
          <SelectItem value="warning">Atenção</SelectItem>
          <SelectItem value="info">Informativo</SelectItem>
        </SelectContent>
      </Select>
      <Select value={filters.category} onValueChange={(v) => onFilterChange('category', v)}>
        <SelectTrigger className="h-8 w-[130px] text-xs">
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
      <Select value={filters.status} onValueChange={(v) => onFilterChange('status', v)}>
        <SelectTrigger className="h-8 w-[110px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos status</SelectItem>
          <SelectItem value="pending">Pendente</SelectItem>
          <SelectItem value="approved">Aprovado</SelectItem>
          <SelectItem value="rejected">Rejeitado</SelectItem>
          <SelectItem value="ignored">Ignorado</SelectItem>
        </SelectContent>
      </Select>
      <Select value={filters.page} onValueChange={(v) => onFilterChange('page', v)}>
        <SelectTrigger className="h-8 w-[90px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todas páginas</SelectItem>
          {pages.map((p) => (
            <SelectItem key={p} value={String(p)}>
              Pág. {p}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {hasActiveFilters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onClear}
          className="h-8 text-xs gap-1 text-muted-foreground hover:text-destructive"
        >
          <X className="h-3 w-3" /> Limpar
        </Button>
      )}
    </div>
  )
}
