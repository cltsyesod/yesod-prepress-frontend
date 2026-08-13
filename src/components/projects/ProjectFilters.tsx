import { Search, Table2, LayoutGrid, X } from 'lucide-react'
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
import {
  MOCK_CLIENTS,
  MOCK_USERS,
  MOCK_PROFILES,
  FILE_TYPES,
  STATUS_OPTIONS,
  SEVERITY_OPTIONS,
  PERIOD_OPTIONS,
  SORT_OPTIONS,
} from '@/services/mockData'
import type { FilterState, SortOption } from '@/types'

interface ProjectFiltersProps {
  filters: FilterState
  onFilterChange: (key: keyof FilterState, value: string) => void
  onClear: () => void
  sort: SortOption
  onSortChange: (value: SortOption) => void
  view: 'table' | 'card'
  onViewChange: (view: 'table' | 'card') => void
}

function FilterSelect({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 text-sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value} className="text-sm">
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function ProjectFilters({
  filters,
  onFilterChange,
  onClear,
  sort,
  onSortChange,
  view,
  onViewChange,
}: ProjectFiltersProps) {
  const hasActiveFilters =
    Object.entries(filters).some(([k, v]) => k !== 'search' && v !== 'all') ||
    filters.search.trim() !== ''
  const fileTypeOptions = [
    { value: 'all', label: 'Todos os tipos' },
    ...FILE_TYPES.map((t) => ({ value: t, label: t })),
  ]
  const clientOptions = [
    { value: 'all', label: 'Todos os clientes' },
    ...MOCK_CLIENTS.map((c) => ({ value: c.id, label: c.name })),
  ]
  const userOptions = [
    { value: 'all', label: 'Todos os responsáveis' },
    ...MOCK_USERS.map((u) => ({ value: u.id, label: u.name })),
  ]
  const profileOptions = [
    { value: 'all', label: 'Todos os perfis' },
    ...MOCK_PROFILES.map((p) => ({ value: p.name, label: p.name })),
  ]

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-3 space-y-3">
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            type="search"
            placeholder="Buscar por projeto, cliente, arquivo ou pedido..."
            value={filters.search}
            onChange={(e) => onFilterChange('search', e.target.value)}
            className="pl-8 h-9 text-sm bg-slate-50/50"
          />
        </div>
        <div className="flex items-center gap-2">
          <Select value={sort} onValueChange={(v) => onSortChange(v as SortOption)}>
            <SelectTrigger className="h-9 text-sm w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} className="text-sm">
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center border border-slate-200 rounded-md">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onViewChange('table')}
              className={cn('h-9 w-9 rounded-r-none', view === 'table' && 'bg-slate-100')}
            >
              <Table2 className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onViewChange('card')}
              className={cn('h-9 w-9 rounded-l-none', view === 'card' && 'bg-slate-100')}
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>{' '}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
        <FilterSelect
          value={filters.status}
          onChange={(v) => onFilterChange('status', v)}
          options={STATUS_OPTIONS}
        />
        <FilterSelect
          value={filters.client}
          onChange={(v) => onFilterChange('client', v)}
          options={clientOptions}
        />
        <FilterSelect
          value={filters.responsible}
          onChange={(v) => onFilterChange('responsible', v)}
          options={userOptions}
        />
        <FilterSelect
          value={filters.severity}
          onChange={(v) => onFilterChange('severity', v)}
          options={SEVERITY_OPTIONS}
        />
        <FilterSelect
          value={filters.profile}
          onChange={(v) => onFilterChange('profile', v)}
          options={profileOptions}
        />
        <FilterSelect
          value={filters.period}
          onChange={(v) => onFilterChange('period', v)}
          options={PERIOD_OPTIONS}
        />
        <FilterSelect
          value={filters.fileType}
          onChange={(v) => onFilterChange('fileType', v)}
          options={fileTypeOptions}
        />
      </div>
      {hasActiveFilters && (
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            className="text-sm text-slate-600 hover:text-red-600 h-8 gap-1"
          >
            <X className="h-3.5 w-3.5" /> Limpar filtros
          </Button>
        </div>
      )}
    </div>
  )
}
