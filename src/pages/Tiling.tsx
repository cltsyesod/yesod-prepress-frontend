import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CircleCheck,
  Combine,
  Download,
  Eye,
  EyeOff,
  FileArchive,
  Grid3x3,
  Loader2,
  Redo2,
  RotateCcw,
  Save,
  Scissors,
  SplitSquareHorizontal,
  SplitSquareVertical,
  Trash2,
  Undo2,
  Upload,
} from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { EdgesInput } from '@/components/tiling/EdgesInput'
import { GridSizes } from '@/components/tiling/GridSizes'
import { SeamInspector } from '@/components/tiling/SeamInspector'
import { TileInspector } from '@/components/tiling/TileInspector'
import { TilingCanvas } from '@/components/tiling/TilingCanvas'
import {
  addLine,
  autoGrid,
  calculateProject,
  edgesForSide,
  fitToPoster,
  hasErrors,
  hasManualEdits,
  mergeTiles,
  moveLine,
  newProject,
  splitTile,
  zeroEdges,
  type Edges,
  type GridRequest,
  type Poster,
  type PrintConstraint,
  type TilingProjectModel,
  type TilingRules,
} from '@/domain/tiling'
import { useAuth } from '@/hooks/use-auth'
import { usePdfPageImage, type PdfPageImage } from '@/hooks/use-pdf-page-image'
import { useRealtime } from '@/hooks/use-realtime'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/supabase/errors'
import { cn } from '@/lib/utils'
import { jobsService, type Job } from '@/services/jobsService'
import { profileService } from '@/services/profileService'
import { projectFilesService } from '@/services/projectFilesService'
import {
  readConfig,
  TILING_ACTIVE,
  tilingService,
  type TilingBackground,
  type TilingConfig,
  type TilingMarksConfig,
  type TilingProject,
  type TilingTemplate,
} from '@/services/tilingService'

const MM = 72 / 25.4
const PREFS_KEY = 'yesod.tiling.prefs'

/** "1:10", "10" -> 10. */
function parseScale(value: unknown): number {
  const text = String(value ?? '')
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*:\s*(\d+(?:[.,]\d+)?)/)
  const n = match ? Number(match[2].replace(',', '.')) / Number(match[1].replace(',', '.')) : Number(text.replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? n : 1
}

const numberOr = (value: string, fallback: number) => {
  const n = Number(value.replace(',', '.'))
  return value.trim() === '' || !Number.isFinite(n) ? fallback : n
}

type Unit = 'mm' | 'cm' | 'm'
const UNIT_FACTOR: Record<Unit, number> = { mm: 1, cm: 10, m: 1000 }

interface Prefs {
  constraint: PrintConstraint
  rules: Omit<TilingRules, 'bleed'> & { bleed?: Edges }
  nameTemplate: string
  request: GridRequest
  marks: TilingMarksConfig
}

// Valores iniciais da tela; o operador ajusta a cada trabalho e o último uso é lembrado.
const DEFAULT_PREFS: Prefs = {
  constraint: { printableWidth: 0, printableLength: 0, direction: 'standing' },
  rules: { overlap: edgesForSide('next', 20), white: zeroEdges(), minimumTile: 50 },
  nameTemplate: '{projeto}_L{lin}C{col}',
  request: { mode: 'equal' },
  marks: { marginMm: 10, cropMarks: true, label: true },
}

function loadPrefs(): Prefs {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null')
    return saved ? { ...DEFAULT_PREFS, ...saved, request: { mode: saved.request?.mode ?? 'equal' } } : DEFAULT_PREFS
  } catch {
    return DEFAULT_PREFS
  }
}

/** O formato final da arte (TrimBox × escala) e a sangria que o arquivo realmente tem. */
function posterOf(art: PdfPageImage, scale: number): Poster {
  const k = scale / MM
  const [vx0, vy0, vx1, vy1] = art.visible
  const [tx0, ty0, tx1, ty1] = art.trim
  const b = art.bleed ?? art.visible
  const reach = (outer: number, inner: number) => Math.max(0, (outer - inner) * k)
  return {
    width: (tx1 - tx0) * k,
    height: (ty1 - ty0) * k,
    scale,
    availableBleed: {
      left: reach(tx0, Math.max(b[0], vx0)),
      bottom: reach(ty0, Math.max(b[1], vy0)),
      right: reach(Math.min(b[2], vx1), tx1),
      top: reach(Math.min(b[3], vy1), ty1),
    },
  }
}

export default function TilingPage() {
  const { user } = useAuth()
  const profiles = profileService.getProfilesSync()
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs)
  const [jobs, setJobs] = useState<Job[]>([])
  const [jobId, setJobId] = useState('')
  const [fileId, setFileId] = useState('')
  const [pdfUrl, setPdfUrl] = useState('')
  const [pageNumber, setPageNumber] = useState(1)
  const { image: art, error: artError } = usePdfPageImage(pdfUrl, pageNumber)

  const [name, setName] = useState('')
  const [scale, setScale] = useState(1)
  const [unit, setUnit] = useState<Unit>('mm')
  const [project, setProject] = useState<TilingProjectModel | null>(null)
  const [projectSource, setProjectSource] = useState('')
  const [pending, setPending] = useState<TilingConfig | null>(null)
  const [history, setHistory] = useState<{ past: TilingProjectModel[]; future: TilingProjectModel[] }>({ past: [], future: [] })
  const [dragStart, setDragStart] = useState<TilingProjectModel | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [selectedSeam, setSelectedSeam] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ message: string; run: () => void } | null>(null)

  const [background, setBackground] = useState<TilingBackground | null>(null)
  const [backgroundUrl, setBackgroundUrl] = useState('')
  const [backgroundAspect, setBackgroundAspect] = useState(1)

  const [tilingId, setTilingId] = useState<string | null>(null)
  const [saved, setSaved] = useState<TilingProject[]>([])
  const [templates, setTemplates] = useState<TilingTemplate[]>([])
  const [templateName, setTemplateName] = useState('')
  const [busy, setBusy] = useState(false)
  const [downloads, setDownloads] = useState<{ pdf?: string; zip?: string; guide?: string }>({})

  const job = jobs.find((j) => j.id === jobId) ?? null
  const current = saved.find((p) => p.id === tilingId) ?? null

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
    } catch {
      /* sem armazenamento local */
    }
  }, [prefs])

  const loadSaved = useCallback(() => {
    tilingService.list().then(setSaved).catch(() => setSaved([]))
  }, [])
  useEffect(() => {
    jobsService.listJobs().then(setJobs).catch(() => setJobs([]))
    tilingService.listTemplates().then(setTemplates).catch(() => setTemplates([]))
    loadSaved()
  }, [loadSaved])
  useRealtime('tiling_projects', () => loadSaved())

  // ---- Projeto e histórico ------------------------------------------------------------
  const commit = (next: TilingProjectModel | null) => {
    if (!next || !project || next === project) return
    setHistory((h) => ({ past: [...h.past.slice(-79), project], future: [] }))
    setProject(next)
  }
  const undo = () => {
    if (!history.past.length || !project) return
    setProject(history.past[history.past.length - 1])
    setHistory((h) => ({ past: h.past.slice(0, -1), future: [project, ...h.future] }))
  }
  const redo = () => {
    if (!history.future.length || !project) return
    setProject(history.future[0])
    setHistory((h) => ({ past: [...h.past, project], future: h.future.slice(1) }))
  }

  /** Recalcula a grade pelos parâmetros; se houver ajustes manuais, pergunta antes. */
  const regrid = (base: TilingProjectModel, request: GridRequest, ask: boolean) => {
    const run = () => {
      commit(autoGrid(base, request))
      setSelected([])
      setSelectedSeam(null)
    }
    if (ask && hasManualEdits(base)) {
      setConfirm({
        message: 'Essa alteração recalculará a grade e poderá remover ajustes manuais feitos nos painéis e nas linhas.',
        run,
      })
    } else run()
  }

  /** Mudança global (material, regras): na grade automática ela é recalculada na hora. */
  const changeGlobal = (mutate: (p: TilingProjectModel) => TilingProjectModel) => {
    if (!project) return
    const next = mutate(project)
    if (hasManualEdits(project)) commit(next)
    else commit(autoGrid(next, prefs.request))
  }

  // ---- Arte ---------------------------------------------------------------------------
  const chooseJob = async (id: string, keep?: { fileId?: string; scale?: number }) => {
    setJobId(id)
    const chosen = jobs.find((j) => j.id === id)
    try {
      const { primary } = await jobsService.getFiles(id)
      if (!primary) throw new Error('O trabalho não tem arquivo.')
      setFileId(keep?.fileId || primary.id)
      setPdfUrl(await projectFilesService.getDownloadUrl(primary.storage_path))
      const profile = profiles.find((p) => p.id === chosen?.profileId)
      setScale(keep?.scale ?? parseScale(chosen?.ticket.fileScale || profile?.scale || 1))
      setProjectSource('')
      if (!keep) {
        setName(chosen?.name ?? '')
        setTilingId(null)
        setPending(null)
        setBackground(null)
      }
    } catch (err) {
      toast({ title: 'Não foi possível abrir a arte', description: getErrorMessage(err), variant: 'destructive' })
    }
  }

  // A arte aparece assim que carrega; a grade é criada (ou a salva é aplicada) nesse momento.
  useEffect(() => {
    if (!art || art.source !== pdfUrl || projectSource === pdfUrl) return
    const poster = posterOf(art, scale)
    let next: TilingProjectModel
    if (pending) {
      next = fitToPoster(pending.project, poster)
      setPrefs((p) => ({ ...p, request: pending.request, marks: pending.marks }))
      setPending(null)
    } else {
      next = newProject(
        poster,
        prefs.constraint,
        { ...prefs.rules, bleed: prefs.rules.bleed ?? poster.availableBleed },
        prefs.nameTemplate,
        prefs.request,
      )
    }
    setProject(next)
    setProjectSource(pdfUrl)
    setHistory({ past: [], future: [] })
    setSelected([])
    setSelectedSeam(null)
  }, [art, pdfUrl, projectSource, pending, scale, prefs])

  const changeScale = (next: number) => {
    if (!art || !project || !(next > 0)) return
    setScale(next)
    const poster = posterOf(art, next)
    // Grade editada acompanha a nova medida; grade automática é refeita.
    if (hasManualEdits(project)) commit(fitToPoster(project, poster))
    else commit(autoGrid({ ...project, poster }, prefs.request))
  }

  // ---- Geometria ----------------------------------------------------------------------
  const geometry = useMemo(
    () => (project ? calculateProject(project, { project: name || job?.name, client: job?.clientName }) : null),
    [project, name, job],
  )
  const errors = useMemo(() => geometry?.issues.filter((i) => i.severity === 'error') ?? [], [geometry])
  const warnings = geometry?.issues.filter((i) => i.severity === 'warning') ?? []
  const flagged = useMemo(() => new Set(errors.map((e) => e.tile).filter(Boolean) as string[]), [errors])
  const selectedTiles = geometry?.tiles.filter((t) => selected.includes(t.key)) ?? []
  const single = selectedTiles.length === 1 ? selectedTiles[0] : null
  const seam = geometry?.seams.find((s) => s.id === selectedSeam) ?? null
  const active = geometry?.tiles.filter((t) => t.enabled) ?? []

  // ---- Imagem de referência -----------------------------------------------------------
  useEffect(() => {
    if (!background?.path) {
      setBackgroundUrl('')
      return
    }
    tilingService.signedUrl(background.path).then(setBackgroundUrl).catch(() => setBackgroundUrl(''))
  }, [background?.path])
  useEffect(() => {
    if (!backgroundUrl) return
    const img = new Image()
    img.onload = () => setBackgroundAspect(img.naturalHeight / Math.max(1, img.naturalWidth))
    img.src = backgroundUrl
  }, [backgroundUrl])

  const uploadBackground = async (file: File) => {
    if (!user || !project) return
    try {
      const path = await tilingService.uploadBackground(user.id, file)
      setBackground({ path, xMm: 0, yMm: 0, widthMm: Math.round(project.poster.width), opacity: 0.6, visible: true, visibleInGuide: true })
    } catch (err) {
      toast({ title: 'Não foi possível enviar a imagem', description: getErrorMessage(err), variant: 'destructive' })
    }
  }

  // ---- Salvar, exportar, modelos ------------------------------------------------------
  const config = (): TilingConfig | null =>
    project ? { version: 2, page: pageNumber, project, request: prefs.request, marks: prefs.marks } : null

  const save = async (): Promise<string | null> => {
    const cfg = config()
    if (!cfg || !job || !fileId || !geometry) return null
    const id = await tilingService.save(tilingId, {
      name: name || job.name,
      projectId: job.id,
      fileId,
      config: cfg,
      geometry,
      background,
    })
    setTilingId(id)
    loadSaved()
    return id
  }

  const exportPanels = async () => {
    if (!geometry || hasErrors(geometry.issues)) return
    setBusy(true)
    setDownloads({})
    try {
      const id = await save()
      if (id) await tilingService.export(id)
      loadSaved()
    } catch (err) {
      toast({ title: 'Não foi possível exportar', description: getErrorMessage(err), variant: 'destructive' })
    }
    setBusy(false)
  }

  useEffect(() => {
    if (current?.status !== 'completed') {
      setDownloads({})
      return
    }
    const output = current.output ?? {}
    Promise.all(
      (['pdf', 'zip', 'guide'] as const).map(
        async (key) => [key, output[key] ? await tilingService.signedUrl(output[key]!).catch(() => '') : ''] as const,
      ),
    ).then((pairs) => setDownloads(Object.fromEntries(pairs)))
  }, [current?.id, current?.status, current?.updated]) // eslint-disable-line react-hooks/exhaustive-deps

  const openSaved = async (row: TilingProject) => {
    const cfg = readConfig(row.config)
    if (!cfg) {
      toast({ title: 'Não foi possível ler este painelamento', variant: 'destructive' })
      return
    }
    setPending(cfg)
    await chooseJob(row.project_id ?? '', { fileId: row.file_id ?? '', scale: cfg.project.poster.scale })
    setTilingId(row.id)
    setName(row.name)
    setPageNumber(cfg.page || 1)
    setBackground(row.background)
  }

  const applyTemplate = (template: TilingTemplate) => {
    const cfg = readConfig(template.config)
    if (!cfg || !project) return
    const run = () => {
      commit(fitToPoster({ ...cfg.project, poster: project.poster }, project.poster))
      setPrefs((p) => ({ ...p, request: cfg.request, marks: cfg.marks }))
      if (template.background) setBackground(template.background)
      toast({ title: `Modelo "${template.name}" aplicado` })
    }
    if (hasManualEdits(project)) setConfirm({ message: 'O modelo substitui a grade e os ajustes atuais.', run })
    else run()
  }

  const saveTemplate = async () => {
    const cfg = config()
    if (!cfg || !templateName.trim()) return
    try {
      await tilingService.saveTemplate(templateName.trim(), cfg, background)
      setTemplateName('')
      setTemplates(await tilingService.listTemplates())
      toast({ title: 'Modelo salvo' })
    } catch (err) {
      toast({ title: 'Não foi possível salvar o modelo', description: getErrorMessage(err), variant: 'destructive' })
    }
  }

  // ---- Seleção ------------------------------------------------------------------------
  const selectWhere = (match: (t: { row: number; column: number }) => boolean) => {
    if (!geometry) return
    setSelectedSeam(null)
    setSelected(geometry.tiles.filter(match).map((t) => t.key))
  }

  const u = UNIT_FACTOR[unit]
  const show = (v: number) => String(Math.round((v / u) * 100) / 100)
  const running = current ? TILING_ACTIVE.includes(current.status) : false
  const rules = project?.rules
  const constraint = project?.constraint

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Painéis</h1>
          <p className="text-sm text-muted-foreground">
            Divida uma arte grande (veículo, fachada, empena) em painéis imprimíveis, com sobreposição, área de
            colagem, frestas e guia de instalação.
          </p>
        </div>
        {saved.length > 0 && (
          <Select value={tilingId ?? ''} onValueChange={(id) => { const row = saved.find((s) => s.id === id); if (row) openSaved(row) }}>
            <SelectTrigger className="w-72">
              <SelectValue placeholder="Abrir painelamento salvo" />
            </SelectTrigger>
            <SelectContent>
              {saved.map((row) => (
                <SelectItem key={row.id} value={row.id}>
                  {row.name || 'Sem nome'} · {row.status === 'completed' ? 'exportado' : row.status === 'draft' ? 'rascunho' : row.status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,370px)_minmax(0,1fr)]">
        <section className="space-y-5 rounded-lg border border-border bg-card p-4">
          <div className="space-y-2">
            <Label>1. Arte</Label>
            <Select value={jobId} onValueChange={(id) => chooseJob(id)}>
              <SelectTrigger>
                <SelectValue placeholder="Escolha o trabalho" />
              </SelectTrigger>
              <SelectContent>
                {jobs.map((j) => (
                  <SelectItem key={j.id} value={j.id}>
                    {j.name}
                    {j.clientName ? ` · ${j.clientName}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {art && art.pageCount > 1 && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Página</span>
                <Input className="h-8 w-20" inputMode="numeric" value={pageNumber} onChange={(e) => { setPageNumber(Math.min(art.pageCount, Math.max(1, Math.round(numberOr(e.target.value, 1))))); setProjectSource('') }} />
                <span className="text-muted-foreground">de {art.pageCount}</span>
              </div>
            )}
            {artError && <p className="text-sm text-destructive">Não foi possível abrir o PDF ({artError}).</p>}
          </div>

          {project && rules && constraint && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 flex items-center justify-between">
                  <Label>Tamanho final</Label>
                  <Select value={unit} onValueChange={(v) => setUnit(v as Unit)}>
                    <SelectTrigger className="h-8 w-20">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="mm">mm</SelectItem>
                      <SelectItem value="cm">cm</SelectItem>
                      <SelectItem value="m">m</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Largura ({unit})</Label>
                  <Input inputMode="decimal" value={show(project.poster.width)} onChange={(e) => { const w = numberOr(e.target.value, 0) * u; if (w > 0 && art) changeScale((w / (art.trim[2] - art.trim[0])) * MM) }} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Altura ({unit})</Label>
                  <Input inputMode="decimal" value={show(project.poster.height)} onChange={(e) => { const h = numberOr(e.target.value, 0) * u; if (h > 0 && art) changeScale((h / (art.trim[3] - art.trim[1])) * MM) }} />
                </div>
                <p className="col-span-2 text-xs text-muted-foreground">
                  Escala do arquivo 1:{Math.round(scale * 100) / 100} ({Math.round(scale * 10000) / 100}%), proporção mantida: a
                  arte nunca é distorcida nem reamostrada.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Label className="col-span-2">2. Material e grade</Label>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Largura imprimível ({unit})</Label>
                  <Input inputMode="decimal" value={constraint.printableWidth ? show(constraint.printableWidth) : ''} onChange={(e) => { const v = numberOr(e.target.value, 0) * u; setPrefs((p) => ({ ...p, constraint: { ...p.constraint, printableWidth: v } })); changeGlobal((p) => ({ ...p, constraint: { ...p.constraint, printableWidth: v } })) }} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Comprimento máx. ({unit})</Label>
                  <Input inputMode="decimal" placeholder="Rolo: sem limite" value={constraint.printableLength ? show(constraint.printableLength) : ''} onChange={(e) => { const v = numberOr(e.target.value, 0) * u; setPrefs((p) => ({ ...p, constraint: { ...p.constraint, printableLength: v } })); changeGlobal((p) => ({ ...p, constraint: { ...p.constraint, printableLength: v } })) }} />
                </div>
                <p className="col-span-2 -mt-1 text-xs text-muted-foreground">
                  Use a largura que a impressora realmente imprime (mídia menos as margens dela).
                </p>
                <div className="col-span-2 space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Painéis</Label>
                  <Select value={constraint.direction} onValueChange={(v) => { const direction = v as PrintConstraint['direction']; setPrefs((p) => ({ ...p, constraint: { ...p.constraint, direction } })); changeGlobal((p) => ({ ...p, constraint: { ...p.constraint, direction } })) }}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="standing">Em pé (largura do material = largura do painel)</SelectItem>
                      <SelectItem value="lying">Deitados (largura do material = altura do painel)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Colunas</Label>
                  <Input inputMode="numeric" placeholder="Automático" value={prefs.request.columns || ''} onChange={(e) => setPrefs((p) => ({ ...p, request: { ...p.request, columns: Math.max(0, Math.round(numberOr(e.target.value, 0))) } }))} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Linhas</Label>
                  <Input inputMode="numeric" placeholder="Automático" value={prefs.request.rows || ''} onChange={(e) => setPrefs((p) => ({ ...p, request: { ...p.request, rows: Math.max(0, Math.round(numberOr(e.target.value, 0))) } }))} />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Divisão automática</Label>
                  <Select value={prefs.request.mode} onValueChange={(v) => setPrefs((p) => ({ ...p, request: { ...p.request, mode: v as GridRequest['mode'] } }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="equal">Painéis iguais</SelectItem>
                      <SelectItem value="max">Máximo do material + resto</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button className="col-span-2" variant="outline" onClick={() => regrid(project, prefs.request, true)}>
                  <RotateCcw className="h-4 w-4" />
                  {prefs.request.columns || prefs.request.rows ? 'Aplicar colunas e linhas' : 'Recalcular a grade pelo material'}
                </Button>
                <p className="col-span-2 text-xs text-muted-foreground">
                  {hasManualEdits(project)
                    ? 'A grade foi ajustada à mão: mudanças no material não a refazem sozinhas.'
                    : 'Grade automática: acompanha o material, a sobreposição e a área branca.'}
                  {geometry && constraint.printableWidth > 0 && ` Uso da largura do material: ${Math.round(geometry.mediaUsage * 100)}%.`}
                </p>
              </div>

              <Collapsible>
                <CollapsibleTrigger className="flex w-full items-center justify-between text-sm font-medium">
                  Larguras das colunas e alturas das linhas
                  <Grid3x3 className="h-4 w-4 text-muted-foreground" />
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-3">
                  <GridSizes project={project} onChange={commit} />
                </CollapsibleContent>
              </Collapsible>

              <div className="space-y-2">
                <Label>3. Sobreposição padrão (mm)</Label>
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      ['next', 'Direita/cima cobre'],
                      ['previous', 'Esquerda/baixo cobre'],
                      ['split', 'Metade de cada'],
                    ] as const
                  ).map(([side, label]) => {
                    const total = Math.max(...Object.values(rules.overlap)) * (side === 'split' ? 2 : 1) || 20
                    return (
                      <Button key={side} size="sm" variant="outline" className="h-7 text-xs" onClick={() => { const overlap = edgesForSide(side, total); setPrefs((p) => ({ ...p, rules: { ...p.rules, overlap } })); changeGlobal((p) => ({ ...p, rules: { ...p.rules, overlap } })) }}>
                        {label}
                      </Button>
                    )
                  })}
                </div>
                <EdgesInput value={rules.overlap} onChange={(edge, v) => { const overlap = { ...rules.overlap, [edge]: v ?? 0 }; setPrefs((p) => ({ ...p, rules: { ...p.rules, overlap } })); changeGlobal((p) => ({ ...p, rules: { ...p.rules, overlap } })) }} />
                <p className="text-xs text-muted-foreground">
                  Faixa da arte vizinha repetida em cada borda. Só vale onde existe painel ao lado; cada painel pode ter
                  o seu (selecione-o).
                </p>
              </div>

              <div className="space-y-2">
                <Label>4. Área branca de colagem (mm)</Label>
                <EdgesInput value={rules.white} onChange={(edge, v) => { const white = { ...rules.white, [edge]: v ?? 0 }; setPrefs((p) => ({ ...p, rules: { ...p.rules, white } })); changeGlobal((p) => ({ ...p, rules: { ...p.rules, white } })) }} />
                <p className="text-xs text-muted-foreground">Sem tinta, fora da imagem: para colar, soldar ou fixar o painel.</p>
              </div>

              <div className="space-y-2">
                <Label>5. Sangria nas bordas externas (mm)</Label>
                <EdgesInput value={rules.bleed} onChange={(edge, v) => { const bleed = { ...rules.bleed, [edge]: v ?? 0 }; setPrefs((p) => ({ ...p, rules: { ...p.rules, bleed } })); changeGlobal((p) => ({ ...p, rules: { ...p.rules, bleed } })) }} />
                <p className="text-xs text-muted-foreground">
                  O arquivo tem {Object.entries(project.poster.availableBleed).map(([e, v]) => `${{ top: 'C', right: 'D', bottom: 'B', left: 'E' }[e]} ${Math.round(v)}`).join(' · ')} mm de sangria.
                  Fresta (vão sem impressão) é definida clicando numa linha da grade.
                </p>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Menor painel aceito (mm)</span>
                  <Input className="h-8 w-20" inputMode="decimal" value={rules.minimumTile} onChange={(e) => { const minimumTile = Math.max(1, numberOr(e.target.value, 50)); setPrefs((p) => ({ ...p, rules: { ...p.rules, minimumTile } })); commit({ ...project, rules: { ...project.rules, minimumTile } }) }} />
                </div>
              </div>

              <div className="space-y-2">
                <Label>6. Nomes dos arquivos</Label>
                <Input value={project.nameTemplate} onChange={(e) => { const nameTemplate = e.target.value; setPrefs((p) => ({ ...p, nameTemplate })); commit({ ...project, nameTemplate }) }} />
                <p className="text-xs text-muted-foreground">
                  {'{projeto}'}, {'{cliente}'}, {'{lin}'}, {'{col}'} (L1C1 = canto de cima à esquerda), {'{nn}'}/{'{n}'} (número) e {'{zona}'}.
                </p>
              </div>

              <div className="space-y-2">
                <Label>7. Imagem de referência</Label>
                <p className="text-xs text-muted-foreground">Gabarito do veículo ou foto da fachada. Só na tela e no guia, nunca nos painéis.</p>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-primary">
                  <Upload className="h-4 w-4" />
                  {background ? 'Trocar imagem' : 'Enviar imagem (PNG, JPEG ou WebP)'}
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) uploadBackground(file); e.target.value = '' }} />
                </label>
                {background && (
                  <div className="grid grid-cols-3 gap-2">
                    {(['xMm', 'yMm', 'widthMm'] as const).map((key) => (
                      <div key={key} className="space-y-1">
                        <Label className="text-xs text-muted-foreground">{{ xMm: 'X (mm)', yMm: 'Y (mm)', widthMm: 'Largura (mm)' }[key]}</Label>
                        <Input inputMode="decimal" value={background[key]} onChange={(e) => setBackground({ ...background, [key]: key === 'widthMm' ? Math.max(1, numberOr(e.target.value, 1)) : numberOr(e.target.value, 0) })} />
                      </div>
                    ))}
                    <div className="col-span-3 space-y-1">
                      <Label className="text-xs text-muted-foreground">Opacidade {Math.round(background.opacity * 100)}%</Label>
                      <Slider value={[background.opacity * 100]} min={5} max={100} step={5} onValueChange={([v]) => setBackground({ ...background, opacity: v / 100 })} />
                    </div>
                    <label className="col-span-3 flex items-center gap-2 text-sm">
                      <Checkbox checked={background.visibleInGuide} onCheckedChange={(v) => setBackground({ ...background, visibleInGuide: v === true })} />
                      Mostrar no guia de instalação
                    </label>
                    <div className="col-span-3 flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => setBackground({ ...background, visible: !background.visible })}>
                        {background.visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        {background.visible ? 'Ocultar na tela' : 'Mostrar na tela'}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setBackground(null)}>
                        <Trash2 className="h-4 w-4" />
                        Remover
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label>8. Marcas e etiqueta</Label>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Margem técnica em volta do painel (mm)</span>
                  <Input className="h-8 w-20" inputMode="decimal" value={prefs.marks.marginMm} onChange={(e) => setPrefs((p) => ({ ...p, marks: { ...p.marks, marginMm: Math.max(0, numberOr(e.target.value, 0)) } }))} />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={prefs.marks.cropMarks} onCheckedChange={(v) => setPrefs((p) => ({ ...p, marks: { ...p.marks, cropMarks: v === true } }))} />
                  Marcas de corte e de sobreposição
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={prefs.marks.label} onCheckedChange={(v) => setPrefs((p) => ({ ...p, marks: { ...p.marks, label: v === true } }))} />
                  Etiqueta com L/C, número, medidas e vizinhos
                </label>
              </div>

              <div className="space-y-2">
                <Label>Modelos</Label>
                {templates.length > 0 && (
                  <Select value="" onValueChange={(id) => { const t = templates.find((x) => x.id === id); if (t) applyTemplate(t) }}>
                    <SelectTrigger>
                      <SelectValue placeholder="Usar um modelo salvo" />
                    </SelectTrigger>
                    <SelectContent>
                      {templates.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <div className="flex gap-2">
                  <Input placeholder="Nome do modelo (ex.: Sprinter lateral)" value={templateName} onChange={(e) => setTemplateName(e.target.value)} />
                  <Button variant="outline" disabled={!templateName.trim()} onClick={saveTemplate} title="Salvar modelo">
                    <Save className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </section>

        <section className="min-w-0 space-y-3">
          {!project || !geometry ? (
            <p className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
              {pdfUrl ? 'Abrindo a arte…' : 'Escolha o trabalho com a arte grande.'}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-card p-2">
                <Input className="h-8 w-48" value={name} placeholder="Nome do projeto" onChange={(e) => setName(e.target.value)} />
                <span className="mx-1 h-5 w-px bg-border" />
                <Button size="sm" variant="ghost" disabled={!history.past.length} onClick={undo} title="Desfazer">
                  <Undo2 className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="ghost" disabled={!history.future.length} onClick={redo} title="Refazer">
                  <Redo2 className="h-4 w-4" />
                </Button>
                <span className="mx-1 h-5 w-px bg-border" />
                <Button size="sm" variant="outline" disabled={selectedTiles.length < 2} onClick={() => { const next = mergeTiles(project, selected); if (!next) { toast({ title: 'Os painéis escolhidos precisam formar um retângulo' }); return } commit(next); setSelected([]) }}>
                  <Combine className="h-4 w-4" />
                  Juntar
                </Button>
                <Button size="sm" variant="outline" disabled={!single || single.cells.length < 2} onClick={() => single && commit(splitTile(project, single.key))}>
                  <Scissors className="h-4 w-4" />
                  Separar
                </Button>
                <Button size="sm" variant="outline" disabled={!single} title="Nova linha vertical no meio do painel" onClick={() => single && commit(addLine(project, 'vertical', Math.round(single.logical.x + single.logical.w / 2)))}>
                  <SplitSquareHorizontal className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="outline" disabled={!single} title="Nova linha horizontal no meio do painel" onClick={() => single && commit(addLine(project, 'horizontal', Math.round(single.logical.y + single.logical.h / 2)))}>
                  <SplitSquareVertical className="h-4 w-4" />
                </Button>
                <span className="mx-1 h-5 w-px bg-border" />
                <span className="text-xs text-muted-foreground">Selecionar:</span>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => selectWhere(() => true)}>Tudo</Button>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={!single} onClick={() => single && selectWhere((t) => t.row === single.row)}>Linha</Button>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={!single} onClick={() => single && selectWhere((t) => t.column === single.column)}>Coluna</Button>
                <div className="ml-auto flex items-center gap-1.5">
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => save().then(() => toast({ title: 'Painelamento salvo' })).catch((err) => toast({ title: 'Não foi possível salvar', description: getErrorMessage(err), variant: 'destructive' }))}>
                    <Save className="h-4 w-4" />
                    Salvar
                  </Button>
                  <Button size="sm" disabled={busy || running || errors.length > 0 || !active.length} title={errors.length ? 'Corrija os erros antes de exportar' : undefined} onClick={exportPanels}>
                    {busy || running ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileArchive className="h-4 w-4" />}
                    Exportar painéis
                  </Button>
                </div>
              </div>

              <div className="h-[calc(100vh-18rem)] min-h-[360px] overflow-hidden rounded-lg border border-border bg-muted p-2">
                <TilingCanvas
                  art={art ? { url: art.url, rect: { x: ((art.visible[0] - art.trim[0]) * scale) / MM, y: ((art.visible[1] - art.trim[1]) * scale) / MM, w: ((art.visible[2] - art.visible[0]) * scale) / MM, h: ((art.visible[3] - art.visible[1]) * scale) / MM } } : null}
                  poster={{ w: project.poster.width, h: project.poster.height }}
                  background={background && background.visible && backgroundUrl ? { url: backgroundUrl, rect: { x: background.xMm, y: background.yMm, w: background.widthMm, h: background.widthMm * backgroundAspect }, opacity: background.opacity } : null}
                  geometry={geometry}
                  selected={selected}
                  selectedSeam={selectedSeam}
                  flagged={flagged}
                  onSelectTile={(key, additive) => {
                    setSelectedSeam(null)
                    setSelected((s) => (additive ? (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]) : [key]))
                  }}
                  onSelectSeam={(id) => {
                    setSelectedSeam(id)
                    if (id) setSelected([])
                  }}
                  onMoveSeam={(id, position) => {
                    if (!dragStart) setDragStart(project)
                    setProject((p) => (p ? moveLine(p, id, position) : p))
                  }}
                  onMoveEnd={() => {
                    if (dragStart) setHistory((h) => ({ past: [...h.past.slice(-79), dragStart], future: [] }))
                    setDragStart(null)
                  }}
                />
              </div>

              <div className="grid gap-3 xl:grid-cols-2">
                <div className="space-y-2 rounded-lg border border-border bg-card p-3 text-sm">
                  <p className="flex items-center gap-2 text-foreground">
                    {errors.length ? <AlertTriangle className="h-4 w-4 text-destructive" /> : <CircleCheck className="h-4 w-4 text-emerald-600" />}
                    <strong>{active.length}</strong> painéis
                    {errors.length ? ` · ${errors.length} erro(s) a corrigir antes de exportar` : ' · pronto para exportar'}
                  </p>
                  {[...errors, ...warnings].length > 0 && (
                    <ul className="max-h-40 space-y-1 overflow-auto">
                      {[...errors, ...warnings].map((issue, i) => (
                        <li key={i} className={cn('text-xs', issue.severity === 'error' ? 'text-destructive' : 'text-amber-700 dark:text-amber-400')}>
                          {issue.message}
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Azul: o que o painel cobre · tracejado: o que é impresso · pontilhado cinza: área branca · laranja:
                    sobreposição · cinza escuro: fresta · vermelho: não imprime. Shift + clique escolhe vários; arraste as
                    linhas para mudar a divisão.
                  </p>
                </div>

                {selectedTiles.length > 0 && <TileInspector project={project} tiles={selectedTiles} onChange={commit} />}
                {seam && <SeamInspector project={project} seam={seam} onChange={commit} onRemoved={() => setSelectedSeam(null)} />}
              </div>

              {current && current.id === tilingId && current.status !== 'draft' && (
                <div className="space-y-2 rounded-lg border border-border bg-card p-3 text-sm">
                  {running ? (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          {current.current_step || 'Na fila do analisador'}
                        </span>
                        <span className="text-muted-foreground">{current.progress}%</span>
                      </div>
                      <Progress value={current.progress} />
                    </>
                  ) : current.status === 'failed' ? (
                    <p className="text-destructive">A exportação falhou: {current.error_message || 'sem detalhes'}</p>
                  ) : (
                    <>
                      <p className="text-foreground">Painéis prontos ({current.result.panels ?? active.length}).</p>
                      {current.result.warnings?.map((w) => (
                        <p key={w} className="text-amber-700 dark:text-amber-400">{w}</p>
                      ))}
                      <div className="flex flex-wrap gap-2">
                        {downloads.pdf && (
                          <Button size="sm" variant="outline" asChild>
                            <a href={downloads.pdf} target="_blank" rel="noreferrer"><Download className="h-4 w-4" />Todos os painéis (PDF)</a>
                          </Button>
                        )}
                        {downloads.zip && !!current.result.sizes?.zip && (
                          <Button size="sm" variant="outline" asChild>
                            <a href={downloads.zip} target="_blank" rel="noreferrer"><FileArchive className="h-4 w-4" />Um arquivo por painel (ZIP)</a>
                          </Button>
                        )}
                        {downloads.guide && (
                          <Button size="sm" variant="outline" asChild>
                            <a href={downloads.guide} target="_blank" rel="noreferrer"><Download className="h-4 w-4" />Guia de instalação</a>
                          </Button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </section>
      </div>

      <AlertDialog open={!!confirm} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Recalcular a grade?</AlertDialogTitle>
            <AlertDialogDescription>{confirm?.message}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { confirm?.run(); setConfirm(null) }}>Recalcular</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
