import { Crop, FileCheck2, ImageIcon, Package, Palette, Ruler, Scissors, Type, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SECTIONS, TONE_CLASS, TONE_LABEL, toneOf, type FileProfile, type SectionId, type Tone } from '@/lib/xray'
import { advisoryOf, tileSummary, worse } from '@/lib/xray-facts'
import type { AnalysisIssue } from '@/services/analysisJobsService'

export type View = SectionId | 'pending' | 'delivery'

export const SECTION_ICON: Record<SectionId, LucideIcon> = {
  format: Ruler,
  bleed: Crop,
  images: ImageIcon,
  colors: Palette,
  fonts: Type,
  finishing: Scissors,
  structure: FileCheck2,
}

/** Situação de uma seção: a pior ocorrência pendente, ou o aviso de leitura. */
export function sectionTone(id: SectionId, profile: FileProfile | null, issues: AnalysisIssue[]): Tone {
  const codes = SECTIONS.find((s) => s.id === id)?.codes ?? []
  const tone = toneOf(issues.filter((i) => codes.includes(i.rule_code)))
  const advisory = profile ? advisoryOf(id, profile) : null
  return advisory ? worse(tone, advisory.tone) : tone
}

/**
 * O raio-x num relance: um cartão por característica do arquivo, com o número que importa
 * e a cor da situação. Clicar abre o detalhe ao lado da arte.
 */
export function XRayTiles({
  profile,
  issues,
  view,
  onSelect,
  delivery,
}: {
  profile: FileProfile
  issues: AnalysisIssue[]
  view: View
  onSelect: (view: View) => void
  /** Cartão "Entrega" (comparar cliente × produção), quando houve correção. */
  delivery: { changes: number } | null
}) {
  return (
    // Numa linha só em telas largas (7 ou 8 cartões, sem buraco no fim da grade).
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 xl:auto-cols-fr xl:grid-flow-col xl:grid-cols-none">
      {SECTIONS.map((section) => {
        const tone = sectionTone(section.id, profile, issues)
        const summary = tileSummary(section.id, profile)
        const pending = issues.filter(
          (i) => section.codes.includes(i.rule_code) && i.status === 'pending' && i.severity !== 'informational',
        ).length
        return (
          <Tile
            key={section.id}
            icon={SECTION_ICON[section.id]}
            title={section.title}
            value={summary.value}
            sub={summary.sub}
            tone={tone}
            badge={pending}
            selected={view === section.id}
            onClick={() => onSelect(view === section.id ? 'pending' : section.id)}
          />
        )
      })}
      {delivery && (
        <Tile
          icon={Package}
          title="Entrega"
          value={delivery.changes ? `${delivery.changes} ${delivery.changes === 1 ? 'mudança' : 'mudanças'}` : 'Sem mudanças'}
          sub="cliente × produção"
          tone="ok"
          neutral
          selected={view === 'delivery'}
          onClick={() => onSelect(view === 'delivery' ? 'pending' : 'delivery')}
        />
      )}
    </div>
  )
}

function Tile({
  icon: Icon,
  title,
  value,
  sub,
  tone,
  badge = 0,
  selected,
  neutral,
  onClick,
}: {
  icon: LucideIcon
  title: string
  value: string
  sub: string
  tone: Tone
  badge?: number
  selected: boolean
  neutral?: boolean
  onClick: () => void
}) {
  const style = TONE_CLASS[tone]
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'group relative flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-3 text-left transition-all',
        'hover:-translate-y-0.5 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        selected ? 'border-primary ring-1 ring-primary' : 'border-border',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-lg',
            neutral ? 'bg-primary/10 text-primary' : cn(style.soft, style.text),
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
        {badge > 0 && (
          <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold text-white', tone === 'blocked' ? 'bg-red-500' : 'bg-amber-500')}>
            {badge}
          </span>
        )}
      </div>
      <div className="min-w-0">
        <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
        <p className="truncate text-base font-semibold tabular-nums text-foreground" title={value}>
          {value}
        </p>
        <p className="truncate text-xs text-muted-foreground" title={sub}>
          {sub}
        </p>
      </div>
      {!neutral && (
        <span className={cn('flex items-center gap-1.5 text-[11px] font-medium', style.text)}>
          <span className={cn('h-1.5 w-1.5 rounded-full', style.dot)} />
          {TONE_LABEL[tone]}
        </span>
      )}
    </button>
  )
}
