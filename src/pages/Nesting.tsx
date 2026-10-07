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
  type NestingItem,
  type NestingParams,
  type NestingRun,
} from '@/services/nestingService'
import { profileService } from '@/services/profileService'

const ROTATIONS = [
  { value: '0', label: 'Sem giro' },
  { value: '90', label: 'A cada 90°' },
  { value: '45', label: 'A cada 45°' },
  { value: '22.5', label: 'A cada 22,5°' },
  { value: '11.25', label: 'A cada 11,25°' },
]

const STORAGE_KEY = 'yesod.nesting.params'

// Último material usado: conveniência local do operador (nada é fixo no sistema).
function loadParams(): NestingParams {
  const empty: NestingParams = {
    material: { widthMm: 0, marginMm: 0, gapMm: 0 },
    rotation: { allow: true, stepDegrees: 90 },
    cutLines: { add: true, name: 'CutContour' },
  }
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    return saved ? { ...empty, ...saved } : empty
  } catch {
    return empty
  }
}

const numberOr = (value: string, fallback: number) => {
  const n = Number(value.replace(',', '.'))
  return value.trim() === '' || !Number.isFinite(n) ? fallback : n
}

export default function NestingPage() {
  const profiles = profileService.getProfilesSync()
  const [jobs, setJobs] = useState<Job[]>([])
  const [selected, setSelected] = useState<Record<string, number>>({})
  const [params, setParams] = useState<NestingParams>(loadParams)
  const [isSheet, setIsSheet] = useState(!!loadParams().material.lengthMm)
  const [submitting, setSubmitting] = useState(false)
  const [runs, setRuns] = useState<NestingRun[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [outputUrl, setOutputUrl] = useState('')
  const [page, setPage] = useState(1)

  const loadRuns = useCallback(async () => {
    try {
      setRuns(await nestingService.listRuns())
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
    setParams((p) => ({ ...p, material: { ...p.material, ...patch } }))

  const chosen = useMemo(() => jobs.filter((job) => selected[job.id]), [jobs, selected])
  const canSubmit = chosen.length > 0 && params.material.widthMm > 0 && (!isSheet || !!params.material.lengthMm)

  const submit = async () => {
    setSubmitting(true)
    try {
      const finalParams: NestingParams = {
        ...params,
        material: { ...params.material, lengthMm: isSheet ? params.material.lengthMm : undefined },
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
          quantity: selected[job.id],
          fileScale: job.ticket.fileScale || profile?.scale || 1,
          bleedMm: job.ticket.minBleed ?? profile?.minBleed ?? 0,
          cutNames: cutName ? [cutName, 'CutContour', 'Corte', 'Cut'] : undefined,
        })
      }
      const name = chosen.map((job) => job.name).join(', ').slice(0, 120)
      const id = await nestingService.create(name, finalParams, items)
      setCurrentId(id)
      await loadRuns()
    } catch (err) {
      toast({ title: 'Não foi possível montar', description: getErrorMessage(err), variant: 'destructive' })
      await loadRuns()
    }
    setSubmitting(false)
  }

  const remove = async (run: NestingRun) => {
    await nestingService.remove(run.id).catch(() => null)
    if (currentId === run.id) setCurrentId(null)
    loadRuns()
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Montagem</h1>
        <p className="text-sm text-muted-foreground">
          Encaixe os trabalhos no material pelo formato real da faca, com giro e espaçamento definidos por você.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <section className="space-y-5 rounded-lg border border-border bg-card p-4">
          <div className="space-y-2">
            <Label>Trabalhos e quantidades</Label>
            <div className="max-h-64 space-y-1 overflow-auto rounded-md border border-border p-1">
              {jobs.length === 0 && (
                <p className="p-3 text-sm text-muted-foreground">Nenhum trabalho na fila.</p>
              )}
              {jobs.map((job) => {
                const quantity = selected[job.id]
                return (
                  <div key={job.id} className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted">
                    <Checkbox
                      checked={!!quantity}
                      onCheckedChange={(checked) =>
                        setSelected((s) => {
                          const next = { ...s }
                          if (checked) next[job.id] = s[job.id] || 1
                          else delete next[job.id]
                          return next
                        })
                      }
                      aria-label={`Incluir ${job.name}`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-foreground">{job.name}</p>
                      {job.clientName && <p className="truncate text-xs text-muted-foreground">{job.clientName}</p>}
                    </div>
                    {!!quantity && (
                      <Input
                        className="h-8 w-20"
                        inputMode="numeric"
                        aria-label="Quantidade"
                        value={quantity}
                        onChange={(e) =>
                          setSelected((s) => ({ ...s, [job.id]: Math.max(1, Math.round(numberOr(e.target.value, 1))) }))
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
          </div>

          <div className="flex items-start justify-between gap-3">
            <div>
              <Label>Linha de corte nas peças sem faca</Label>
              <p className="text-xs text-muted-foreground">Contorno do formato final na cor especial abaixo.</p>
            </div>
            <Switch
              checked={params.cutLines.add}
              onCheckedChange={(add) => setParams((p) => ({ ...p, cutLines: { ...p.cutLines, add } }))}
            />
          </div>
          {params.cutLines.add && (
            <Input
              aria-label="Nome da cor de corte"
              value={params.cutLines.name}
              onChange={(e) => setParams((p) => ({ ...p, cutLines: { ...p.cutLines, name: e.target.value || 'CutContour' } }))}
            />
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
            <RunDetail run={current} outputUrl={outputUrl} page={page} onPageChange={setPage} />
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
}: {
  run: NestingRun
  outputUrl: string
  page: number
  onPageChange: (page: number) => void
}) {
  const result = run.result ?? {}
  const sheets = result.sheets ?? []
  const width = run.params?.material?.widthMm

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
            label={sheets.length > 1 ? `Página ${sheet.index}` : 'Aproveitamento'}
            value={`${Math.round(sheet.efficiency * 100)}%${sheets.length > 1 ? ` · ${sheet.pieces} peças` : ''}`}
          />
        ))}
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
      {!!result.dieLines?.length && (
        <p className="text-xs text-muted-foreground">
          Encaixados pelo formato da faca: {result.dieLines.join(', ')}. Os demais, pelo formato final.
        </p>
      )}

      <div className="h-[70vh] overflow-hidden rounded-lg border border-border bg-muted">
        {outputUrl ? (
          <PdfPreview url={outputUrl} page={page} onPageChange={onPageChange} safetyPt={0} />
        ) : (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>
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
