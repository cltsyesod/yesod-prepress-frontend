import type { ReactNode } from 'react'
import { Info, ListChecks, Package, X } from 'lucide-react'
import { IssueChecklist } from '@/components/jobs/IssueChecklist'
import { CompareTable } from '@/components/jobs/xray/CompareTable'
import { SECTION_ICON, sectionTone, type View } from '@/components/jobs/xray/XRayTiles'
import { cn } from '@/lib/utils'
import { SECTIONS, TONE_CLASS, TONE_LABEL, type FileProfile } from '@/lib/xray'
import { advisoryOf, factsOf } from '@/lib/xray-facts'
import type { AnalysisIssue, IssueFix } from '@/services/analysisJobsService'

type AppliedFix = { id: string; label: string; details: string[] }

interface DecisionProps {
  onDecide: (issueId: string, status: string, reason?: string) => Promise<void>
  onShowPage: (page: number) => void
  onFix: (issue: AnalysisIssue, fix?: IssueFix) => Promise<void>
  fixing: boolean
  focusId?: string | null
}

/**
 * Ao lado da arte: o detalhe do que foi escolhido nos cartões. Sem escolha, "o que precisa
 * de você" (todas as ocorrências por gravidade). Numa seção, os números medidos e as
 * decisões daquela seção. Em "Entrega", o arquivo do cliente ao lado do de produção.
 */
export function SectionDetail({
  view,
  profile,
  issues,
  clientProfile,
  fixes,
  onClose,
  ...decision
}: DecisionProps & {
  view: View
  profile: FileProfile | null
  issues: AnalysisIssue[]
  clientProfile: FileProfile | null
  fixes: AppliedFix[]
  onClose: () => void
}) {
  if (view === 'pending') {
    const open = issues.filter((i) => i.status === 'pending' && i.severity !== 'informational').length
    return (
      <Panel icon={ListChecks} title="O que precisa de você" subtitle={open ? `${open} em aberto` : 'nada em aberto'}>
        <IssueChecklist issues={issues} {...decision} />
      </Panel>
    )
  }

  if (view === 'delivery') {
    return (
      <Panel icon={Package} title="Cliente × produção" subtitle="o que mudou no arquivo" onClose={onClose}>
        <div className="space-y-4">
          {clientProfile && profile ? (
            <CompareTable client={clientProfile} delivered={profile} />
          ) : (
            <p className="text-sm text-muted-foreground">
              A comparação aparece quando os dois arquivos têm raio-x (reanalise se a correção for antiga).
            </p>
          )}
          {fixes.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Correções, em ordem</p>
              <ol className="space-y-2">
                {fixes.map((fix, index) => (
                  <li key={`${fix.id}-${index}`} className="flex gap-3 text-sm">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                      {index + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="font-medium text-foreground">{fix.label}</span>
                      {fix.details.length > 0 && <span className="block text-xs text-muted-foreground">{fix.details.join(' · ')}</span>}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      </Panel>
    )
  }

  const section = SECTIONS.find((s) => s.id === view)!
  const own = issues.filter((i) => section.codes.includes(i.rule_code))
  const tone = sectionTone(view, profile, issues)
  const style = TONE_CLASS[tone]
  const advisory = profile ? advisoryOf(view, profile) : null
  const facts = profile ? factsOf(view, profile, tone === 'blocked' ? 'blocked' : 'decision') : []

  return (
    <Panel
      icon={SECTION_ICON[view]}
      title={section.title}
      subtitle={
        <span className={cn('inline-flex items-center gap-1.5', style.text)}>
          <span className={cn('h-1.5 w-1.5 rounded-full', style.dot)} />
          {TONE_LABEL[tone]}
        </span>
      }
      onClose={onClose}
    >
      <div className="space-y-5">
        {advisory && (
          <p className={cn('flex gap-2 rounded-lg px-3 py-2 text-sm', TONE_CLASS[advisory.tone].soft)}>
            <Info className={cn('mt-0.5 h-4 w-4 shrink-0', TONE_CLASS[advisory.tone].text)} />
            <span className="text-foreground">{advisory.text}</span>
          </p>
        )}

        {facts.length > 0 && (
          <dl className="divide-y divide-border rounded-lg border border-border">
            {facts.map((fact, i) => (
              <div key={`${fact.label}-${i}`} className="flex items-baseline justify-between gap-4 px-3 py-2 text-sm">
                <dt className="text-muted-foreground" title={fact.hint}>
                  {fact.label}
                </dt>
                <dd className="flex min-w-0 items-center gap-1.5 text-right font-medium tabular-nums text-foreground">
                  {fact.tone && <span className={cn('h-2 w-2 shrink-0 rounded-full', TONE_CLASS[fact.tone].dot)} />}
                  <span className="break-words">{fact.value}</span>
                </dd>
              </div>
            ))}
          </dl>
        )}

        {view === 'images' && profile?.images?.items.length ? <ImageTable profile={profile} tone={tone} /> : null}

        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {own.length ? 'Pontos desta seção' : 'Nenhum ponto nesta seção'}
          </p>
          {own.length > 0 && <IssueChecklist issues={own} {...decision} />}
        </div>
      </div>
    </Panel>
  )
}

function Panel({
  icon: Icon,
  title,
  subtitle,
  onClose,
  children,
}: {
  icon: typeof ListChecks
  title: string
  subtitle: ReactNode
  onClose?: () => void
  children: ReactNode
}) {
  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-foreground">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            title="Voltar ao que precisa de você"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </header>
      <div className="p-4">{children}</div>
    </section>
  )
}

function ImageTable({ profile, tone }: { profile: FileProfile; tone: keyof typeof TONE_CLASS }) {
  const min = profile.targets?.minPpi
  const bad = tone === 'blocked' ? TONE_CLASS.blocked.text : TONE_CLASS.decision.text
  return (
    <div className="max-h-56 overflow-auto rounded-lg border border-border">
      <table className="w-full text-[13px]">
        <thead className="sticky top-0 bg-muted text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-1.5 font-medium">Pág.</th>
            <th className="px-3 py-1.5 font-medium">Pixels</th>
            <th className="px-3 py-1.5 text-right font-medium">ppi final</th>
            <th className="px-3 py-1.5 font-medium">Cor</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {profile.images!.items.map((img, i) => {
            const low = min !== undefined && img.finalPpi !== null && img.finalPpi < min
            return (
              <tr key={i} className="border-t border-border">
                <td className="px-3 py-1">{img.page}</td>
                <td className="px-3 py-1">
                  {img.px[0]} × {img.px[1]}
                  {img.transparency && <span className="text-muted-foreground"> · transparência</span>}
                </td>
                <td className={cn('px-3 py-1 text-right font-semibold', low ? bad : 'text-foreground')}>{img.finalPpi ?? '—'}</td>
                <td className="px-3 py-1 text-muted-foreground">{img.colorSpace}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
