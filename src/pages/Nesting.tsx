import { isTextile, type Scope } from '@/lib/scope'
import { Link } from 'react-router-dom'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, LayoutGrid, Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PdfPreview } from '@/components/jobs/PdfPreview'
import { useRealtime } from '@/hooks/use-realtime'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/supabase/errors'
import { cn } from '@/lib/utils'
import { jobsService, type Job } from '@/services/jobsService'
import {
  NESTING_ACTIVE,
  nestingService,
  offcutService,
  type MaterialOffcut,
  type NestingItem,
  type NestingMarks,
  type NestingParams,
  type NestingRun,
  type ManualPlacement,
} from '@/services/nestingService'
import { SheetEditor } from '@/components/nesting/SheetEditor'
import { profileService } from '@/services/profileService'

const ROTATIONS = [
  { value: '0', label: 'Sem giro' },
  { value: '180', label: 'Só 180° (mantém o sentido do material)' },
  { value: '90', label: 'A cada 90°' },
  { value: '45', label: 'A cada 45°' },
  { value: '22.5', label: 'A cada 22,5°' },
  { value: '11.25', label: 'A cada 11,25°' },
]

const STORAGE_KEY = 'yesod.nesting.params'

/** Faixa de identificação montada na hora do envio (trabalhos, material, data). */
const AUTO_SLUG = 'auto'

const NO_MARKS: NestingMarks = {
  registration: 'none',
  shape: 'square',
  sizeMm: 3,
  distanceMm: 5,
  spacingMm: 500,
  cropMarks: false,
  slug: '',
}

// Último material usado: conveniência local do operador (nada é fixo no sistema).
function loadParams(): NestingParams {
  const empty: NestingParams = {
    material: { widthMm: 0, marginMm: 0, gapMm: 0 },
    rotation: { allow: true, stepDegrees: 90 },
    cutLines: { add: true, name: 'CutContour' },
    marks: NO_MARKS,
  }
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    // O retalho escolhido vale só para aquela montagem.
    return saved ? { ...empty, ...saved, marks: { ...NO_MARKS, ...saved.marks }, offcutId: undefined } : empty
  } catch {
    return empty
  }
}

const numberOr = (value: string, fallback: number) => {
  const n = Number(value.replace(',', '.'))
  return value.trim() === '' || !Number.isFinite(n) ? fallback : n
}

export default function NestingPage({ scope = 'print' }: { scope?: Scope }) {
  const profiles = profileService.getProfilesSync()
  const dtfProfiles = profiles.filter((p) => p.technology === 'dtf')
  const [dtfId, setDtfId] = useState<string>()
  const [jobs, setJobs] = useState<Job[]>([])
  const [selected, setSelected] = useState<Record<string, number>>({})
  const [params, setParams] = useState<NestingParams>(loadParams)
  const [isSheet, setIsSheet] = useState(!!loadParams().material.lengthMm)
  const [submitting, setSubmitting] = useState(false)
  const [runs, setRuns] = useState<NestingRun[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [outputUrl, setOutputUrl] = useState('')
  const [page, setPage] = useState(1)
  const [offcuts, setOffcuts] = useState<MaterialOffcut[]>([])

  const loadOffcuts = useCallback(() => {
    offcutService.listAvailable().then(setOffcuts).catch(() => setOffcuts([]))
  }, [])
  useEffect(loadOffcuts, [loadOffcuts])

  const marks = params.marks ?? NO_MARKS
  const setMarks = (patch: Partial<NestingMarks>) =>
    setParams((p) => ({ ...p, marks: { ...(p.marks ?? NO_MARKS), ...patch } }))
  const setCut = (patch: Partial<NestingParams['cutLines']>) =>
    setParams((p) => ({ ...p, cutLines: { ...p.cutLines, ...patch } }))

  const loadRuns = useCallback(async () => {
    try {
      const all = await nestingService.listRuns()
      // Folhas de DTF ficam no módulo têxtil; as demais, na Montagem.
      setRuns(all.filter((run) => (scope === 'textile') === !!run.params?.dtfProfileId))
    } catch (err) {
      toast({ title: 'Não foi possível carregar as montagens', description: getErrorMessage(err), variant: 'destructive' })
    }
  }, [])

  useEffect(() => {
    jobsService.listJobs().then(setJobs).catch(() => setJobs([]))
    loadRuns()
  }, [loadRuns])

  useRealtime('nesting_runs', () => loadRuns())

  const current = runs.find((run) => run.id === currentId) ?? runs[0] ?? null

  useEffect(() => {
    setOutputUrl('')
    setPage(1)
    if (current?.status === 'completed') {
      nestingService.outputUrl(current).then(setOutputUrl).catch(() => setOutputUrl(''))
    }
  }, [current?.id, current?.status]) // eslint-disable-line react-hooks/exhaustive-deps

  const setMaterial = (patch: Partial<NestingParams['material']>) =>
    setParams((p) => ({
      ...p,
      material: { ...p.material, ...patch },
      // Medidas digitadas à mão deixam de ser as do retalho escolhido.
      offcutId: 'widthMm' in patch || 'lengthMm' in patch ? undefined : p.offcutId,
    }))

  const fillOn = params.fill?.enabled === true
  // Com preenchimento: quais trabalhos podem receber cópias além do mínimo (padrão: todos).
  const [fillFlags, setFillFlags] = useState<Record<string, boolean>>({})
  const chosen = useMemo(() => jobs.filter((job) => job.id in selected), [jobs, selected])
  // Folha de DTF: só trabalhos com perfil DTF; cada um precisa da base branca antes de montar
  // (quando o perfil diz que é o sistema que gera o branco).
  const [whiteDone, setWhiteDone] = useState<Set<string>>(new Set())
  const profileOf = (job: Job) => profiles.find((p) => p.id === job.profileId)
  // Cada módulo só vê os seus trabalhos: gráfica aqui, DTF na folha do módulo têxtil.
  const listed =
    scope === 'textile'
      ? jobs.filter((job) => profileOf(job)?.technology === 'dtf')
      : jobs.filter((job) => !isTextile(profileOf(job)?.technology))
  // Módulo têxtil: a folha já abre com o primeiro perfil DTF.
  useEffect(() => {
    if (scope === 'textile' && !dtfId && dtfProfiles[0]) applyDtf(dtfProfiles[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, dtfId, dtfProfiles.length])
  const needsWhite = (job: Job) => profileOf(job)?.textile?.whiteMode === 'generate' && !whiteDone.has(job.id)
  const dtfJobIds = dtfId ? listed.map((job) => job.id).join(',') : ''
  useEffect(() => {
    if (!dtfJobIds) return
    jobsService
      .withWhiteBase(dtfJobIds.split(','))
      .then(setWhiteDone)
      .catch(() => setWhiteDone(new Set()))
  }, [dtfJobIds])
  const lacking = dtfId ? chosen.filter(needsWhite) : []
  const problem =
    (lacking.length ? `Gere a base branca antes de montar: ${lacking.map((j) => j.name).join(', ')}.` : '') ||
    materialProblem(params, isSheet) ||
    (fillOn && !isSheet && !(params.fill?.rollLengthMm && params.fill.rollLengthMm > 0)
      ? 'Informe quanto do rolo usar (mm) para o sistema preencher.'
      : '') ||
    (fillOn && chosen.length > 0 && !chosen.some((job) => fillFlags[job.id] !== false || (selected[job.id] ?? 0) > 0)
      ? 'Marque "preencher" em ao menos um trabalho, ou dê um mínimo.'
      : '') ||
    (!fillOn && chosen.some((job) => !(selected[job.id] > 0)) ? 'Informe a quantidade de cada trabalho.' : '')
  const canSubmit = chosen.length > 0 && !problem

  const submit = async () => {
    setSubmitting(true)
    try {
      const finalParams: NestingParams = {
        ...params,
        material: { ...params.material, lengthMm: isSheet ? params.material.lengthMm : undefined },
        offcutId: isSheet ? params.offcutId : undefined,
        fill: fillOn ? params.fill : undefined,
      }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(finalParams))
      } catch {
        /* sem armazenamento local: segue sem lembrar o material */
      }
      // Cada trabalho entra com o arquivo principal e os parâmetros da sua ficha/perfil.
      const items: NestingItem[] = []
      for (const job of chosen) {
        const { primary } = await jobsService.getFiles(job.id)
        if (!primary) throw new Error(`"${job.name}" não tem arquivo.`)
        const profile = profiles.find((p) => p.id === job.profileId)
        const cutName = profile?.cutLayerName?.trim()
        items.push({
          projectId: job.id,
          fileId: primary.id,
          label: job.name,
          quantity: selected[job.id] ?? 0,
          fill: fillOn ? fillFlags[job.id] !== false : undefined,
          fileScale: job.ticket.fileScale || profile?.scale || 1,
          bleedMm: job.ticket.minBleed ?? profile?.minBleed ?? 0,
          cutNames: cutName ? [cutName, 'CutContour', 'Corte', 'Cut'] : undefined,
        })
      }
      const name = chosen.map((job) => job.name).join(', ').slice(0, 120)
      if (finalParams.marks?.slug === AUTO_SLUG) {
        // Identificação automática: trabalhos, material e data.
        const size = `${params.material.widthMm}${isSheet ? ` × ${params.material.lengthMm}` : ''} mm`
        finalParams.marks = {
          ...finalParams.marks,
          slug: [name, size, new Date().toLocaleDateString('pt-BR')].join(' · ').slice(0, 200),
        }
      }
      const id = await nestingService.create(name, finalParams, items)
      if (finalParams.offcutId) {
        await offcutService.markUsed(finalParams.offcutId).catch(() => null)
        setParams((p) => ({ ...p, offcutId: undefined }))
        loadOffcuts()
      }
      setCurrentId(id)
      await loadRuns()
    } catch (err) {
      toast({ title: 'Não foi possível montar', description: getErrorMessage(err), variant: 'destructive' })
      await loadRuns()
    }
    setSubmitting(false)
  }

  // Completa a folha: monta de novo com as cópias que o sistema calculou que ainda cabem.
  const complete = async (run: NestingRun, fileId: string, extra: number) => {
    setSubmitting(true)
    try {
      const items = run.items.map((item) =>
        item.fileId === fileId ? { ...item, quantity: item.quantity + extra } : item,
      )
      const changed = items.find((item) => item.fileId === fileId)
      if (changed) setSelected((s) => ({ ...s, [changed.projectId]: changed.quantity }))
      const id = await nestingService.create(run.name, run.params, items)
      setCurrentId(id)
      await loadRuns()
    } catch (err) {
      toast({ title: 'Não foi possível montar', description: getErrorMessage(err), variant: 'destructive' })
      await loadRuns()
    }
    setSubmitting(false)
  }

  // Folha editada à mão: nova montagem com as mesmas peças, nas posições do operador.
  const manual = async (run: NestingRun, placements: ManualPlacement[]) => {
    setSubmitting(true)
    try {
      const { fill: _fill, ...rest } = run.params
      const id = await nestingService.create(run.name, { ...rest, manual: placements }, run.items)
      setCurrentId(id)
      await loadRuns()
    } catch (err) {
      toast({ title: 'Não foi possível montar', description: getErrorMessage(err), variant: 'destructive' })
      await loadRuns()
    }
    setSubmitting(false)
  }

  // As quantidades que o preenchimento calculou viram as da lista, para ajustar à mão.
  const useQuantities = (run: NestingRun) => {
    const computed = new Map((run.result?.autoFill?.quantities ?? []).map((q) => [q.key, q.quantity]))
    const next: Record<string, number> = {}
    for (const item of run.items) {
      const quantity = computed.get(item.fileId) ?? 0
      if (quantity > 0) next[item.projectId] = quantity
    }
    setSelected(next)
    setParams((p) => ({ ...p, fill: { enabled: false, rollLengthMm: p.fill?.rollLengthMm, autoRotation: p.fill?.autoRotation ?? false } }))
    toast({ title: 'Quantidades na lista', description: 'Ajuste o que quiser e monte de novo.' })
  }

  const remove = async (run: NestingRun) => {
    await nestingService.remove(run.id).catch(() => null)
    if (currentId === run.id) setCurrentId(null)
    loadRuns()
  }

  // Folha de DTF: largura, margem, espaçamento e espelho do perfil; peças pelo contorno.
  const applyDtf = (value: string) => {
                    const profile = dtfProfiles.find((p) => p.id === value)
                    setDtfId(profile?.id)
                    if (!profile) {
                      setParams((p) => ({ ...p, mirror: false, dtfProfileId: undefined, cutLines: { ...p.cutLines, draw: true } }))
                      return
                    }
                    const t = profile.textile ?? {}
                    setIsSheet(false)
                    // Na folha de DTF só entram trabalhos DTF: desmarca os outros.
                    setSelected((s) =>
                      Object.fromEntries(
                        Object.entries(s).filter(([id]) => {
                          const job = jobs.find((j) => j.id === id)
                          return job && profileOf(job)?.technology === 'dtf'
                        }),
                      ),
                    )
                    // Filme em rolo: largura, margem e espaçamento do perfil (o que estiver
                    // cadastrado); peças pelo contorno da arte, sem desenhar faca; o branco da
                    // arte é estampa (não é fundo); espelho só se o fluxo do perfil pedir.
                    setParams((p) => ({
                      ...p,
                      mirror: !!t.mirror,
                      dtfProfileId: profile.id,
                      material: {
                        ...p.material,
                        lengthMm: undefined,
                        ...(t.printWidthMm ? { widthMm: t.printWidthMm } : {}),
                        ...(t.marginMm !== undefined ? { marginMm: t.marginMm } : {}),
                        ...(t.gapMm !== undefined ? { gapMm: t.gapMm } : {}),
                      },
                      cutLines: { ...p.cutLines, add: true, draw: false, whiteBackground: 'keep', offsetMm: 0 },
                    }))
  }

  return (
    <div className="space-y-4">
      {scope === 'print' && (
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Montagem</h1>
          <p className="text-sm text-muted-foreground">
            Encaixe os trabalhos no material pelo formato real da faca, com giro e espaçamento definidos por você.
          </p>
        </div>
      )}
      {scope === 'textile' && dtfProfiles.length === 0 && (
        <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
          Nenhum perfil DTF cadastrado. Crie um na aba Perfis.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <section className="space-y-5 rounded-lg border border-border bg-card p-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label>Trabalhos e quantidades</Label>
              <div className="flex rounded-md border border-border p-0.5 text-xs" role="tablist" aria-label="Quantidades">
                {[
                  { on: false, label: 'Eu defino' },
                  { on: true, label: 'Preencher o material' },
                ].map((option) => (
                  <button
                    key={option.label}
                    type="button"
                    role="tab"
                    aria-selected={fillOn === option.on}
                    className={cn(
                      'rounded px-2 py-1',
                      fillOn === option.on ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
                    )}
                    onClick={() =>
                      setParams((p) => ({
                        ...p,
                        fill: { enabled: option.on, rollLengthMm: p.fill?.rollLengthMm, autoRotation: p.fill?.autoRotation ?? false },
                      }))
                    }
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            {fillOn && (
              <p className="rounded-md bg-primary/5 px-2.5 py-2 text-xs text-muted-foreground">
                O sistema calcula quantas cópias de cada trabalho marcado cabem{' '}
                {isSheet ? 'na chapa' : 'no comprimento de rolo informado abaixo'}, com o espaço e os giros escolhidos. O
                número ao lado é o mínimo (vazio = nenhum); desmarque "preencher" para o trabalho ficar só no mínimo.
              </p>
            )}
            <div className="max-h-64 space-y-1 overflow-auto rounded-md border border-border p-1">
              {listed.length === 0 && (
                <p className="p-3 text-sm text-muted-foreground">
                  {dtfId ? 'Nenhum trabalho com perfil DTF na fila.' : 'Nenhum trabalho na fila.'}
                </p>
              )}
              {listed.map((job) => {
                const included = job.id in selected
                const quantity = selected[job.id] ?? 0
                return (
                  <div key={job.id} className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted">
                    <Checkbox
                      checked={included}
                      onCheckedChange={(checked) =>
                        setSelected((s) => {
                          const next = { ...s }
                          if (checked) next[job.id] = s[job.id] ?? (fillOn ? 0 : (job.ticket.dtf?.copies ?? 1))
                          else delete next[job.id]
                          return next
                        })
                      }
                      aria-label={`Incluir ${job.name}`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-foreground">{job.name}</p>
                      {job.clientName && <p className="truncate text-xs text-muted-foreground">{job.clientName}</p>}
                      {dtfId && needsWhite(job) && (
                        <Link
                          to={`/trabalhos/${job.id}`}
                          className="text-[11px] text-amber-600 underline dark:text-amber-400"
                        >
                          sem base branca: gerar no trabalho
                        </Link>
                      )}
                    </div>
                    {included && fillOn && (
                      <label
                        className="flex items-center gap-1 text-[11px] text-muted-foreground"
                        title="Pode receber cópias além do mínimo"
                      >
                        <input
                          type="checkbox"
                          checked={fillFlags[job.id] !== false}
                          onChange={(e) => setFillFlags((f) => ({ ...f, [job.id]: e.target.checked }))}
                        />
                        preencher
                      </label>
                    )}
                    {included && (
                      <Input
                        className="h-8 w-20"
                        inputMode="numeric"
                        aria-label={fillOn ? 'Mínimo' : 'Quantidade'}
                        title={fillOn ? 'Mínimo de cópias deste trabalho' : 'Quantidade'}
                        placeholder={fillOn ? 'mín.' : undefined}
                        value={fillOn && !quantity ? '' : quantity}
                        onChange={(e) =>
                          setSelected((s) => ({
                            ...s,
                            [job.id]: Math.max(fillOn ? 0 : 1, Math.round(numberOr(e.target.value, fillOn ? 0 : 1))),
                          }))
                        }
                      />
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 flex items-center justify-between">
              <Label>Material</Label>
              <div className="flex rounded-md border border-border p-0.5 text-xs">
                {[
                  { sheet: false, label: 'Rolo' },
                  { sheet: true, label: 'Folha / chapa' },
                ].map((option) => (
                  <button
                    key={option.label}
                    className={cn(
                      'rounded px-2 py-1',
                      isSheet === option.sheet ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
                    )}
                    onClick={() => setIsSheet(option.sheet)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            {scope === 'textile' && (
              <div className="col-span-2 space-y-1.5">
                <Label className="text-xs text-muted-foreground">Perfil DTF (filme)</Label>
                <Select value={dtfId ?? ''} onValueChange={applyDtf}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {dtfProfiles.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {dtfId && (
                  <div className="space-y-1 text-xs text-muted-foreground">
                    {!dtfProfiles.find((p) => p.id === dtfId)?.textile?.printWidthMm && (
                      <p className="text-amber-600 dark:text-amber-400">
                        O perfil não tem a largura útil do filme: informe abaixo ou cadastre no perfil.
                      </p>
                    )}
                    <label className="flex items-center gap-2">
                      <Switch
                        checked={!!params.mirror}
                        onCheckedChange={(mirror) => setParams((p) => ({ ...p, mirror }))}
                      />
                      Espelhar a folha (somente se o fluxo deste equipamento exigir)
                    </label>
                    <p>Peças pelo contorno da arte, sem faca; a base branca de cada arte vai junto.</p>
                  </div>
                )}
              </div>
            )}
            {offcuts.length > 0 && (
              <div className="col-span-2 space-y-1.5">
                <Label className="text-xs text-muted-foreground">Usar retalho do estoque</Label>
                <Select
                  value={params.offcutId ?? 'none'}
                  onValueChange={(value) => {
                    const offcut = offcuts.find((o) => o.id === value)
                    if (!offcut) {
                      setParams((p) => ({ ...p, offcutId: undefined }))
                      return
                    }
                    setIsSheet(true)
                    setParams((p) => ({
                      ...p,
                      offcutId: offcut.id,
                      material: { ...p.material, widthMm: Number(offcut.width_mm), lengthMm: Number(offcut.length_mm) },
                    }))
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Material novo</SelectItem>
                    {offcuts.map((offcut) => (
                      <SelectItem key={offcut.id} value={offcut.id}>
                        {Math.round(offcut.width_mm)} × {Math.round(offcut.length_mm)} mm
                        {offcut.name ? ` · ${offcut.name}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Largura útil (mm)</Label>
              <Input
                inputMode="decimal"
                value={params.material.widthMm || ''}
                onChange={(e) => setMaterial({ widthMm: numberOr(e.target.value, 0) })}
              />
            </div>
            {isSheet && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Comprimento (mm)</Label>
                <Input
                  inputMode="decimal"
                  value={params.material.lengthMm || ''}
                  onChange={(e) => setMaterial({ lengthMm: numberOr(e.target.value, 0) || undefined })}
                />
              </div>
            )}
            {!isSheet && fillOn && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Usar do rolo (mm)</Label>
                <Input
                  inputMode="decimal"
                  placeholder="ex.: 2000"
                  value={params.fill?.rollLengthMm || ''}
                  onChange={(e) =>
                    setParams((p) => ({
                      ...p,
                      fill: {
                        enabled: true,
                        autoRotation: p.fill?.autoRotation ?? false,
                        rollLengthMm: numberOr(e.target.value, 0) || undefined,
                      },
                    }))
                  }
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Margem da borda (mm)</Label>
              <Input
                inputMode="decimal"
                value={params.material.marginMm}
                onChange={(e) => setMaterial({ marginMm: numberOr(e.target.value, 0) })}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Espaço entre peças (mm)</Label>
              <Input
                inputMode="decimal"
                value={params.material.gapMm}
                onChange={(e) => setMaterial({ gapMm: numberOr(e.target.value, 0) })}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Giro das peças</Label>
            <Select
              value={params.rotation.allow ? String(params.rotation.stepDegrees) : '0'}
              onValueChange={(value) =>
                setParams((p) => ({
                  ...p,
                  rotation: value === '0' ? { allow: false, stepDegrees: 0 } : { allow: true, stepDegrees: Number(value) },
                }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROTATIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Peças retangulares só usam 0° e 90°; peças com faca usam todos os ângulos escolhidos.
            </p>
            {fillOn && params.rotation.allow && (
              <label className="flex items-start gap-2 pt-1 text-sm">
                <Checkbox
                  className="mt-0.5"
                  checked={params.fill?.autoRotation === true}
                  onCheckedChange={(v) =>
                    setParams((p) => ({
                      ...p,
                      fill: { enabled: true, rollLengthMm: p.fill?.rollLengthMm, autoRotation: v === true },
                    }))
                  }
                />
                <span>
                  Testar os giros e ficar com o que cabe mais
                  <span className="block text-xs text-muted-foreground">
                    Compara só combinações dos ângulos acima (todos, quartos de volta, meia volta, sem giro). Leva um
                    pouco mais.
                  </span>
                </span>
              </label>
            )}
          </div>

          {scope !== 'textile' && (
          <div className="flex items-start justify-between gap-3">
            <div>
              <Label>Gerar faca pelo contorno da arte</Label>
              <p className="text-xs text-muted-foreground">
                Para arquivos sem faca: o sistema contorna cada peça por fora da arte. Cada forma separada vira
                uma peça.
              </p>
            </div>
            <Switch
              checked={params.cutLines.add && params.cutLines.draw !== false}
              onCheckedChange={(add) => setParams((p) => ({ ...p, cutLines: { ...p.cutLines, add, draw: true } }))}
            />
          </div>
          )}
          {params.cutLines.add && params.cutLines.draw !== false && (
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Afastamento da arte (mm)</Label>
                <Input
                  inputMode="decimal"
                  value={params.cutLines.offsetMm ?? 0}
                  onChange={(e) =>
                    setParams((p) => ({ ...p, cutLines: { ...p.cutLines, offsetMm: numberOr(e.target.value, 0) } }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Juntar artes a menos de (mm)</Label>
                <Input
                  inputMode="decimal"
                  value={params.cutLines.mergeMm ?? 3}
                  onChange={(e) =>
                    setParams((p) => ({ ...p, cutLines: { ...p.cutLines, mergeMm: numberOr(e.target.value, 0) } }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Nome da faca no RIP</Label>
                <Input
                  title="Nome da separação (cor especial) que o RIP/plotter reconhece como corte, ex.: CutContour"
                  value={params.cutLines.name}
                  onChange={(e) =>
                    setParams((p) => ({ ...p, cutLines: { ...p.cutLines, name: e.target.value || 'CutContour' } }))
                  }
                />
              </div>
              <label className="col-span-3 flex items-start gap-2 text-sm">
                <Checkbox
                  checked={!!params.cutLines.cutHoles}
                  onCheckedChange={(v) => setCut({ cutHoles: v === true })}
                  className="mt-0.5"
                />
                <span>
                  Cortar os vazados internos
                  <span className="block text-xs text-muted-foreground">
                    O miolo sem impressão de uma peça também é cortado, e peças menores podem ser encaixadas
                    dentro dele.
                  </span>
                </span>
              </label>
              <label className="col-span-3 flex items-start gap-2 text-sm">
                <Checkbox
                  checked={params.cutLines.whiteBackground === 'keep'}
                  onCheckedChange={(v) => setCut({ whiteBackground: v === true ? 'keep' : 'ignore' })}
                  className="mt-0.5"
                />
                <span>
                  O fundo branco faz parte da peça
                  <span className="block text-xs text-muted-foreground">
                    Desligado: um retângulo branco atrás da arte é ignorado e a faca segue a arte.
                  </span>
                </span>
              </label>
            </div>
          )}

          <div className="space-y-3">
            <Label>Marcas</Label>
            <Select
              value={marks.registration}
              onValueChange={(value) => setMarks({ registration: value as NestingMarks['registration'] })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sem marcas de registro do plotter</SelectItem>
                <SelectItem value="sides">Marcas de registro nas laterais (estilo OPOS)</SelectItem>
                <SelectItem value="corners">Marcas de registro nos 4 cantos (estilo ARMS)</SelectItem>
              </SelectContent>
            </Select>
            {marks.registration !== 'none' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Formato</Label>
                    <Select
                      value={marks.shape}
                      onValueChange={(value) => setMarks({ shape: value as NestingMarks['shape'] })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="square">Quadrado</SelectItem>
                        <SelectItem value="circle">Círculo</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Tamanho da marca (mm)</Label>
                    <Input
                      inputMode="decimal"
                      value={marks.sizeMm}
                      onChange={(e) => setMarks({ sizeMm: numberOr(e.target.value, 3) })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Distância das peças (mm)</Label>
                    <Input
                      inputMode="decimal"
                      value={marks.distanceMm}
                      onChange={(e) => setMarks({ distanceMm: numberOr(e.target.value, 0) })}
                    />
                  </div>
                  {marks.registration === 'sides' && (
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Espaço máx. entre marcas (mm)</Label>
                      <Input
                        inputMode="decimal"
                        value={marks.spacingMm}
                        onChange={(e) => setMarks({ spacingMm: numberOr(e.target.value, 0) })}
                      />
                    </div>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Confira formato, tamanho e espaçamento no manual do seu plotter. As peças ficam fora da faixa das
                  marcas.
                </p>
              </>
            )}
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={marks.cropMarks} onCheckedChange={(v) => setMarks({ cropMarks: v === true })} />
              Marcas de corte nas peças retangulares
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={!!marks.slug}
                onCheckedChange={(v) => setMarks({ slug: v === true ? AUTO_SLUG : '' })}
              />
              Faixa de identificação
            </label>
            {!!marks.slug && (
              <Input
                placeholder="Automática: trabalhos · material · data"
                value={marks.slug === AUTO_SLUG ? '' : marks.slug}
                maxLength={200}
                onChange={(e) => setMarks({ slug: e.target.value || AUTO_SLUG })}
              />
            )}
          </div>

          {problem && params.material.widthMm > 0 && (
            <p className="text-sm text-amber-700 dark:text-amber-400">{problem}</p>
          )}
          <Button className="w-full" disabled={!canSubmit || submitting} onClick={submit}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <LayoutGrid className="h-4 w-4" />}
            Montar {chosen.length > 0 && `(${chosen.reduce((sum, job) => sum + selected[job.id], 0)} peças)`}
          </Button>
        </section>

        <section className="min-w-0 space-y-4">
          {!current ? (
            <p className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
              Escolha os trabalhos, informe o material e clique em Montar.
            </p>
          ) : (
            <RunDetail
              run={current}
              outputUrl={outputUrl}
              page={page}
              onPageChange={setPage}
              onComplete={complete}
              onOffcutSaved={loadOffcuts}
              busy={submitting}
              onUseQuantities={useQuantities}
              onManual={manual}
            />
          )}

          {runs.length > 0 && (
            <div className="rounded-lg border border-border bg-card">
              <p className="border-b border-border px-4 py-2 text-sm font-medium text-foreground">Montagens recentes</p>
              <ul className="divide-y divide-border">
                {runs.map((run) => (
                  <li
                    key={run.id}
                    className={cn(
                      'flex cursor-pointer items-center gap-3 px-4 py-2 text-sm hover:bg-muted',
                      current?.id === run.id && 'bg-muted',
                    )}
                    onClick={() => setCurrentId(run.id)}
                  >
                    <span className="min-w-0 flex-1 truncate text-foreground">{run.name || 'Montagem'}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{runLabel(run)}</span>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      aria-label="Excluir montagem"
                      onClick={(e) => {
                        e.stopPropagation()
                        remove(run)
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

// Limite do formato PDF por lado (200 polegadas); rolos maiores são divididos em páginas.
const PDF_MAX_MM = 5080

/** Confere o material antes de enviar; devolve o problema em linguagem de pré-impressor. */
function materialProblem(params: NestingParams, isSheet: boolean): string {
  const { widthMm, lengthMm, marginMm, gapMm } = params.material
  if (!(widthMm > 0)) return 'Informe a largura útil do material.'
  if (widthMm > PDF_MAX_MM) {
    return `Largura de ${widthMm.toLocaleString('pt-BR')} mm passa do limite do PDF (${PDF_MAX_MM.toLocaleString('pt-BR')} mm). Confira se não sobrou um dígito (ex.: 1220).`
  }
  if (isSheet) {
    if (!(lengthMm && lengthMm > 0)) return 'Informe o comprimento da folha/chapa.'
    if (lengthMm > PDF_MAX_MM) {
      return `Comprimento de ${lengthMm.toLocaleString('pt-BR')} mm passa do limite do PDF (${PDF_MAX_MM.toLocaleString('pt-BR')} mm).`
    }
  }
  if (marginMm * 2 >= widthMm) return 'A margem da borda ocupa toda a largura do material.'
  if (marginMm < 0 || gapMm < 0) return 'Margem e espaço entre peças não podem ser negativos.'
  return ''
}

function runLabel(run: NestingRun) {
  if (NESTING_ACTIVE.includes(run.status)) return `${run.progress}%`
  if (run.status === 'failed') return 'Falhou'
  const total = run.result?.totalLengthMm
  return total ? `${(total / 1000).toFixed(2)} m` : 'Concluída'
}

function RunDetail({
  run,
  outputUrl,
  page,
  onPageChange,
  onComplete,
  onOffcutSaved,
  busy,
  onUseQuantities,
  onManual,
}: {
  run: NestingRun
  outputUrl: string
  page: number
  onPageChange: (page: number) => void
  onComplete: (run: NestingRun, fileId: string, extra: number) => void
  onOffcutSaved: () => void
  busy: boolean
  /** Leva as quantidades calculadas para a lista (modo "eu defino"). */
  onUseQuantities?: (run: NestingRun) => void
  /** Gera a folha nas posições editadas à mão. */
  onManual?: (run: NestingRun, placements: ManualPlacement[]) => void
}) {
  const result = run.result ?? {}
  const sheets = result.sheets ?? []
  const width = run.params?.material?.widthMm
  const last = sheets[sheets.length - 1]
  const offcut = last?.offcutMm
  // Preenchida automaticamente, a chapa já está cheia: sem sugestão de completar.
  const fill = result.autoFill ? [] : (result.fill ?? []).filter((f) => f.extra > 0)
  const mm = (value: number) => Math.round(value).toLocaleString('pt-BR')
  const [editing, setEditing] = useState(false)
  const [savedOffcut, setSavedOffcut] = useState('')
  const saveOffcut = async (source: NestingRun, size: [number, number]) => {
    try {
      await offcutService.add({
        name: `Sobra de ${source.name || 'montagem'}`.slice(0, 120),
        widthMm: size[0],
        lengthMm: size[1],
        sourceRun: source.id,
      })
      setSavedOffcut(source.id)
      onOffcutSaved()
    } catch (err) {
      toast({ title: 'Não foi possível guardar o retalho', description: getErrorMessage(err), variant: 'destructive' })
    }
  }
  const pct = (value: number) => `${Math.round(value * 100)}%`

  if (NESTING_ACTIVE.includes(run.status)) {
    return (
      <div className="space-y-2 rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2 text-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {run.current_step || 'Na fila do analisador'}
          </span>
          <span className="text-muted-foreground">{run.progress}%</span>
        </div>
        <Progress value={run.progress} />
      </div>
    )
  }

  if (run.status === 'failed') {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
        <p className="font-medium text-destructive">A montagem falhou</p>
        <p className="text-muted-foreground">{run.error_message || 'Sem detalhes.'}</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-border bg-card p-4 text-sm">
        <Stat label="Material" value={width ? `${width} mm de largura` : '—'} />
        <Stat label="Comprimento total" value={result.totalLengthMm ? `${(result.totalLengthMm / 1000).toFixed(3)} m` : '—'} />
        <Stat label="Peças" value={String(result.placed ?? 0)} />
        {sheets.map((sheet) => (
          <Stat
            key={sheet.index}
            label={sheets.length > 1 ? `Página ${sheet.index}` : 'Aproveitamento da chapa'}
            value={`${pct(sheet.efficiency)}${sheets.length > 1 ? ` · ${sheet.pieces} peças` : ''}`}
          />
        ))}
        {last?.usedEfficiency != null && last.usedLengthMm != null && offcut && (
          <Stat
            label={`Na área usada (até ${mm(last.usedLengthMm)} mm)`}
            value={pct(last.usedEfficiency)}
          />
        )}
        {outputUrl && (
          <Button size="sm" variant="outline" className="ml-auto" asChild>
            <a href={outputUrl} target="_blank" rel="noreferrer">
              <Download className="h-4 w-4" />
              Baixar PDF montado
            </a>
          </Button>
        )}
      </div>

      {!!result.unplaced?.length && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-400">
          Não couberam: {result.unplaced.map((u) => `${u.label} (${u.reason})`).join('; ')}
        </p>
      )}
      {result.autoFill && (
        <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
          <p className="font-medium text-foreground">
            Preenchimento automático{' '}
            {result.autoFill.rollLengthMm ? `de ${mm(result.autoFill.rollLengthMm)} mm do rolo` : 'da chapa'}
          </p>
          <ul className="flex flex-wrap gap-x-5 gap-y-1">
            {result.autoFill.quantities
              .filter((q) => q.quantity > 0)
              .map((q) => (
                <li key={q.key} className="text-foreground">
                  <span className="font-semibold tabular-nums">{q.quantity}</span> × {q.label}
                  {q.minimum > 0 && <span className="text-muted-foreground"> (mínimo {q.minimum})</span>}
                </li>
              ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Giros usados: {result.autoFill.rotations} · {result.autoFill.tested} encaixes testados · nenhuma cópia a mais
            cabe com este espaço entre peças.
          </p>
          {onUseQuantities && (
            <Button size="sm" variant="outline" onClick={() => onUseQuantities(run)}>
              Usar estas quantidades
            </Button>
          )}
        </div>
      )}
      {last && offcut && offcut[1] > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3 text-sm text-foreground">
          <p className="min-w-0 flex-1">
            Retalho: cortando a chapa{sheets.length > 1 ? ` da página ${last.index}` : ''} em{' '}
            <strong>{mm(last.usedLengthMm ?? 0)} mm</strong>, sobram{' '}
            <strong>
              {mm(offcut[0])} × {mm(offcut[1])} mm
            </strong>{' '}
            para voltar ao estoque.
          </p>
          <Button size="sm" variant="outline" disabled={savedOffcut === run.id} onClick={() => saveOffcut(run, offcut)}>
            {savedOffcut === run.id ? 'No estoque' : 'Guardar no estoque'}
          </Button>
        </div>
      )}
      {fill.length > 0 && (
        <div className="space-y-2 rounded-lg border border-border bg-card p-3 text-sm">
          <p className="text-foreground">
            Ainda cabem na sobra{sheets.length > 1 ? ` da página ${last?.index}` : ''}
            {fill.length > 1 && <span className="text-muted-foreground"> (cada trabalho sozinho)</span>}:
          </p>
          {fill.map((f) => (
            <div key={f.key} className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-foreground">
                <strong>+{f.extra.toLocaleString('pt-BR')}</strong> {f.label}
              </span>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => onComplete(run, f.key, f.extra)}>
                Completar a chapa
              </Button>
            </div>
          ))}
        </div>
      )}
      {!!result.dieLines?.length && (
        <p className="text-xs text-muted-foreground">
          Encaixados pelo formato da faca: {result.dieLines.join(', ')}. Os demais, pelo formato final.
        </p>
      )}

      <FilmUse run={run} />
      {onManual && result.placements?.length && result.shapes ? (
        editing ? (
          <SheetEditor
            run={run}
            busy={busy}
            onCancel={() => setEditing(false)}
            onApply={(placements) => {
              setEditing(false)
              onManual(run, placements)
            }}
          />
        ) : (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            Editar a folha à mão (mover, girar, duplicar)
          </Button>
        )
      ) : null}
      {!editing && (
      <div className="h-[70vh] overflow-hidden rounded-lg border border-border bg-muted">
        {outputUrl ? (
          <PdfPreview url={outputUrl} page={page} onPageChange={onPageChange} />
        ) : (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium text-foreground">{value}</p>
    </div>
  )
}

/**
 * Consumo de filme da folha (DTF): metros e m² pelo comprimento real montado e o
 * aproveitamento (área das peças ÷ filme usado).
 */
function FilmUse({ run }: { run: NestingRun }) {
  if (!run.params.dtfProfileId) return null
  const width = run.result?.widthMm ?? run.params.material.widthMm
  const length = run.result?.totalLengthMm
  if (!length) return null
  const meters = length / 1000
  const area = (width / 1000) * meters
  const sheets = run.result?.sheets ?? []
  const used = sheets.reduce((s, sh) => s + sh.efficiency * (width / 1000) * (sh.lengthMm / 1000), 0)
  const fmt = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
  return (
    <p className="text-xs text-muted-foreground">
      Filme: {fmt(meters)} m ({fmt(area)} m²) · peças {fmt(used)} m² · desperdício {Math.round((1 - used / area) * 100)}%
    </p>
  )
}
