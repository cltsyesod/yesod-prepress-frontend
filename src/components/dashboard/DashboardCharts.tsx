import type { ReactNode } from 'react'
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, LabelList } from 'recharts'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import type { ChartConfig } from '@/components/ui/chart'
import type { ChartData } from '@/services/dashboardService'

const config = { value: { label: 'Qtde' } } satisfies ChartConfig

function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <h3 className="text-lg font-semibold text-card-foreground mb-3">{title}</h3>
      {children}
    </div>
  )
}

function EmptyChart() {
  return (
    <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground">
      Sem dados
    </div>
  )
}

interface LegendEntry {
  name: string
  value: number
  color?: string
}

function PersistentLegend({ data }: { data: LegendEntry[] }) {
  const total = data.reduce((s, d) => s + d.value, 0)
  return (
    <div className="flex flex-col gap-1.5 max-h-[140px] overflow-y-auto pr-1">
      {data.map((d, i) => (
        <div key={i} className="flex items-center gap-2 text-sm min-w-0">
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ backgroundColor: d.color || '#64748b' }}
          />
          <span className="text-card-foreground truncate flex-1">{d.name}</span>
          <span className="text-foreground font-medium tabular-nums">{d.value}</span>
          <span className="text-muted-foreground tabular-nums w-12 text-right">
            {total > 0 ? `${Math.round((d.value / total) * 100)}%` : '0%'}
          </span>
        </div>
      ))}
    </div>
  )
}

function PieChartWithLegend({ data }: { data: { name: string; value: number; color: string }[] }) {
  return (
    <div className="flex flex-col sm:flex-row gap-3">
      <div className="sm:w-1/2 flex items-center justify-center">
        <ChartContainer config={config} className="chart-themed h-[160px] w-full">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius={40}
              outerRadius={65}
              paddingAngle={2}
            >
              {data.map((e, i) => (
                <Cell key={i} fill={e.color} />
              ))}
            </Pie>
            <ChartTooltip content={<ChartTooltipContent nameKey="name" />} />
          </PieChart>
        </ChartContainer>
      </div>
      <div className="sm:w-1/2 flex flex-col justify-center">
        <PersistentLegend data={data} />
      </div>
    </div>
  )
}

export function StatusPieChart({ data }: { data: ChartData['projectsByStatus'] }) {
  return (
    <ChartCard title="Projetos por Status">
      {data.length === 0 ? <EmptyChart /> : <PieChartWithLegend data={data} />}
    </ChartCard>
  )
}

export function CriticalityPieChart({ data }: { data: ChartData['problemsByCriticality'] }) {
  return (
    <ChartCard title="Problemas por Criticidade">
      {data.length === 0 ? <EmptyChart /> : <PieChartWithLegend data={data} />}
    </ChartCard>
  )
}

export function RecurringProblemsChart({ data }: { data: ChartData['recurringProblems'] }) {
  return (
    <ChartCard title="Problemas Mais Recorrentes">
      {data.length === 0 ? (
        <EmptyChart />
      ) : (
        <ChartContainer config={config} className="chart-themed h-[220px] w-full">
          <BarChart
            data={data}
            layout="vertical"
            margin={{ left: 10, right: 40, top: 5, bottom: 5 }}
          >
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={130} />
            <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={18}>
              <LabelList
                dataKey="value"
                position="right"
                fontSize={12}
                formatter={(val: number) => `${val}x`}
              />
            </Bar>
            <ChartTooltip content={<ChartTooltipContent />} />
          </BarChart>
        </ChartContainer>
      )}
    </ChartCard>
  )
}

export function ProfileBarChart({
  data,
  onProfileClick,
}: {
  data: ChartData['projectsByProfile']
  onProfileClick?: (name: string) => void
}) {
  const total = data.reduce((s, d) => s + d.value, 0)
  return (
    <ChartCard title="Projetos por Perfil de Produção">
      {data.length === 0 ? (
        <EmptyChart />
      ) : (
        <ChartContainer config={config} className="chart-themed h-[220px] w-full">
          <BarChart data={data} margin={{ top: 20, right: 10, left: 0, bottom: 5 }}>
            <XAxis
              dataKey="name"
              tick={{ fontSize: 12 }}
              angle={-20}
              textAnchor="end"
              height={60}
              interval={0}
            />
            <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
            <Bar
              dataKey="value"
              radius={[4, 4, 0, 0]}
              cursor={!!onProfileClick}
              onClick={
                onProfileClick
                  ? (payload: Record<string, unknown>) => onProfileClick(String(payload.name))
                  : undefined
              }
            >
              <LabelList
                dataKey="value"
                position="top"
                fontSize={12}
                formatter={(val: number) => {
                  const pct = total > 0 ? Math.round((val / total) * 100) : 0
                  return `${val} (${pct}%)`
                }}
              />
            </Bar>
            <ChartTooltip content={<ChartTooltipContent />} />
          </BarChart>
        </ChartContainer>
      )}
    </ChartCard>
  )
}
