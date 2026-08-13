import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { X } from 'lucide-react'
import { MOCK_CLIENTS, MOCK_USERS, STATUS_OPTIONS, PERIOD_OPTIONS } from '@/services/mockData'
import type { DashboardFilters } from '@/services/dashboardService'

interface Props {
  filters: DashboardFilters
  onFilterChange: (key: keyof DashboardFilters, value: string) => void
  onClear: () => void
  profileOptions: { value: string; label: string }[]
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

export function DashboardFilters({ filters, onFilterChange, onClear, profileOptions }: Props) {
  const hasActive = Object.values(filters).some((v) => v !== 'all')
  const clientOpts = [
    { value: 'all', label: 'Todos os clientes' },
    ...MOCK_CLIENTS.map((c) => ({ value: c.id, label: c.name })),
  ]
  const userOpts = [
    { value: 'all', label: 'Todos os resp.' },
    ...MOCK_USERS.map((u) => ({ value: u.id, label: u.name })),
  ]
  const statusOpts = [
    { value: 'all', label: 'Todos os status' },
    ...STATUS_OPTIONS.filter((s) => s.value !== 'all'),
  ]
  const periodOpts = [
    { value: 'all', label: 'Todo o período' },
    ...PERIOD_OPTIONS.filter((p) => p.value !== 'all'),
  ]

  return (
    <div className="bg-card border border-border rounded-lg p-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <FilterSelect
          value={filters.period}
          onChange={(v) => onFilterChange('period', v)}
          options={periodOpts}
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
          options={profileOptions}
        />
        <FilterSelect
          value={filters.status}
          onChange={(v) => onFilterChange('status', v)}
          options={statusOpts}
        />
        {hasActive && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            className="text-sm text-muted-foreground hover:text-destructive h-9 gap-1"
          >
            <X className="h-3 w-3" /> Limpar
          </Button>
        )}
      </div>
    </div>
  )
}
