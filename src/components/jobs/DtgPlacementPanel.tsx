import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { renderPage, usePdf } from '@/components/jobs/stage/usePdf'
import { overflowText, placeArt, placementLimits, type DtgTemplate } from '@/domain/dtg/placement'
import type { TextilePage } from '@/lib/xray'
import type { JobTicket } from '@/services/jobsService'
import type { ProductionProfile } from '@/types'

const keyOf = (t: DtgTemplate) => `${t.name}${t.size ? ` · ${t.size}` : ''}`
const mm = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })

/**
 * DTG: escolhe o gabarito da peça, posiciona a arte em mm e mostra a peça com a arte.
 * O tamanho da arte é o medido na análise (tamanho final). A silhueta da peça é só
 * ilustração; as medidas que valem são as da área imprimível do gabarito.
 */
export function DtgPlacementPanel({
  profile,
  ticket,
  pdfUrl,
  page,
  measured,
  onSave,
}: {
  profile: ProductionProfile
  ticket: JobTicket
  pdfUrl: string | null
  page: number
  measured: TextilePage | undefined
  onSave: (ticket: JobTicket) => Promise<void>
}) {
  const templates = profile.textile?.templates?.filter((t) => t.name && t.areaWidthMm > 0 && t.areaHeightMm > 0) ?? []
  const [draft, setDraft] = useState(ticket.dtg ?? {})
  const [saving, setSaving] = useState(false)
  useEffect(() => setDraft(ticket.dtg ?? {}), [ticket.dtg])
  const template = templates.find((t) => keyOf(t) === draft.template)
  const art = measured?.artSizeMm ? { widthMm: measured.artSizeMm[0], heightMm: measured.artSizeMm[1] } : null
  const placed = template && art ? placeArt(template, art, draft) : null
  const limits = template && art ? placementLimits(template, art) : null
  const thumb = useArtThumbnail(pdfUrl, page, measured)
  const set = (patch: Partial<typeof draft>) => setDraft((d) => ({ ...d, ...patch }))
  const num = (v: string) => (v === '' ? undefined : Number(v))

  const save = async () => {
    setSaving(true)
    try {
      await onSave({
        ...ticket,
        dtg: draft,
        // A área do gabarito vale para a conferência do analisador (ficha > perfil).
        textile: template
          ? { ...ticket.textile, printWidthMm: template.areaWidthMm, printHeightMm: template.areaHeightMm }
          : ticket.textile,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div>
        <h3 className="text-sm font-semibold">Posição na peça (DTG)</h3>
        <p className="text-xs text-muted-foreground">Medidas em mm no tamanho final, a partir do topo da área imprimível.</p>
      </div>
      {templates.length === 0 ? (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          O perfil não tem gabaritos de peça. Cadastre em Perfis de produção → DTG.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1">
            <Label className="text-xs">Gabarito</Label>
            <Select value={draft.template ?? ''} onValueChange={(v) => set({ template: v })}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="Escolher a peça" />
              </SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={keyOf(t)} value={keyOf(t)} className="text-xs">
                    {keyOf(t)} — {mm(t.areaWidthMm)} × {mm(t.areaHeightMm)} mm
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Do centro (mm, + direita)</Label>
            <Input className="h-8 text-sm" type="number" step="any" value={draft.centerOffsetMm ?? ''} placeholder="0" onChange={(e) => set({ centerOffsetMm: num(e.target.value) })} />
            {limits && <p className="text-[10px] text-muted-foreground">cabe até ±{mm(limits.maxOffsetMm)}</p>}
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Do topo da área (mm)</Label>
            <Input className="h-8 text-sm" type="number" step="any" min={0} value={draft.topMm ?? ''} placeholder="0" onChange={(e) => set({ topMm: num(e.target.value) })} />
            {limits && <p className="text-[10px] text-muted-foreground">cabe até {mm(limits.maxTopMm)}</p>}
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Cor da peça</Label>
            <input type="color" className="h-8 w-full cursor-pointer rounded border border-border bg-transparent" value={draft.garmentColor ?? '#1f2937'} onChange={(e) => set({ garmentColor: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Tecido (composição)</Label>
            <Input className="h-8 text-sm" placeholder="ex.: 100% algodão" value={draft.fabric ?? ''} onChange={(e) => set({ fabric: e.target.value || undefined })} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Tinta</Label>
            <Input className="h-8 text-sm" placeholder={profile.textile?.ink || 'confirmar'} value={draft.ink ?? ''} onChange={(e) => set({ ink: e.target.value || undefined })} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Pré-tratamento</Label>
            <Input className="h-8 text-sm" placeholder={profile.textile?.pretreatment || 'confirmar com o fabricante'} value={draft.pretreatment ?? ''} onChange={(e) => set({ pretreatment: e.target.value || undefined })} />
          </div>
        </div>
      )}

      {template && (
        <GarmentPreview template={template} placed={placed} color={draft.garmentColor ?? '#1f2937'} thumb={thumb} />
      )}
      {template && !art && <p className="text-xs text-muted-foreground">Reanalise o arquivo para medir o tamanho da arte.</p>}
      {placed && (
        <p className={placed.fits ? 'text-xs text-emerald-700 dark:text-emerald-400' : 'text-xs text-red-600 dark:text-red-400'}>
          Arte {mm(placed.width)} × {mm(placed.height)} mm{' '}
          {placed.fits ? 'dentro da área imprimível.' : `fora da área: ${overflowText(placed).join(', ')}.`}
        </p>
      )}
      {templates.length > 0 && (
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? 'Salvando…' : 'Salvar na ficha'}
        </Button>
      )}
    </section>
  )
}

function GarmentPreview({
  template,
  placed,
  color,
  thumb,
}: {
  template: DtgTemplate
  placed: ReturnType<typeof placeArt> | null
  color: string
  thumb: string | null
}) {
  // Silhueta ilustrativa em volta da área (proporção fixa da área, não é medida da peça).
  const w = template.areaWidthMm
  const h = template.areaHeightMm
  const bodyW = w * 1.7
  const left = -(bodyW - w) / 2
  const top = -h * 0.28
  const sleeve = w * 0.45
  const path = [
    `M ${left} ${top + h * 0.05}`,
    `L ${left - sleeve} ${top + h * 0.35}`,
    `L ${left - sleeve * 0.55} ${top + h * 0.55}`,
    `L ${left} ${top + h * 0.38}`,
    `L ${left} ${h * 1.25}`,
    `L ${left + bodyW} ${h * 1.25}`,
    `L ${left + bodyW} ${top + h * 0.38}`,
    `L ${left + bodyW + sleeve * 0.55} ${top + h * 0.55}`,
    `L ${left + bodyW + sleeve} ${top + h * 0.35}`,
    `L ${left + bodyW} ${top + h * 0.05}`,
    `L ${w / 2 + w * 0.22} ${top}`,
    `Q ${w / 2} ${top + h * 0.14} ${w / 2 - w * 0.22} ${top}`,
    'Z',
  ].join(' ')
  const pad = sleeve + 10
  const box = `${left - pad} ${top - 10} ${bodyW + 2 * pad} ${h * 1.25 - top + 20}`
  return (
    <svg viewBox={box} className="w-full rounded-lg bg-muted" role="img" aria-label="Prévia da arte na peça">
      <path d={path} fill={color} stroke="currentColor" strokeOpacity={0.25} strokeWidth={2} />
      <rect x={0} y={0} width={w} height={h} fill="none" stroke="#38bdf8" strokeWidth={2} strokeDasharray="8 6" />
      {placed && (
        <>
          {thumb ? (
            <image href={thumb} x={placed.x} y={placed.y} width={placed.width} height={placed.height} preserveAspectRatio="none" />
          ) : (
            <rect x={placed.x} y={placed.y} width={placed.width} height={placed.height} fill="#94a3b8" fillOpacity={0.6} />
          )}
          <rect
            x={placed.x}
            y={placed.y}
            width={placed.width}
            height={placed.height}
            fill="none"
            stroke={placed.fits ? '#10b981' : '#ef4444'}
            strokeWidth={2}
          />
        </>
      )}
    </svg>
  )
}

/** A arte recortada nos limites da tinta, com fundo transparente, para a prévia. */
function useArtThumbnail(url: string | null, page: number, measured: TextilePage | undefined) {
  const { pdf } = usePdf(url)
  const [thumb, setThumb] = useState<string | null>(null)
  const crop = useMemo(() => {
    if (!measured?.art_mm) return null
    const [bw, bh] = measured.box_mm
    const [x0, y0, x1, y1] = measured.art_mm
    return { left: x0 / bw, top: 1 - y1 / bh, width: (x1 - x0) / bw, height: (y1 - y0) / bh }
  }, [measured])
  useEffect(() => {
    if (!pdf || !crop) return
    let cancelled = false
    const view = pdf.pages[page - 1]?.view
    if (!view) return
    const scale = 900 / Math.max(view[2] - view[0], view[3] - view[1])
    renderPage(pdf, page, scale, undefined, undefined, true)
      .then((canvas) => {
        if (cancelled) return
        const out = document.createElement('canvas')
        out.width = Math.max(1, Math.round(crop.width * canvas.width))
        out.height = Math.max(1, Math.round(crop.height * canvas.height))
        out
          .getContext('2d')!
          .drawImage(canvas, crop.left * canvas.width, crop.top * canvas.height, out.width, out.height, 0, 0, out.width, out.height)
        setThumb(out.toDataURL('image/png'))
      })
      .catch(() => null)
    return () => {
      cancelled = true
    }
  }, [pdf, page, crop])
  return thumb
}
