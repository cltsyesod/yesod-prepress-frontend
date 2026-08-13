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
import {
  MOCK_CLIENTS,
  MOCK_USERS,
  MOCK_PROFILES,
  STATUS_OPTIONS,
  SEVERITY_OPTIONS,
  PERIOD_OPTIONS,
} from '@/services/mockData'
import type { ReportFilters as Filters } from '@/services/reportService'

interface Props {
  filters: Filters
  onFilterChange: (key: keyof Filters, value: string) => void
  onClear: () => void
}

const RESULT_OPTIONS = [
  { value: 'all', label: 'Todos os resultados' },
  { value: 'Aprovado', label: 'Aprovado' },
  { value: 'Aprovado com ressalvas', label: 'Aprovado com ressalvas' },
  { value: 'Requer revisão', label: 'Requer revisão' },
  { value: 'Reprovado tecnicamente', label: 'Reprovado tecnicamente' },
]

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

export function ReportFilters({ filters, onFilterChange, onClear }: Props) {
  const hasActive =
    Object.entries(filters).some(([k, v]) => k !== 'search' && v !== 'all') ||
    filters.search.trim() !== ''
  const clientOpts = [
    { value: 'all', label: 'Todos os clientes' },
    ...MOCK_CLIENTS.map((c: { id: string; name: string }) => ({ value: c.id, label: c.name })),
  ]
  const userOpts = [
    { value: 'all', label: 'Todos os resp.' },
    ...MOCK_USERS.map((u: { id: string; name: string }) => ({ value: u.id, label: u.name })),
  ]
  const profileOpts = [
    { value: 'all', label: 'Todos os perfis' },
    ...MOCK_PROFILES.map((p: { name: string }) => ({ value: p.name, label: p.name })),
  ]

  return (
    <div className="bg-[#182233] border border-[#2A374A] rounded-lg p-3 space-y-2">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input
          type="search"
          placeholder="Buscar por projeto, cliente, pedido ou arquivo..."
          value={filters.search}
          onChange={(e) => onFilterChange('search', e.target.value)}
          className="pl-8 h-9 text-sm bg-slate-50/5"
        />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
        <FilterSelect
          value={filters.period}
          onChange={(v) => onFilterChange('period', v)}
          options={PERIOD_OPTIONS}
        />
        <FilterSelect
          value={filters.client}
          onChange={(v) => onFilterChange('client', v)}
          options={clientOpts}
        />
        <FilterSelect
          value={filters.responsible}
          onChange={(v) => onFilterChange('responsible', v)}
          options={userOpts}
        />
        <FilterSelect
          value={filters.profile}
          onChange={(v) => onFilterChange('profile', v)}
          options={profileOpts}
        />
        <FilterSelect
          value={filters.result}
          onChange={(v) => onFilterChange('result', v)}
          options={RESULT_OPTIONS}
        />
        <FilterSelect
          value={filters.status}
          onChange={(v) => onFilterChange('status', v)}
          options={STATUS_OPTIONS}
        />
        <FilterSelect
          value={filters.severity}
          onChange={(v) => onFilterChange('severity', v)}
          options={SEVERITY_OPTIONS}
        />
      </div>
      {hasActive && (
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            className="text-sm text-slate-300 hover:text-red-400 h-8 gap-1"
          >
            <X className="h-3.5 w-3.5" /> Limpar filtros
          </Button>
        </div>
      )}
    </div>
  )
}
