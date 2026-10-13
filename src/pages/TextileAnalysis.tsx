import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import {
  brl,
  compare,
  costDtf,
  costDtg,
  type DtfParams,
  type DtgParams,
  type MethodResult,
  type Order,
} from '@/domain/textile/costing'
import { profileService } from '@/services/profileService'
import type { ProductionProfile } from '@/types'

type Costs = DtfParams & DtgParams
type Field<T> = [keyof T, string]

const ORDER_FIELDS: Field<Order>[] = [
  ['quantity', 'Quantidade de peças'],
  ['designs', 'Estampas diferentes'],
  ['artWidthMm', 'Largura da arte (mm)'],
  ['artHeightMm', 'Altura da arte (mm)'],
  ['garmentCost', 'Custo da peça (R$)'],
  ['salePrice', 'Preço de venda por peça (R$)'],
  ['laborPerHour', 'Custo da hora (R$)'],
]
const DTF_FIELDS: Field<DtfParams>[] = [
  ['filmWidthMm', 'Largura útil do filme (mm)'],
  ['gapMm', 'Espaçamento (mm)'],
  ['filmCostPerM', 'Filme (R$/m)'],
  ['colorInkMlPerM2', 'Tinta colorida (ml/m²)'],
  ['colorInkCostPerMl', 'Tinta colorida (R$/ml)'],
  ['whiteInkMlPerM2', 'Tinta branca (ml/m²)'],
  ['whiteInkCostPerMl', 'Tinta branca (R$/ml)'],
  ['powderCostPerM2', 'Pó (R$/m²)'],
  ['printMinutesPerM', 'Impressão (min/m)'],
  ['pressSecondsPerPiece', 'Prensa (s/peça)'],
  ['setupMinutes', 'Preparação do pedido (min)'],
]
const DTG_FIELDS: Field<DtgParams>[] = [
  ['areaWidthMm', 'Área imprimível: largura (mm)'],
  ['areaHeightMm', 'Área imprimível: altura (mm)'],
  ['colorInkMlPerM2', 'Tinta colorida (ml/m²)'],
  ['colorInkCostPerMl', 'Tinta colorida (R$/ml)'],
  ['whiteInkMlPerM2', 'Tinta branca (ml/m²)'],
  ['whiteInkCostPerMl', 'Tinta branca (R$/ml)'],
  ['pretreatCostPerPiece', 'Pré-tratamento (R$/peça)'],
  ['printSecondsPerPiece', 'Impressão (s/peça)'],
  ['cureSecondsPerPiece', 'Cura (s/peça)'],
  ['setupMinutes', 'Preparação do pedido (min)'],
]

const numOrUndef = (v: string) => (v === '' ? undefined : Number(v.replace(',', '.')))

/** Custos do método guardados no perfil (empresa inteira), com o que o perfil já tem. */
function costsOf(profile: ProductionProfile | undefined, method: 'dtf' | 'dtg'): Costs {
  const t = profile?.textile ?? {}
  const saved = ((t as Record<string, unknown>).costs ?? {}) as Costs
  return method === 'dtf'
    ? { filmWidthMm: t.printWidthMm, gapMm: t.gapMm, ...saved }
    : { areaWidthMm: t.printWidthMm, areaHeightMm: t.printHeightMm, ...saved }
}

/**
 * Análise do pedido em DTF e em DTG: consumo, tempo, custo por peça, margem e ponto de
 * equilíbrio, só com os números informados. Mostra premissas, o que falta e a confiança;
 * a comparação vale para este pedido, nunca como regra.
 */
export default function TextileAnalysisPage() {
  const [, refresh] = useState(0)
  const profiles = profileService.getProfilesSync()
  const dtfProfiles = profiles.filter((p) => p.technology === 'dtf')
  const dtgProfiles = profiles.filter((p) => p.technology === 'dtg')
  const [dtfId, setDtfId] = useState(dtfProfiles[0]?.id)
  const [dtgId, setDtgId] = useState(dtgProfiles[0]?.id)
  const dtfProfile = dtfProfiles.find((p) => p.id === dtfId)
  const dtgProfile = dtgProfiles.find((p) => p.id === dtgId)
  const [order, setOrder] = useState<Order>({ quantity: 0, designs: 1, artWidthMm: 0, artHeightMm: 0, darkGarment: true })
  const [coveragePct, setCoveragePct] = useState<number | undefined>()
  const [dtf, setDtf] = useState<Costs>(() => costsOf(dtfProfile, 'dtf'))
  const [dtg, setDtg] = useState<Costs>(() => costsOf(dtgProfile, 'dtg'))

  const ready = order.quantity > 0 && order.artWidthMm > 0 && order.artHeightMm > 0
  const fullOrder = { ...order, coverage: coveragePct === undefined ? undefined : coveragePct / 100 }
  const results = useMemo(() => {
    if (!ready) return null
    const a = costDtf(fullOrder, dtf)
    const b = costDtg(fullOrder, dtg)
    return { dtf: a, dtg: b, comparison: compare(a, b) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, order, coveragePct, dtf, dtg])

  const saveCosts = async (profile: ProductionProfile | undefined, costs: Costs) => {
    if (!profile) return
    const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = profile
    await profileService.updateProfile(profile.id, {
      ...rest,
      textile: { ...profile.textile, costs } as ProductionProfile['textile'],
    })
    refresh((n) => n + 1)
    toast({ title: `Custos salvos no perfil "${profile.name}"` })
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">DTF × DTG</h1>
        <p className="text-sm text-muted-foreground">
          Custo, tempo e consumo de um pedido nos dois processos, só com os seus números. O que faltar não é suposto:
          aparece como ausente e baixa a confiança.
        </p>
      </div>

      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">Pedido</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {ORDER_FIELDS.map(([key, label]) => (
            <NumberField
              key={key}
              label={label}
              value={order[key] as number | undefined}
              onChange={(v) => setOrder((o) => ({ ...o, [key]: v ?? (key === 'designs' ? 1 : key === 'quantity' || key.startsWith('art') ? 0 : undefined) }))}
            />
          ))}
          <NumberField label="Cobertura de tinta (%)" value={coveragePct} onChange={setCoveragePct} hint="vazio = área toda (premissa)" />
          <div className="space-y-1">
            <Label className="text-xs">Tecido</Label>
            <Input className="h-8 text-sm" placeholder="ex.: 100% algodão" value={order.fabric ?? ''} onChange={(e) => setOrder((o) => ({ ...o, fabric: e.target.value || undefined }))} />
          </div>
          <label className="flex items-center gap-2 pt-5 text-sm">
            <Switch checked={order.darkGarment} onCheckedChange={(darkGarment) => setOrder((o) => ({ ...o, darkGarment }))} />
            Peça escura (precisa de branco)
          </label>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <MethodCard
          title="DTF"
          profiles={dtfProfiles}
          profileId={dtfId}
          onProfile={(id) => {
            setDtfId(id)
            setDtf(costsOf(dtfProfiles.find((p) => p.id === id), 'dtf'))
          }}
          fields={DTF_FIELDS as Field<Costs>[]}
          costs={dtf}
          onChange={setDtf}
          onSave={() => saveCosts(dtfProfile, dtf)}
          result={results?.dtf}
        />
        <MethodCard
          title="DTG"
          profiles={dtgProfiles}
          profileId={dtgId}
          onProfile={(id) => {
            setDtgId(id)
            setDtg(costsOf(dtgProfiles.find((p) => p.id === id), 'dtg'))
          }}
          fields={DTG_FIELDS as Field<Costs>[]}
          costs={dtg}
          onChange={setDtg}
          onSave={() => saveCosts(dtgProfile, dtg)}
          result={results?.dtg}
        />
      </div>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">Comparação para este pedido</h2>
        {!results ? (
          <p className="mt-1 text-sm text-muted-foreground">Informe a quantidade e o tamanho da arte.</p>
        ) : (
          <div className="mt-1 space-y-1 text-sm">
            <p>{results.comparison.text}</p>
            <p className="text-xs text-muted-foreground">Confiança: {results.comparison.confidence}</p>
          </div>
        )}
      </section>
    </div>
  )
}

function NumberField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string
  value: number | undefined
  onChange: (v: number | undefined) => void
  hint?: string
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input className="h-8 text-sm tabular-nums" inputMode="decimal" value={value ?? ''} placeholder="informar" onChange={(e) => onChange(numOrUndef(e.target.value))} />
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

function MethodCard({
  title,
  profiles,
  profileId,
  onProfile,
  fields,
  costs,
  onChange,
  onSave,
  result,
}: {
  title: string
  profiles: ProductionProfile[]
  profileId: string | undefined
  onProfile: (id: string) => void
  fields: Field<Costs>[]
  costs: Costs
  onChange: (c: Costs) => void
  onSave: () => void
  result: MethodResult | undefined
}) {
  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {profiles.length > 0 ? (
          <Select value={profileId} onValueChange={onProfile}>
            <SelectTrigger className="h-8 w-56 text-xs">
              <SelectValue placeholder="Perfil" />
            </SelectTrigger>
            <SelectContent>
              {profiles.map((p) => (
                <SelectItem key={p.id} value={p.id} className="text-xs">
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="text-xs text-muted-foreground">Sem perfil {title}: os valores não serão salvos.</span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {fields.map(([key, label]) => (
          <NumberField key={key} label={label} value={costs[key]} onChange={(v) => onChange({ ...costs, [key]: v })} />
        ))}
      </div>
      {profileId && (
        <Button size="sm" variant="outline" onClick={onSave}>
          Salvar custos no perfil
        </Button>
      )}
      {result && <ResultView result={result} />}
    </section>
  )
}

function ResultView({ result }: { result: MethodResult }) {
  const tone = { alta: 'text-emerald-700 dark:text-emerald-400', média: 'text-amber-600 dark:text-amber-400', baixa: 'text-red-600 dark:text-red-400' }
  return (
    <div className="space-y-2 border-t border-border pt-3 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-lg font-semibold tabular-nums">{result.perUnit !== null ? `${brl(result.perUnit)} / peça` : 'Custo não calculado'}</span>
        {result.orderTotal !== null && <span className="text-muted-foreground tabular-nums">pedido {brl(result.orderTotal)}</span>}
        {result.margin !== null && (
          <span className={cn('tabular-nums', result.margin >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
            margem {brl(result.margin)} / peça
          </span>
        )}
        {result.breakEven !== null && <span className="text-muted-foreground">equilíbrio a partir de {result.breakEven} peças</span>}
      </div>
      <p className={cn('text-xs', tone[result.confidence])}>Confiança: {result.confidence}</p>
      {result.parts.length > 0 && (
        <table className="w-full text-xs">
          <tbody>
            {result.parts.map((p) => (
              <tr key={p.label} className="border-b border-border/50">
                <td className="py-1 text-muted-foreground">{p.label}</td>
                <td className="py-1 text-right tabular-nums">{brl(p.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {[...result.facts, ...result.notes].map((f) => (
        <p key={f} className="text-xs text-muted-foreground">
          {f}
        </p>
      ))}
      {result.missing.length > 0 && (
        <p className="text-xs">
          <span className="font-medium">Falta informar:</span> {result.missing.join(', ')}.
        </p>
      )}
    </div>
  )
}
