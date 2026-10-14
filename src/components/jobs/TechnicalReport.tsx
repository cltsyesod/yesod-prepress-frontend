import { InkProportions } from '@/components/jobs/xray/InkProportions'
import { useEffect, useState } from 'react'
import { Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { renderPage, useInspection, usePdf } from '@/components/jobs/stage/usePdf'
import { SECTIONS, sectionApplies, type FileProfile } from '@/lib/xray'
import { factsOf } from '@/lib/xray-facts'
import type { AnalysisIssue } from '@/services/analysisJobsService'
import type { Job } from '@/services/jobsService'
import type { ProductionProfile } from '@/types'

const SEVERITY: Record<string, string> = { critical: 'Impeditivo', warning: 'Revisão', informational: 'Informação' }
const STATUS: Record<string, string> = {
  pending: 'pendente',
  corrected: 'corrigido',
  approved: 'aceito',
  rejected: 'devolvido ao cliente',
  ignored: 'ignorado',
}
const TECH: Record<string, string> = { grafica: 'Gráfica', dtf: 'DTF', dtg: 'DTG' }

/**
 * Relatório técnico do trabalho: o mesmo que a tela mostra (medidas do raio-x,
 * ocorrências e decisões, correções aplicadas, configurações e o que falta confirmar),
 * numa página para imprimir ou salvar em PDF pelo navegador.
 */
export function TechnicalReport({
  open,
  onOpenChange,
  job,
  profile,
  fileName,
  fileProfile,
  issues,
  fixes,
  pdfUrl,
  inspectionUrl,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  job: Job
  profile: ProductionProfile | undefined
  fileName: string
  fileProfile: FileProfile | null
  issues: AnalysisIssue[]
  fixes: { label: string }[]
  pdfUrl: string | null
  inspectionUrl?: string | null
}) {
  const preview = usePreview(open ? pdfUrl : null)
  const insp = useInspection(open ? (inspectionUrl ?? null) : null)
  const whitePlate = insp.inspection?.white?.[0]?.image.src ?? null
  const order = ['critical', 'warning', 'informational']
  const sorted = [...issues].sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity))
  const pending = issues.filter((i) => i.status === 'pending' && i.severity !== 'informational')
  const confirm = fileProfile?.textile?.settings
    ? Object.entries(fileProfile.textile.settings).filter(([, v]) => v === null || v === '').length
    : 0
  const dtg = job.ticket.dtg
  const sections = fileProfile ? SECTIONS.filter((s) => sectionApplies(s.id, fileProfile)) : []
  const counts = order.map((s) => [SEVERITY[s], issues.filter((i) => i.severity === s).length] as const)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
        <DialogHeader className="no-print flex-row items-center justify-between gap-3">
          <DialogTitle>Relatório técnico</DialogTitle>
          <Button size="sm" onClick={() => window.print()}>
            <Printer className="mr-1.5 h-4 w-4" /> Imprimir / salvar PDF
          </Button>
        </DialogHeader>

        <article className="report-printable space-y-5 text-sm">
          <header className="report-section space-y-1 border-b border-border pb-3">
            <h1 className="text-xl font-bold">{job.name}</h1>
            <p className="text-muted-foreground">
              {job.clientName ? `${job.clientName} · ` : ''}
              {fileName} · perfil {profile?.name ?? job.profileId}
              {profile?.technology ? ` (${TECH[profile.technology]})` : ''} · {new Date().toLocaleString('pt-BR')}
            </p>
            <p>
              {pending.length
                ? `${pending.length} ponto(s) aguardando decisão.`
                : 'Sem pendências: pronto para produção.'}{' '}
              {counts.map(([label, n]) => `${label}: ${n}`).join(' · ')}
              {confirm ? ` · ${confirm} configuração(ões) a confirmar` : ''}
            </p>
          </header>

          {(preview || whitePlate) && (
            <section className="report-section grid grid-cols-2 gap-4">
              {preview && (
                <figure className="space-y-1">
                  <img src={preview} alt="Arte" className="max-h-64 w-full rounded border border-border bg-[repeating-conic-gradient(#eee_0_25%,#fff_0_50%)] bg-[length:16px_16px] object-contain" />
                  <figcaption className="text-xs text-muted-foreground">Arte (arquivo de produção)</figcaption>
                </figure>
              )}
              {whitePlate && (
                <figure className="space-y-1">
                  <img src={whitePlate} alt="Base branca" className="max-h-64 w-full rounded border border-border bg-zinc-700 object-contain" style={{ background: '#3f3f46' }} />
                  <figcaption className="text-xs text-muted-foreground">Base branca gerada</figcaption>
                </figure>
              )}
            </section>
          )}

          {fileProfile?.inks?.pages?.length ? (
            <section className="report-section">
              <InkProportions profile={fileProfile} compact />
            </section>
          ) : null}

          {sections.map((s) => {
            const facts = factsOf(s.id, fileProfile!, 'decision')
            if (!facts.length) return null
            return (
              <section key={s.id} className="report-section space-y-1">
                <h2 className="font-semibold">{s.title}</h2>
                <table className="w-full text-xs">
                  <tbody>
                    {facts.map((f, i) => (
                      <tr key={i} className="border-b border-border/50">
                        <td className="w-1/2 py-1 text-muted-foreground">{f.label}</td>
                        <td className="py-1">{f.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )
          })}

          {dtg?.template && (
            <section className="report-section space-y-1">
              <h2 className="font-semibold">Posição na peça (DTG)</h2>
              <p className="text-xs">
                Gabarito {dtg.template}; centro {dtg.centerOffsetMm ?? 0} mm; {dtg.topMm ?? 0} mm do topo da área; tecido{' '}
                {dtg.fabric || 'a confirmar'}; tinta {dtg.ink || 'a confirmar'}; pré-tratamento {dtg.pretreatment || 'a confirmar'}.
              </p>
            </section>
          )}

          <section className="report-section space-y-2">
            <h2 className="font-semibold">Problemas e recomendações</h2>
            {sorted.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma ocorrência.</p>}
            {sorted.map((i) => (
              <div key={i.id} className="report-section rounded border border-border p-2 text-xs">
                <p className="font-medium">
                  {SEVERITY[i.severity] ?? i.severity} · {i.title}
                  {i.page ? ` · pág. ${i.page}` : ''} — {STATUS[i.status] ?? i.status}
                  {i.decision_reason ? ` (${i.decision_reason})` : ''}
                </p>
                {(i.found_value || i.expected_value) && (
                  <p className="text-muted-foreground">
                    Encontrado: {i.found_value || '—'} · Esperado: {i.expected_value || '—'}
                  </p>
                )}
                {i.description && <p>Causa: {i.description}</p>}
                {i.recommendation && <p>Correção sugerida: {i.recommendation}</p>}
              </div>
            ))}
          </section>

          {fixes.length > 0 && (
            <section className="report-section space-y-1">
              <h2 className="font-semibold">Correções aplicadas (cópia; o original foi preservado)</h2>
              <ul className="list-disc pl-5 text-xs">
                {fixes.map((f, i) => (
                  <li key={i}>{f.label}</li>
                ))}
              </ul>
            </section>
          )}

          <footer className="text-[10px] text-muted-foreground">
            Gerado pelo Yesod Prepress (pré-RIP). Medidas no tamanho final; valores "a confirmar" dependem do fabricante
            ou do equipamento e não foram supostos.
          </footer>
        </article>
      </DialogContent>
    </Dialog>
  )
}

/** Miniatura da primeira página, com fundo transparente. */
function usePreview(url: string | null) {
  const { pdf } = usePdf(url)
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    if (!pdf) return
    const view = pdf.pages[0]?.view
    if (!view) return
    const scale = 700 / Math.max(view[2] - view[0], view[3] - view[1])
    renderPage(pdf, 1, scale, undefined, undefined, true)
      .then((canvas) => setSrc(canvas.toDataURL('image/png')))
      .catch(() => null)
  }, [pdf])
  return src
}
