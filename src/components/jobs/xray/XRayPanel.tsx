import { useState, type ReactNode } from 'react'
import { ChevronDown, Wand2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  SECTIONS,
  TONE_CLASS,
  TONE_LABEL,
  finalSize,
  megabytes,
  minBleed,
  mm,
  num,
  scaleLabel,
  size,
  toneOf,
  type FileProfile,
  type SectionId,
  type Tone,
} from '@/lib/xray'
import type { AnalysisIssue } from '@/services/analysisJobsService'

/** Uma linha de fato medido: rótulo, valor e (opcional) a situação daquele valor. */
interface Fact {
  label: string
  value: ReactNode
  tone?: Tone
  hint?: string
}

const SIDES = (b: { top: number; right: number; bottom: number; left: number }) =>
  `${num(b.top)} / ${num(b.right)} / ${num(b.bottom)} / ${num(b.left)} mm`

/** O que cada seção mostra do arquivo (os mesmos números que as regras usam). */
function factsOf(id: SectionId, p: FileProfile, bad: Tone): Fact[] {
  const t = p.targets ?? {}
  const pages = p.pages ?? []
  switch (id) {
    case 'format': {
      const facts: Fact[] = [
        { label: 'Páginas', value: p.document?.pages ?? pages.length },
        { label: 'Formato no arquivo', value: size(pages[0]?.fileMm) },
        { label: 'Escala', value: scaleLabel(t.scale) },
        { label: 'Tamanho final', value: finalSize(p) },
      ]
      if (t.finalWidthMm && t.finalHeightMm) {
        facts.push({ label: 'Ficha pede', value: size([t.finalWidthMm, t.finalHeightMm]) })
      }
      return facts
    }
    case 'bleed': {
      const withTrim = pages.filter((pg) => pg.hasTrimBox).length
      const withBleed = pages.filter((pg) => pg.hasBleedBox).length
      const bleed = minBleed(p)
      const enough = bleed && t.minBleedMm !== undefined ? Math.min(bleed.top, bleed.right, bleed.bottom, bleed.left) >= t.minBleedMm - 0.05 : undefined
      return [
        {
          label: 'Formato final (TrimBox)',
          value: withTrim === pages.length ? 'definido' : withTrim ? `em ${withTrim} de ${pages.length} páginas` : 'não definido',
          tone: withTrim === pages.length ? 'ok' : bad,
        },
        {
          label: 'Área de sangria (BleedBox)',
          value: withBleed === pages.length ? 'definida' : withBleed ? `em ${withBleed} de ${pages.length} páginas` : 'não definida',
          tone: withBleed === pages.length ? 'ok' : bad,
        },
        {
          label: 'Sangria no tamanho final',
          value: bleed ? SIDES(bleed) : '—',
          hint: 'Cima / direita / baixo / esquerda (menor valor entre as páginas)',
          tone: enough === undefined ? undefined : enough ? 'ok' : bad,
        },
        { label: 'Ficha pede', value: t.minBleedMm !== undefined ? `mínimo ${mm(t.minBleedMm)}` : '—' },
      ]
    }
    case 'images': {
      const img = p.images
      if (!img || !img.count) return [{ label: 'Imagens', value: 'nenhuma (arte só vetorial)', tone: 'ok' }]
      const low = t.minPpi && img.minFinalPpi !== null ? img.minFinalPpi < t.minPpi : undefined
      return [
        { label: 'Imagens', value: `${img.count}${img.withTransparency ? ` (${img.withTransparency} com transparência)` : ''}` },
        {
          label: 'Menor resolução no tamanho final',
          value: img.minFinalPpi !== null ? `${num(img.minFinalPpi, 0)} ppi` : '—',
          tone: low === undefined ? undefined : low ? bad : 'ok',
        },
        { label: 'Ficha pede', value: t.minPpi ? `mínimo ${t.minPpi} ppi` : '—' },
        {
          label: 'Espaços de cor',
          value: Object.entries(img.colorSpaces)
            .map(([space, n]) => `${space} ×${n}`)
            .join(' · '),
        },
      ]
    }
    case 'colors': {
      const c = p.colors
      if (!c) return []
      return [
        {
          label: 'Cor dos vetores e textos',
          value: `CMYK ${c.cmykOperators} · RGB ${c.rgbOperators} · Cinza ${c.grayOperators}`,
          hint: 'Quantas operações de pintura usam cada espaço de cor',
          tone: c.rgbOperators > 0 ? 'info' : 'ok',
        },
        {
          label: 'Política de RGB',
          value: t.rgbPolicy === 'cmyk_only' ? 'Somente CMYK (RGB é problema)' : 'O RIP converte o RGB',
        },
        { label: 'Cores especiais', value: c.spots.length ? c.spots.join(', ') : 'nenhuma' },
        {
          label: 'Perfil de saída',
          value: c.outputIntent || 'não declarado',
          tone: c.outputIntent ? (c.outputIntentValid === false ? bad : 'ok') : 'info',
        },
        {
          label: 'Cobertura máxima de tinta',
          value: c.maxInkCoverage ? `${num(c.maxInkCoverage, 0)}%${t.maxInkCoverage ? ` (limite ${t.maxInkCoverage}%)` : ''}` : '—',
          tone: c.maxInkCoverage && t.maxInkCoverage ? (c.maxInkCoverage > t.maxInkCoverage ? bad : 'ok') : undefined,
        },
      ]
    }
    case 'fonts': {
      const f = p.fonts
      if (!f || !f.count) return [{ label: 'Fontes', value: 'nenhuma (textos em curvas ou sem texto)', tone: 'ok' }]
      return [
        {
          label: 'Fontes',
          value: `${f.count}${f.notEmbedded ? ` · ${f.notEmbedded} não incorporada(s)` : ' · todas incorporadas'}`,
          tone: f.notEmbedded ? bad : 'ok',
        },
        ...f.items.slice(0, 6).map((font) => ({
          label: font.name,
          value: font.embedded ? 'incorporada' : 'não incorporada',
          tone: (font.embedded ? 'ok' : bad) as Tone,
        })),
      ]
    }
    case 'finishing': {
      const withDie = pages.filter((pg) => pg.dieLine)
      const c = p.colors
      const magenta = pages.reduce((n, pg) => n + (pg.magentaStrokes ?? 0), 0)
      return [
        {
          label: 'Faca',
          value: withDie.length
            ? `presente${withDie[0].dieLineFinalMm ? ` · ${size(withDie[0].dieLineFinalMm)}` : ''}`
            : 'não encontrada',
          tone: withDie.length ? 'ok' : t.requiresCutLayer ? bad : 'info',
        },
        {
          label: 'Separação de corte',
          value: c?.technicalSpots.length ? c.technicalSpots.join(', ') : '—',
        },
        { label: 'Ficha exige faca', value: t.requiresCutLayer ? 'sim' : 'não' },
        ...(magenta ? [{ label: 'Linhas em 100% magenta', value: `${magenta} (podem ser faca)`, tone: 'info' as Tone }] : []),
        { label: 'Camadas', value: p.layers?.length ? p.layers.join(', ') : 'nenhuma' },
      ]
    }
    case 'structure': {
      const d = p.document ?? {}
      return [
        {
          label: 'Integridade',
          value: d.structureOk && d.rendersOk ? 'íntegro (abre e renderiza)' : 'com problemas',
          tone: d.structureOk && d.rendersOk ? 'ok' : 'blocked',
        },
        { label: 'Versão', value: `PDF ${d.pdfVersion || '—'}${d.pdfx ? ` · ${d.pdfx}` : ''}` },
        { label: 'Criado em', value: [d.creator, d.producer].filter(Boolean).join(' · ') || '—' },
        { label: 'Tamanho do arquivo', value: megabytes(d.fileBytes) },
        ...(d.encrypted ? [{ label: 'Protegido', value: 'sim (com senha)', tone: bad as Tone }] : []),
      ]
    }
  }
}

/**
 * Raio-X: cada característica do arquivo em uma seção com a cor da sua situação, os
 * números medidos (ao lado do que a ficha pede) e as ocorrências daquela seção.
 */
export function XRayPanel({
  profile,
  issues,
  onOpenIssue,
}: {
  profile: FileProfile
  issues: AnalysisIssue[]
  onOpenIssue: (issue: AnalysisIssue) => void
}) {
  return (
    <div className="space-y-2.5">
      {SECTIONS.map((section) => {
        const own = issues.filter((i) => section.codes.includes(i.rule_code))
        return <SectionCard key={section.id} id={section.id} title={section.title} profile={profile} issues={own} onOpenIssue={onOpenIssue} />
      })}
    </div>
  )
}

function SectionCard({
  id,
  title,
  profile,
  issues,
  onOpenIssue,
}: {
  id: SectionId
  title: string
  profile: FileProfile
  issues: AnalysisIssue[]
  onOpenIssue: (issue: AnalysisIssue) => void
}) {
  const tone = toneOf(issues)
  const style = TONE_CLASS[tone]
  // Seções com problema abrem sozinhas; as conferidas ficam fechadas.
  const [open, setOpen] = useState(tone === 'blocked' || tone === 'decision')
  // Valores fora do pedido usam a cor da seção (vermelho se bloqueia, amarelo se é decisão).
  const facts = factsOf(id, profile, tone === 'blocked' ? 'blocked' : 'decision')
  const pending = issues.filter((i) => i.status === 'pending' && i.severity !== 'informational').length

  return (
    <section className={cn('overflow-hidden rounded-lg border bg-card', style.border)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn('flex w-full items-center gap-2.5 px-3 py-2 text-left', style.soft)}
      >
        <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', style.dot)} />
        <span className="flex-1 text-sm font-semibold text-foreground">{title}</span>
        <span className={cn('text-xs font-medium', style.text)}>
          {TONE_LABEL[tone]}
          {pending ? ` · ${pending}` : ''}
        </span>
        <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="space-y-2 px-3 py-2.5">
          <dl className="grid grid-cols-[minmax(0,44%)_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px]">
            {facts.map((fact, i) => (
              <div key={`${fact.label}-${i}`} className="contents">
                <dt className="truncate text-muted-foreground" title={fact.hint ?? fact.label}>
                  {fact.label}
                </dt>
                <dd className="flex min-w-0 items-center gap-1.5 text-foreground">
                  {fact.tone && <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', TONE_CLASS[fact.tone].dot)} />}
                  <span className="min-w-0 break-words tabular-nums">{fact.value}</span>
                </dd>
              </div>
            ))}
          </dl>
          {id === 'images' && !!profile.images?.items.length && <ImageList profile={profile} bad={tone === 'blocked' ? 'blocked' : 'decision'} />}
          {issues.length > 0 && (
            <ul className="space-y-1 border-t border-border pt-2">
              {issues.map((issue) => (
                <IssueBullet key={issue.id} issue={issue} onOpen={() => onOpenIssue(issue)} />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

const SEVERITY_TONE: Record<string, Tone> = { critical: 'blocked', warning: 'decision', informational: 'info' }

function IssueBullet({ issue, onOpen }: { issue: AnalysisIssue; onOpen: () => void }) {
  const tone: Tone = issue.status === 'pending' ? (SEVERITY_TONE[issue.severity] ?? 'info') : 'resolved'
  return (
    <li>
      <button type="button" onClick={onOpen} className="flex w-full items-start gap-2 rounded px-1 py-0.5 text-left text-[13px] hover:bg-accent/60">
        <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', TONE_CLASS[tone].dot)} />
        <span className="min-w-0 flex-1">
          <span className={cn('font-medium', issue.status !== 'pending' ? 'text-muted-foreground line-through' : 'text-foreground')}>
            {issue.title}
          </span>
          {issue.found_value && <span className="text-muted-foreground"> — {issue.found_value}</span>}
        </span>
        {issue.fix && issue.status === 'pending' && <Wand2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-label="Tem correção automática" />}
      </button>
    </li>
  )
}

function ImageList({ profile, bad }: { profile: FileProfile; bad: Tone }) {
  const min = profile.targets?.minPpi
  const items = profile.images?.items ?? []
  return (
    <div className="max-h-40 overflow-auto rounded border border-border">
      <table className="w-full text-[12px]">
        <thead className="sticky top-0 bg-muted text-left text-muted-foreground">
          <tr>
            <th className="px-2 py-1 font-medium">Pág.</th>
            <th className="px-2 py-1 font-medium">Pixels</th>
            <th className="px-2 py-1 text-right font-medium">ppi final</th>
            <th className="px-2 py-1 font-medium">Cor</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {items.map((img, i) => {
            const low = min !== undefined && img.finalPpi !== null && img.finalPpi < min
            return (
              <tr key={i} className="border-t border-border">
                <td className="px-2 py-0.5">{img.page}</td>
                <td className="px-2 py-0.5">
                  {img.px[0]} × {img.px[1]}
                  {img.transparency ? ' · transp.' : ''}
                </td>
                <td className={cn('px-2 py-0.5 text-right font-medium', low ? TONE_CLASS[bad].text : 'text-foreground')}>
                  {img.finalPpi ?? '—'}
                </td>
                <td className="px-2 py-0.5">{img.colorSpace}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
