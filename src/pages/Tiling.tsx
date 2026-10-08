import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  CircleCheck,
  Combine,
  Download,
  Eye,
  EyeOff,
  FileArchive,
  FolderOpen,
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
  XCircle,
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
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { EdgesInput } from '@/components/tiling/EdgesInput'
import { GridSizes } from '@/components/tiling/GridSizes'
import { IssuesList } from '@/components/tiling/IssuesList'
import { MediaPreview } from '@/components/tiling/MediaPreview'
import { PanelTable } from '@/components/tiling/PanelTable'
import { SeamInspector } from '@/components/tiling/SeamInspector'
import { TileInspector } from '@/components/tiling/TileInspector'
import { TilingCanvas } from '@/components/tiling/TilingCanvas'
import { InstallPanel, areaColor } from '@/components/tiling/InstallPanel'
import { Field, NumberField, Readout, Section, Segmented, TextField, fmt, fmtM, fmtMoney, fmtSize } from '@/components/tiling/fields'
import {
  addLine,
  autoGrid,
  calculateProject,
  DEFAULT_LABEL_BOTTOM,
  DEFAULT_LABEL_TOP,
  defaultMedia,
  edgesForSide,
  fillLabel,
  LABEL_TOKENS,
  revisionTag,
  fitToPoster,
  hasErrors,
  hasManualEdits,
  mergeTiles,
  moveInSequence,
  moveLine,
  newProject,
  setConstraint,
  setMedia,
  splitTile,
  zeroEdges,
  type Direction,
  type Edges,
  type GridRequest,
  type MediaSettings,
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
  contentHash,
  isOutdated,
  readConfig,
  TILING_ACTIVE,
  tilingService,
  type TilingBackground,
  type TilingConfig,
  type TilingMarksConfig,
  DEFAULT_CUT,
  type TilingCutConfig,
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

type Unit = 'mm' | 'cm' | 'm'
const UNIT_FACTOR: Record<Unit, number> = { mm: 1, cm: 10, m: 1000 }

type LeftTab = 'arte' | 'midia' | 'grade' | 'bordas' | 'instalacao' | 'saida'
type BottomTab = 'paineis' | 'problemas' | 'midia' | 'exportacao'

interface Prefs {
  constraint: PrintConstraint
  rules: Omit<TilingRules, 'bleed'> & { bleed?: Edges }
  nameTemplate: string
  request: GridRequest
  marks: TilingMarksConfig
  cut: TilingCutConfig
}

// Valores iniciais da tela; o operador ajusta a cada trabalho e o último uso é lembrado.
const DEFAULT_PREFS: Prefs = {
  constraint: { printableWidth: 0, printableLength: 0, direction: 'standing', media: defaultMedia(0) },
  rules: { overlap: edgesForSide('next', 20), white: zeroEdges(), minimumTile: 50 },
  nameTemplate: '{projeto}_L{lin}C{col}_{rev}',
  request: { mode: 'equal' },
  marks: {
    marginMm: 10,
    cropMarks: true,
    overlapMarks: true,
    centerMarks: false,
    label: true,
    labelTop: DEFAULT_LABEL_TOP,
    labelBottom: DEFAULT_LABEL_BOTTOM,
  },
  cut: DEFAULT_CUT,
}

function loadPrefs(): Prefs {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null')
    if (!saved) return DEFAULT_PREFS
    return {
      ...DEFAULT_PREFS,
      ...saved,
      constraint: { ...DEFAULT_PREFS.constraint, ...saved.constraint },
      marks: { ...DEFAULT_PREFS.marks, ...saved.marks },
      cut: { ...DEFAULT_CUT, ...saved.cut },
      request: { mode: saved.request?.mode ?? 'equal' },
    }
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

const STATUS_LABEL: Record<TilingProject['status'], string> = {
  draft: 'Rascunho',
  queued: 'Na fila',
  running: 'Exportando',
  completed: 'Exportado',
  failed: 'Falhou',
}

const NAME_TOKENS: [string, string][] = [
  ['{projeto}', 'Nome do projeto'],
  ['{cliente}', 'Cliente'],
  ['{lin}', 'Linha (1 = de cima)'],
  ['{col}', 'Coluna (1 = esquerda)'],
  ['{nn}', 'Número com 2 dígitos'],
  ['{area}', 'Área da instalação'],
  ['{ordem}', 'Ordem de instalação'],
  ['{rev}', 'Revisão (R1, R2…)'],
]

const time = (date: string | Date) =>
  new Date(date).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

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
  const [confirm, setConfirm] = useState<{ title: string; message: string; action: string; run: () => void } | null>(null)
  const [leftTab, setLeftTab] = useState<LeftTab>('arte')
  const [bottomTab, setBottomTab] = useState<BottomTab>('paineis')

  const [background, setBackground] = useState<TilingBackground | null>(null)
  const [backgroundUrl, setBackgroundUrl] = useState('')
  const [backgroundAspect, setBackgroundAspect] = useState(1)

  const [tilingId, setTilingId] = useState<string | null>(null)
  const [saved, setSaved] = useState<TilingProject[]>([])
  const [templates, setTemplates] = useState<TilingTemplate[]>([])
  const [templateName, setTemplateName] = useState('')
  const [busy, setBusy] = useState(false)
  const [downloads, setDownloads] = useState<{ pdf?: string; zip?: string; guide?: string }>({})
  const [savedSignature, setSavedSignature] = useState<string | null>(null)
  const cleanOnLoad = useRef(false)
  const [revision, setRevision] = useState(1)
  const [exportedHash, setExportedHash] = useState<string | undefined>()
  const [labelField, setLabelField] = useState<'labelTop' | 'labelBottom'>('labelTop')

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
  const regrid = (base: TilingProjectModel, request: GridRequest) => {
    const run = () => {
      commit(autoGrid(base, request))
      setSelected([])
      setSelectedSeam(null)
    }
    if (hasManualEdits(base)) {
      setConfirm({
        title: 'Recalcular a grade?',
        message: 'A grade será refeita pelos parâmetros e os ajustes manuais (linhas movidas, painéis juntados, frestas, ajustes por painel) serão perdidos.',
        action: 'Recalcular',
        run,
      })
    } else run()
  }

  /** Mudança global (material, regras): na grade automática ela é recalculada na hora. */
  const changeGlobal = (next: TilingProjectModel) => {
    if (!project) return
    if (hasManualEdits(project)) commit(next)
    else commit(autoGrid(next, prefs.request))
  }

  const updateConstraint = (patch: Partial<PrintConstraint>) => {
    if (!project) return
    const next = setConstraint(project, patch)
    setPrefs((p) => ({ ...p, constraint: next.constraint }))
    changeGlobal(next)
  }
  const updateMedia = (patch: Partial<MediaSettings>) => {
    if (!project) return
    const media = { ...(project.constraint.media ?? defaultMedia(project.constraint.printableWidth)), ...patch }
    const next = setMedia(project, media)
    setPrefs((p) => ({ ...p, constraint: next.constraint }))
    changeGlobal(next)
  }
  const updateRules = (patch: Partial<TilingRules>) => {
    if (!project) return
    setPrefs((p) => ({ ...p, rules: { ...p.rules, ...patch } }))
    changeGlobal({ ...project, rules: { ...project.rules, ...patch } })
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
        setSavedSignature(null)
        setRevision(1)
        setExportedHash(undefined)
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
      setPrefs((p) => ({
        ...p,
        request: pending.request,
        marks: { ...DEFAULT_PREFS.marks, ...pending.marks },
        cut: { ...DEFAULT_CUT, ...pending.cut },
      }))
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
  const projectName = name || job?.name || ''
  const engineContext = (rev: number) => ({
    project: projectName,
    client: job?.clientName,
    marksMargin: prefs.marks.marginMm,
    revision: rev,
  })
  const geometry = useMemo(
    () => (project ? calculateProject(project, engineContext(revision)) : null),
    [project, projectName, job, prefs.marks.marginMm, revision], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const issues = useMemo(() => geometry?.issues ?? [], [geometry])
  const errors = useMemo(() => issues.filter((i) => i.severity === 'error'), [issues])
  const warnings = issues.filter((i) => i.severity === 'warning')
  const flagged = useMemo(() => new Set(errors.map((e) => e.tile).filter(Boolean) as string[]), [errors])
  const selectedTiles = geometry?.tiles.filter((t) => selected.includes(t.key)) ?? []
  const single = selectedTiles.length === 1 ? selectedTiles[0] : null
  const seam = geometry?.seams.find((s) => s.id === selectedSeam) ?? null
  const active = geometry?.tiles.filter((t) => t.enabled) ?? []
  const numbers = useMemo(() => Object.fromEntries((geometry?.tiles ?? []).map((t) => [t.id, t.number])), [geometry])

  // ---- Salvo / alterado ---------------------------------------------------------------
  const signature = useMemo(
    () => (project ? JSON.stringify([project, name, background, prefs.marks, prefs.request, pageNumber]) : ''),
    [project, name, background, prefs.marks, prefs.request, pageNumber],
  )
  useEffect(() => {
    if (cleanOnLoad.current && project) {
      cleanOnLoad.current = false
      setSavedSignature(signature)
    }
  }, [signature]) // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = !!project && signature !== savedSignature
  // Exportado e mudado depois: os arquivos baixados já não são deste projeto.
  const hash = useMemo(
    () =>
      project
        ? contentHash({ project, name: projectName, page: pageNumber, marks: prefs.marks, background, cut: prefs.cut })
        : '',
    [project, projectName, pageNumber, prefs.marks, prefs.cut, background],
  )
  const outdated = !!current && current.id === tilingId && current.status === 'completed' && !!exportedHash && exportedHash !== hash

  /** Etiqueta de um painel, como vai sair impressa. */
  const labelOf = (template: string, tile: NonNullable<typeof geometry>['tiles'][number]) =>
    fillLabel(template, tile, {
      project: projectName,
      client: job?.clientName,
      total: active.length,
      revision,
      date: new Date().toLocaleDateString('pt-BR'),
      numberOf: (id) => numbers[id],
    })

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
  const config = (extra: { revision?: number; exportedHash?: string } = {}): TilingConfig | null =>
    project
      ? {
          version: 2,
          page: pageNumber,
          project,
          request: prefs.request,
          marks: prefs.marks,
          cut: prefs.cut,
          revision: extra.revision ?? revision,
          exportedHash: extra.exportedHash ?? exportedHash,
        }
      : null

  const save = async (extra: { revision?: number; exportedHash?: string } = {}): Promise<string | null> => {
    const cfg = config(extra)
    if (!cfg || !project || !job || !fileId) return null
    const rev = cfg.revision ?? 1
    const id = await tilingService.save(tilingId, {
      name: projectName,
      projectId: job.id,
      fileId,
      config: cfg,
      // Nomes e etiquetas com a revisão que vai nos arquivos.
      geometry: calculateProject(project, engineContext(rev)),
      background,
      labels: {
        marks: prefs.marks,
        context: { project: projectName, client: job.clientName, revision: rev, date: new Date().toLocaleDateString('pt-BR') },
      },
    })
    setTilingId(id)
    setSavedSignature(signature)
    loadSaved()
    return id
  }

  const saveNow = () =>
    save()
      .then((id) => id && toast({ title: 'Painelamento salvo' }))
      .catch((err) => toast({ title: 'Não foi possível salvar', description: getErrorMessage(err), variant: 'destructive' }))

  const exportPanels = async () => {
    if (!geometry || hasErrors(geometry.issues)) {
      setBottomTab('problemas')
      return
    }
    setBusy(true)
    setDownloads({})
    setBottomTab('exportacao')
    try {
      // Exportar de novo um projeto alterado gera a próxima revisão (R2, R3…).
      const nextRevision = outdated ? revision + 1 : revision
      setRevision(nextRevision)
      setExportedHash(hash)
      const id = await save({ revision: nextRevision, exportedHash: hash })
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
    cleanOnLoad.current = true
    await chooseJob(row.project_id ?? '', { fileId: row.file_id ?? '', scale: cfg.project.poster.scale })
    setTilingId(row.id)
    setName(row.name)
    setPageNumber(cfg.page || 1)
    setBackground(row.background)
    setRevision(cfg.revision ?? 1)
    setExportedHash(cfg.exportedHash)
    setLeftTab('grade')
    if (row.status !== 'draft') setBottomTab('exportacao')
  }

  const removeSaved = (row: TilingProject) =>
    setConfirm({
      title: 'Apagar o painelamento?',
      message: `"${row.name || 'Sem nome'}" e os arquivos exportados deixam de aparecer aqui. A arte do trabalho não é alterada.`,
      action: 'Apagar',
      run: () =>
        tilingService
          .remove(row.id)
          .then(() => {
            if (row.id === tilingId) setTilingId(null)
            loadSaved()
          })
          .catch((err) => toast({ title: 'Não foi possível apagar', description: getErrorMessage(err), variant: 'destructive' })),
    })

  const applyTemplate = (template: TilingTemplate) => {
    const cfg = readConfig(template.config)
    if (!cfg || !project) return
    const run = () => {
      commit(fitToPoster({ ...cfg.project, poster: project.poster }, project.poster))
      setPrefs((p) => ({
        ...p,
        request: cfg.request,
        marks: { ...DEFAULT_PREFS.marks, ...cfg.marks },
        cut: { ...DEFAULT_CUT, ...cfg.cut },
      }))
      if (template.background) setBackground(template.background)
      toast({ title: `Modelo "${template.name}" aplicado` })
    }
    if (hasManualEdits(project)) {
      setConfirm({ title: 'Aplicar o modelo?', message: 'O modelo substitui a grade e os ajustes atuais.', action: 'Aplicar', run })
    } else run()
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
  const selectTile = (key: string, additive: boolean) => {
    setSelectedSeam(null)
    setSelected((s) => (additive ? (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]) : [key]))
  }
  const selectWhere = (match: (t: { row: number; column: number }) => boolean) => {
    if (!geometry) return
    setSelectedSeam(null)
    setSelected(geometry.tiles.filter(match).map((t) => t.key))
  }
  const moveOrder = (key: string, delta: -1 | 1) => {
    if (project && geometry) commit(moveInSequence(project, geometry, key, delta))
  }
  // Na aba Instalação, cada área ganha uma cor na prancheta.
  const areaFills = useMemo(() => {
    if (!project || !geometry) return {}
    const fills: Record<string, string> = {}
    for (const t of geometry.tiles) {
      const color = t.zone ? areaColor(project, t.zone) : undefined
      if (color) fills[t.key] = color
    }
    return fills
  }, [project, geometry])
  const selectById = (id: string) => {
    const t = geometry?.tiles.find((x) => x.id === id)
    if (t) selectTile(t.key, false)
  }

  // Atalhos: Ctrl+Z / Ctrl+Y (ou Ctrl+Shift+Z), Ctrl+S, Esc limpa a seleção.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (project) saveNow()
        return
      }
      if (typing) return
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
      } else if (e.key === 'Escape') {
        setSelected([])
        setSelectedSeam(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const u = UNIT_FACTOR[unit]
  const running = current ? TILING_ACTIVE.includes(current.status) : false
  const rules = project?.rules
  const constraint = project?.constraint
  const media = constraint ? (constraint.media ?? defaultMedia(constraint.printableWidth)) : null
  const columns = project ? project.grid.xs.length - 1 : 0
  const rows = project ? project.grid.ys.length - 1 : 0
  const disabledCount = (geometry?.tiles.length ?? 0) - active.length

  const tabs: { id: LeftTab; label: string }[] = [
    { id: 'arte', label: 'Arte' },
    { id: 'midia', label: 'Mídia' },
    { id: 'grade', label: 'Grade' },
    { id: 'bordas', label: 'Bordas' },
    { id: 'instalacao', label: 'Instalação' },
    { id: 'saida', label: 'Saída' },
  ]

  return (
    <div className="flex h-[calc(100vh-56px)] min-h-[560px] flex-col bg-background text-sm">
      {/* ---- Barra de ferramentas ---- */}
      <div className="flex min-h-11 flex-wrap items-center gap-1 border-b border-border bg-card px-2 py-1">
        <span className="px-1 text-sm font-semibold text-foreground">Painéis</span>
        <Divider />
        <Input
          className="h-7 w-52 text-xs"
          value={name}
          placeholder="Nome do projeto"
          disabled={!project}
          onChange={(e) => setName(e.target.value)}
        />
        <Divider />
        <ToolButton title="Desfazer (Ctrl+Z)" disabled={!history.past.length} onClick={undo}>
          <Undo2 className="h-4 w-4" />
        </ToolButton>
        <ToolButton title="Refazer (Ctrl+Y)" disabled={!history.future.length} onClick={redo}>
          <Redo2 className="h-4 w-4" />
        </ToolButton>
        <Divider />
        <ToolButton
          title="Juntar os painéis selecionados (precisam formar um retângulo)"
          disabled={!project || selectedTiles.length < 2}
          onClick={() => {
            if (!project) return
            const next = mergeTiles(project, selected)
            if (!next) {
              toast({ title: 'Os painéis escolhidos precisam formar um retângulo' })
              return
            }
            commit(next)
            setSelected([])
          }}
          label="Juntar"
        >
          <Combine className="h-4 w-4" />
        </ToolButton>
        <ToolButton title="Separar o painel juntado" disabled={!project || !single || single.cells.length < 2} onClick={() => project && single && commit(splitTile(project, single.key))} label="Separar">
          <Scissors className="h-4 w-4" />
        </ToolButton>
        <ToolButton
          title="Nova linha vertical no meio do painel selecionado"
          disabled={!project || !single}
          onClick={() => project && single && commit(addLine(project, 'vertical', Math.round(single.logical.x + single.logical.w / 2)))}
        >
          <SplitSquareHorizontal className="h-4 w-4" />
        </ToolButton>
        <ToolButton
          title="Nova linha horizontal no meio do painel selecionado"
          disabled={!project || !single}
          onClick={() => project && single && commit(addLine(project, 'horizontal', Math.round(single.logical.y + single.logical.h / 2)))}
        >
          <SplitSquareVertical className="h-4 w-4" />
        </ToolButton>
        <Divider />
        <span className="px-1 text-xs text-muted-foreground">Selecionar</span>
        <ToolButton disabled={!project} onClick={() => selectWhere(() => true)} label="Todos" />
        <ToolButton disabled={!single} onClick={() => single && selectWhere((t) => t.row === single.row)} label="Linha" />
        <ToolButton disabled={!single} onClick={() => single && selectWhere((t) => t.column === single.column)} label="Coluna" />

        <div className="ml-auto flex items-center gap-1.5">
          {project && (
            <span className={cn('px-2 text-xs', dirty ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground')}>
              {dirty ? 'Alterações não salvas' : current ? `Salvo ${time(current.updated)}` : ''}
            </span>
          )}
          {outdated && (
            <button
              type="button"
              className="rounded bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-800 hover:bg-amber-500/25 dark:text-amber-300"
              title="O projeto mudou depois da exportação"
              onClick={() => setBottomTab('exportacao')}
            >
              Exportação desatualizada
            </button>
          )}
          {saved.length > 0 && (
            <Select
              value=""
              onValueChange={(id) => {
                const row = saved.find((s) => s.id === id)
                if (row) openSaved(row)
              }}
            >
              <SelectTrigger className="h-7 w-32 text-xs">
                <FolderOpen className="h-3.5 w-3.5" />
                <SelectValue placeholder="Abrir" />
              </SelectTrigger>
              <SelectContent align="end">
                {saved.map((row) => (
                  <SelectItem key={row.id} value={row.id}>
                    {row.name || 'Sem nome'} · {STATUS_LABEL[row.status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy || !project} onClick={saveNow} title="Salvar (Ctrl+S)">
            <Save className="h-3.5 w-3.5" />
            Salvar
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs"
            disabled={busy || running || !project || !active.length}
            title={errors.length ? 'Há erros: veja a aba Problemas' : 'Gera o PDF dos painéis, um arquivo por painel e o guia'}
            onClick={exportPanels}
          >
            {busy || running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileArchive className="h-3.5 w-3.5" />}
            Exportar
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* ---- Propriedades do projeto ---- */}
        <aside className="flex w-full shrink-0 flex-col border-b border-border bg-card lg:w-[300px] lg:border-b-0 lg:border-r">
          <div className="flex border-b border-border">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                disabled={tab.id !== 'arte' && !project}
                onClick={() => setLeftTab(tab.id)}
                className={cn(
                  '-mb-px flex-1 border-b-2 px-0.5 py-2 text-[11px] transition-colors disabled:opacity-40',
                  leftTab === tab.id ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {leftTab === 'arte' && (
              <>
                <Section title="Trabalho">
                  <Select value={jobId} onValueChange={(id) => chooseJob(id)}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Escolha o trabalho com a arte" />
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
                    <Field label={`Página (de ${art.pageCount})`}>
                      <NumberField
                        unit=""
                        integer
                        min={1}
                        value={pageNumber}
                        onCommit={(v) => {
                          setPageNumber(Math.min(art.pageCount, Math.max(1, v ?? 1)))
                          setProjectSource('')
                        }}
                      />
                    </Field>
                  )}
                  {artError && <p className="text-xs text-destructive">Não foi possível abrir o PDF ({artError}).</p>}
                  {pdfUrl && !project && !artError && (
                    <p className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Abrindo a arte…
                    </p>
                  )}
                </Section>
                {project && art && (
                  <>
                    <Section
                      title="Tamanho final"
                      action={
                        <Segmented<Unit>
                          value={unit}
                          onChange={setUnit}
                          options={(['mm', 'cm', 'm'] as const).map((v) => ({ value: v, label: v }))}
                        />
                      }
                    >
                      <Field label="Largura">
                        <NumberField
                          unit={unit}
                          value={project.poster.width / u}
                          onCommit={(v) => v && changeScale(((v * u) / (art.trim[2] - art.trim[0])) * MM)}
                        />
                      </Field>
                      <Field label="Altura">
                        <NumberField
                          unit={unit}
                          value={project.poster.height / u}
                          onCommit={(v) => v && changeScale(((v * u) / (art.trim[3] - art.trim[1])) * MM)}
                        />
                      </Field>
                      <Field label="Escala do arquivo" hint="1:10 = o arquivo está em 10% do tamanho final. A proporção é sempre mantida e a arte nunca é reamostrada.">
                        <NumberField unit="1:x" value={scale} min={0.001} onCommit={(v) => v && changeScale(v)} />
                      </Field>
                    </Section>
                    <Section title="Arquivo">
                      <Readout label="Formato no arquivo" value={`${fmt(((art.trim[2] - art.trim[0]) / MM), 1)} × ${fmt(((art.trim[3] - art.trim[1]) / MM), 1)} mm`} />
                      <Readout
                        label="Sangria disponível"
                        hint="Arte além do formato final que o arquivo tem (cima, direita, baixo, esquerda)"
                        value={(['top', 'right', 'bottom', 'left'] as const).map((e) => fmt(project.poster.availableBleed[e], 0)).join(' / ') + ' mm'}
                      />
                      {art.pageCount > 1 && <Readout label="Páginas" value={art.pageCount} />}
                    </Section>
                    <Section title="Imagem de referência">
                      <p className="text-[11px] text-muted-foreground">Foto ou gabarito do local de instalação (fachada, parede, vitrine, veículo…). Só na tela e no guia, nunca nos painéis.</p>
                      <label className="flex cursor-pointer items-center gap-2 text-xs text-primary hover:underline">
                        <Upload className="h-3.5 w-3.5" />
                        {background ? 'Trocar imagem' : 'Enviar imagem (PNG, JPEG ou WebP)'}
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0]
                            if (file) uploadBackground(file)
                            e.target.value = ''
                          }}
                        />
                      </label>
                      {background && (
                        <>
                          <Field label="Posição X">
                            <NumberField value={background.xMm} min={-1e6} onCommit={(v) => setBackground({ ...background, xMm: v ?? 0 })} />
                          </Field>
                          <Field label="Posição Y">
                            <NumberField value={background.yMm} min={-1e6} onCommit={(v) => setBackground({ ...background, yMm: v ?? 0 })} />
                          </Field>
                          <Field label="Largura">
                            <NumberField value={background.widthMm} min={1} onCommit={(v) => setBackground({ ...background, widthMm: v ?? 1 })} />
                          </Field>
                          <Field label={`Opacidade ${Math.round(background.opacity * 100)}%`}>
                            <Slider value={[background.opacity * 100]} min={5} max={100} step={5} onValueChange={([v]) => setBackground({ ...background, opacity: v / 100 })} />
                          </Field>
                          <CheckRow checked={background.visibleInGuide} onChange={(v) => setBackground({ ...background, visibleInGuide: v })}>
                            Mostrar no guia de instalação
                          </CheckRow>
                          <div className="flex gap-1">
                            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setBackground({ ...background, visible: !background.visible })}>
                              {background.visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                              {background.visible ? 'Ocultar' : 'Mostrar'}
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setBackground(null)}>
                              <Trash2 className="h-3.5 w-3.5" />
                              Remover
                            </Button>
                          </div>
                        </>
                      )}
                    </Section>
                  </>
                )}
              </>
            )}

            {leftTab === 'midia' && project && constraint && media && (
              <>
                <Section title="Mídia na impressora">
                  <Field label="Largura da mídia">
                    <NumberField value={media.width} onCommit={(v) => updateMedia({ width: v ?? 0 })} />
                  </Field>
                  <Field label="Margem esquerda" hint="Faixa que a impressora não imprime">
                    <NumberField value={media.marginLeft} onCommit={(v) => updateMedia({ marginLeft: v ?? 0 })} />
                  </Field>
                  <Field label="Margem direita" hint="Faixa que a impressora não imprime">
                    <NumberField value={media.marginRight} onCommit={(v) => updateMedia({ marginRight: v ?? 0 })} />
                  </Field>
                  <Field label="Barra de cor" hint="Faixa reservada para a barra de cor/controle, ao lado dos painéis">
                    <NumberField value={media.colorBar} onCommit={(v) => updateMedia({ colorBar: v ?? 0 })} />
                  </Field>
                  <div className="mt-1 border-t border-dashed border-border pt-1.5">
                    <Readout
                      label="Largura imprimível"
                      strong
                      value={constraint.printableWidth > 0 ? `${fmt(constraint.printableWidth)} mm` : 'não informada'}
                      tone={constraint.printableWidth > 0 ? undefined : 'warning'}
                    />
                  </div>
                  <Field label="Comprimento máx." hint="Limite de comprimento por painel (chapa ou impressora). Vazio = rolo sem limite.">
                    <NumberField
                      allowEmpty
                      placeholder="sem limite"
                      value={constraint.printableLength || undefined}
                      onCommit={(v) => updateConstraint({ printableLength: v ?? 0 })}
                    />
                  </Field>
                </Section>
                <Section title="Posição dos painéis na mídia">
                  <Segmented<Direction>
                    value={constraint.direction}
                    onChange={(direction) => updateConstraint({ direction })}
                    options={[
                      { value: 'standing', label: 'Em pé', hint: 'A largura do painel vai na largura da mídia' },
                      { value: 'lying', label: 'Deitado', hint: 'A altura do painel vai na largura da mídia (girado 90°)' },
                      { value: 'auto', label: 'Automático', hint: 'Cada painel na posição que cabe e gasta menos mídia' },
                    ]}
                  />
                  <CheckRow checked={!!constraint.flipFlop} onChange={(flipFlop) => updateConstraint({ flipFlop })}>
                    <span title="Painéis alternados saem girados 180°: as duas bordas de cada emenda são impressas do mesmo lado da cabeça, e a cor fica igual na emenda.">
                      Flip-flop (alternar 180°)
                    </span>
                  </CheckRow>
                </Section>
                <Section title="Consumo e custo">
                  <Field label="Espaço entre painéis" hint="Distância entre painéis na mídia, para o corte">
                    <NumberField value={media.spacing} onCommit={(v) => updateMedia({ spacing: v ?? 0 })} />
                  </Field>
                  <Field label="Preço da mídia">
                    <NumberField unit="R$/m²" value={media.pricePerM2} onCommit={(v) => updateMedia({ pricePerM2: v ?? 0 })} />
                  </Field>
                  {geometry?.media && (
                    <div className="mt-1 space-y-1 border-t border-dashed border-border pt-1.5">
                      <Readout label="Uso da largura" hint="Painel mais largo ÷ largura imprimível" value={`${fmt(geometry.mediaUsage * 100, 0)}%`} />
                      <Readout label="Comprimento consumido" value={fmtM(geometry.media.length)} />
                      <Readout label="Desperdício" value={`${fmt(geometry.media.waste * 100, 1)}%`} />
                      <Readout label="Custo da mídia" value={geometry.media.cost === null ? '—' : fmtMoney(geometry.media.cost)} strong />
                    </div>
                  )}
                </Section>
              </>
            )}

            {leftTab === 'grade' && project && rules && (
              <>
                <Section title="Divisão automática">
                  <Segmented<GridRequest['mode']>
                    value={prefs.request.mode}
                    onChange={(mode) => setPrefs((p) => ({ ...p, request: { ...p.request, mode } }))}
                    options={[
                      { value: 'equal', label: 'Painéis iguais', hint: 'Todos os painéis com a mesma medida' },
                      { value: 'max', label: 'Máximo + resto', hint: 'Painéis no máximo do material e o resto no último' },
                    ]}
                  />
                  <Field label="Colunas" hint="Vazio = calcular pelo material">
                    <NumberField
                      unit=""
                      integer
                      min={1}
                      allowEmpty
                      placeholder="auto"
                      value={prefs.request.columns || undefined}
                      onCommit={(v) => setPrefs((p) => ({ ...p, request: { ...p.request, columns: v } }))}
                    />
                  </Field>
                  <Field label="Linhas" hint="Vazio = calcular pelo material">
                    <NumberField
                      unit=""
                      integer
                      min={1}
                      allowEmpty
                      placeholder="auto"
                      value={prefs.request.rows || undefined}
                      onCommit={(v) => setPrefs((p) => ({ ...p, request: { ...p.request, rows: v } }))}
                    />
                  </Field>
                  <Button size="sm" variant="outline" className="h-7 w-full text-xs" onClick={() => regrid(project, prefs.request)}>
                    <RotateCcw className="h-3.5 w-3.5" />
                    Recalcular a grade
                  </Button>
                  <Readout
                    label="Grade atual"
                    value={`${columns} × ${rows} · ${hasManualEdits(project) ? 'editada à mão' : 'automática'}`}
                    hint={
                      hasManualEdits(project)
                        ? 'Mudanças no material e nas bordas não refazem a grade sozinhas'
                        : 'Acompanha o material, a sobreposição e a área branca'
                    }
                  />
                </Section>
                <Section title="Medidas da grade">
                  <GridSizes project={project} onChange={commit} />
                </Section>
                <Section title="Limites">
                  <Field label="Menor painel aceito" hint="Nenhum painel pode cobrir menos que isso na largura ou na altura">
                    <NumberField
                      value={rules.minimumTile}
                      min={1}
                      onCommit={(v) => {
                        const minimumTile = Math.max(1, v ?? 50)
                        setPrefs((p) => ({ ...p, rules: { ...p.rules, minimumTile } }))
                        commit({ ...project, rules: { ...project.rules, minimumTile } })
                      }}
                    />
                  </Field>
                </Section>
              </>
            )}

            {leftTab === 'bordas' && project && rules && (
              <>
                <Section title="Sobreposição padrão">
                  <Segmented
                    value={
                      rules.overlap.left > 0 && rules.overlap.right === 0
                        ? 'next'
                        : rules.overlap.right > 0 && rules.overlap.left === 0
                          ? 'previous'
                          : rules.overlap.left > 0 && rules.overlap.left === rules.overlap.right
                            ? 'split'
                            : ('' as string)
                    }
                    onChange={(side) => {
                      const total = Math.max(...Object.values(rules.overlap)) * (side === 'split' ? 2 : 1) || 20
                      updateRules({ overlap: edgesForSide(side as 'next' | 'previous' | 'split', total) })
                    }}
                    options={[
                      { value: 'next', label: 'Dir./cima cobre', hint: 'O painel da direita (ou de cima) imprime a faixa repetida' },
                      { value: 'previous', label: 'Esq./baixo cobre', hint: 'O painel da esquerda (ou de baixo) imprime a faixa repetida' },
                      { value: 'split', label: 'Metade', hint: 'Metade da faixa em cada painel' },
                    ]}
                  />
                  <EdgesInput value={rules.overlap} onChange={(edge, v) => updateRules({ overlap: { ...rules.overlap, [edge]: v ?? 0 } })} />
                  <p className="text-[11px] text-muted-foreground">Faixa da arte vizinha repetida em cada borda. Só vale onde há painel ao lado.</p>
                </Section>
                <Section title="Área branca de colagem">
                  <EdgesInput value={rules.white} onChange={(edge, v) => updateRules({ white: { ...rules.white, [edge]: v ?? 0 } })} />
                  <p className="text-[11px] text-muted-foreground">Sem tinta, fora da imagem: para colar, soldar ou fixar.</p>
                </Section>
                <Section title="Sangria nas bordas externas">
                  <EdgesInput value={rules.bleed} onChange={(edge, v) => updateRules({ bleed: { ...rules.bleed, [edge]: v ?? 0 } })} />
                  <Readout
                    label="Disponível no arquivo"
                    value={(['top', 'right', 'bottom', 'left'] as const).map((e) => fmt(project.poster.availableBleed[e], 0)).join(' / ') + ' mm'}
                    hint="Cima / direita / baixo / esquerda"
                  />
                </Section>
                <p className="px-3 py-2 text-[11px] text-muted-foreground">
                  Fresta (vão sem impressão): clique numa linha da grade. Ajuste de um painel só: clique no painel.
                </p>
              </>
            )}

            {leftTab === 'instalacao' && project && geometry && (
              <InstallPanel
                project={project}
                geometry={geometry}
                selected={selected}
                onChange={commit}
                onSelect={(key) => selectTile(key, false)}
                onMoveOrder={moveOrder}
              />
            )}

            {leftTab === 'saida' && project && (
              <>
                <Section title="Nome dos arquivos">
                  <TextField
                    value={project.nameTemplate}
                    onCommit={(nameTemplate) => {
                      setPrefs((p) => ({ ...p, nameTemplate }))
                      commit({ ...project, nameTemplate })
                    }}
                  />
                  <div className="flex flex-wrap gap-1">
                    {NAME_TOKENS.map(([token, label]) => (
                      <button
                        key={token}
                        type="button"
                        title={`${label}: clique para incluir`}
                        className="rounded border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
                        onClick={() => {
                          const nameTemplate = project.nameTemplate + token
                          setPrefs((p) => ({ ...p, nameTemplate }))
                          commit({ ...project, nameTemplate })
                        }}
                      >
                        {token}
                      </button>
                    ))}
                  </div>
                  {active[0] && <Readout label="Exemplo" value={`${active[0].name}.pdf`} />}
                  <Readout
                    label="Revisão"
                    value={revisionTag(revision)}
                    hint="Sobe sozinha quando um projeto já exportado é alterado e exportado de novo. Use {rev} no nome."
                    strong
                  />
                </Section>
                <Section title="Faca (linha de corte)">
                  <p className="text-[11px] text-muted-foreground">
                    Vai na separação de corte: o RIP manda para a plotter, não imprime.
                  </p>
                  <CheckRow checked={prefs.cut.contour} onChange={(contour) => setPrefs((p) => ({ ...p, cut: { ...p.cut, contour } }))}>
                    <span title="A faca segue o contorno da arte e cada painel recebe só o trecho dele">Pelo contorno da arte</span>
                  </CheckRow>
                  {prefs.cut.contour && (
                    <>
                      <Field label="Afastamento" hint="Positivo = para fora da arte; negativo = para dentro; 0 = na borda da arte">
                        <NumberField
                          value={prefs.cut.offsetMm}
                          min={-50}
                          onCommit={(v) => setPrefs((p) => ({ ...p, cut: { ...p.cut, offsetMm: v ?? 0 } }))}
                        />
                      </Field>
                      <CheckRow checked={prefs.cut.cutHoles} onChange={(cutHoles) => setPrefs((p) => ({ ...p, cut: { ...p.cut, cutHoles } }))}>
                        Cortar os vazados internos
                      </CheckRow>
                      <CheckRow
                        checked={prefs.cut.whiteBackground === 'keep'}
                        onChange={(keep) => setPrefs((p) => ({ ...p, cut: { ...p.cut, whiteBackground: keep ? 'keep' : 'ignore' } }))}
                      >
                        <span title="Normalmente o fundo branco é papel e não é contornado">Fundo branco faz parte da arte</span>
                      </CheckRow>
                    </>
                  )}
                  <CheckRow checked={prefs.cut.panelEdge} onChange={(panelEdge) => setPrefs((p) => ({ ...p, cut: { ...p.cut, panelEdge } }))}>
                    <span title="Retângulo de corte na borda do painel físico, para soltar cada painel do rolo">Em volta de cada painel</span>
                  </CheckRow>
                  {(prefs.cut.contour || prefs.cut.panelEdge) && (
                    <Field label="Nome da separação" hint="Como o RIP/plotter reconhece a faca (ex.: CutContour, Thru-cut)">
                      <TextField
                        value={prefs.cut.name}
                        onCommit={(name) => setPrefs((p) => ({ ...p, cut: { ...p.cut, name: name.trim() || 'CutContour' } }))}
                      />
                    </Field>
                  )}
                </Section>
                <Section title="Marcas">
                  <Field label="Margem técnica" hint="Faixa em volta de cada painel onde ficam as marcas e a etiqueta. Também gasta mídia.">
                    <NumberField value={prefs.marks.marginMm} onCommit={(v) => setPrefs((p) => ({ ...p, marks: { ...p.marks, marginMm: v ?? 0 } }))} />
                  </Field>
                  <CheckRow checked={prefs.marks.cropMarks} onChange={(cropMarks) => setPrefs((p) => ({ ...p, marks: { ...p.marks, cropMarks } }))}>
                    <span title="Nos cantos do painel físico, na margem técnica">Corte (cantos)</span>
                  </CheckRow>
                  <CheckRow
                    checked={prefs.marks.overlapMarks ?? prefs.marks.cropMarks}
                    onChange={(overlapMarks) => setPrefs((p) => ({ ...p, marks: { ...p.marks, overlapMarks } }))}
                  >
                    <span title="Tracejadas, onde a sobreposição começa e termina">Início e fim da sobreposição</span>
                  </CheckRow>
                  <CheckRow
                    checked={!!prefs.marks.centerMarks}
                    onChange={(centerMarks) => setPrefs((p) => ({ ...p, marks: { ...p.marks, centerMarks } }))}
                  >
                    <span title="No meio de cada borda do painel, para alinhar com o vizinho na instalação">Centro das bordas (alinhamento)</span>
                  </CheckRow>
                  <p className="text-[11px] text-muted-foreground">Todas ficam na margem técnica, nunca sobre a arte.</p>
                </Section>
                <Section
                  title="Etiqueta"
                  action={
                    <Checkbox
                      checked={prefs.marks.label}
                      title="Imprimir a etiqueta"
                      onCheckedChange={(v) => setPrefs((p) => ({ ...p, marks: { ...p.marks, label: v === true } }))}
                    />
                  }
                >
                  {prefs.marks.label ? (
                    <>
                      <p className="text-[11px] text-muted-foreground">Linha de cima</p>
                      <div onFocus={() => setLabelField('labelTop')}>
                        <TextField
                          value={prefs.marks.labelTop ?? DEFAULT_LABEL_TOP}
                          onCommit={(labelTop) => setPrefs((p) => ({ ...p, marks: { ...p.marks, labelTop } }))}
                        />
                      </div>
                      <p className="text-[11px] text-muted-foreground">Linha de baixo</p>
                      <div onFocus={() => setLabelField('labelBottom')}>
                        <TextField
                          value={prefs.marks.labelBottom ?? DEFAULT_LABEL_BOTTOM}
                          onCommit={(labelBottom) => setPrefs((p) => ({ ...p, marks: { ...p.marks, labelBottom } }))}
                        />
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {LABEL_TOKENS.map(([token, label]) => (
                          <button
                            key={token}
                            type="button"
                            title={`${label}: inclui na linha ${labelField === 'labelTop' ? 'de cima' : 'de baixo'}`}
                            className="rounded border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
                            onClick={() =>
                              setPrefs((p) => {
                                const fallback = labelField === 'labelTop' ? DEFAULT_LABEL_TOP : DEFAULT_LABEL_BOTTOM
                                const currentText = p.marks[labelField] ?? fallback
                                return { ...p, marks: { ...p.marks, [labelField]: currentText ? `${currentText} · ${token}` : token } }
                              })
                            }
                          >
                            {token}
                          </button>
                        ))}
                      </div>
                      {(single ?? active[0]) && (
                        <div className="space-y-0.5 rounded border border-dashed border-border bg-muted/40 px-2 py-1.5 text-[10px] leading-snug text-foreground">
                          <p className="text-muted-foreground">Prévia ({(single ?? active[0]).id})</p>
                          <p className="break-words">{labelOf(prefs.marks.labelTop ?? DEFAULT_LABEL_TOP, single ?? active[0])}</p>
                          <p className="break-words">{labelOf(prefs.marks.labelBottom ?? DEFAULT_LABEL_BOTTOM, single ?? active[0])}</p>
                        </div>
                      )}
                      <p className="text-[11px] text-muted-foreground">Se a linha não couber entre as marcas, ela é encurtada com "…".</p>
                    </>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">Sem etiqueta nos painéis.</p>
                  )}
                </Section>
                <Section title="Modelos">
                  {templates.length > 0 && (
                    <Select
                      value=""
                      onValueChange={(id) => {
                        const t = templates.find((x) => x.id === id)
                        if (t) applyTemplate(t)
                      }}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Aplicar um modelo salvo" />
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
                  <div className="flex gap-1">
                    <Input className="h-7 text-xs" placeholder="Nome do modelo (ex.: Empena 3 × 2)" value={templateName} onChange={(e) => setTemplateName(e.target.value)} />
                    <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!templateName.trim()} onClick={saveTemplate}>
                      Salvar
                    </Button>
                  </div>
                </Section>
              </>
            )}
          </div>
        </aside>

        {/* ---- Prancheta e painel inferior ---- */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="relative min-h-[320px] flex-1 overflow-hidden bg-muted/60">
            {project && geometry ? (
              <>
                <div className="absolute inset-0 p-3">
                  <TilingCanvas
                    art={
                      art
                        ? {
                            url: art.url,
                            rect: {
                              x: ((art.visible[0] - art.trim[0]) * scale) / MM,
                              y: ((art.visible[1] - art.trim[1]) * scale) / MM,
                              w: ((art.visible[2] - art.visible[0]) * scale) / MM,
                              h: ((art.visible[3] - art.visible[1]) * scale) / MM,
                            },
                          }
                        : null
                    }
                    poster={{ w: project.poster.width, h: project.poster.height }}
                    background={
                      background && background.visible && backgroundUrl
                        ? {
                            url: backgroundUrl,
                            rect: { x: background.xMm, y: background.yMm, w: background.widthMm, h: background.widthMm * backgroundAspect },
                            opacity: background.opacity,
                          }
                        : null
                    }
                    geometry={geometry}
                    selected={selected}
                    selectedSeam={selectedSeam}
                    flagged={flagged}
                    fills={leftTab === 'instalacao' ? areaFills : undefined}
                    showOrder={leftTab === 'instalacao'}
                    onSelectTile={selectTile}
                    onSelectMany={(keys, additive) => {
                      setSelectedSeam(null)
                      setSelected((s) => (additive ? [...new Set([...s, ...keys])] : keys))
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
                <Legend />
              </>
            ) : (
              <EmptyState
                saved={saved}
                loading={!!pdfUrl && !artError}
                onOpen={openSaved}
                onRemove={removeSaved}
              />
            )}
          </div>

          {project && geometry && (
            <div className="flex h-[230px] shrink-0 flex-col border-t border-border bg-card">
              <div className="flex border-b border-border px-1">
                <BottomTabButton active={bottomTab === 'paineis'} onClick={() => setBottomTab('paineis')}>
                  Painéis <Count>{active.length}</Count>
                </BottomTabButton>
                <BottomTabButton active={bottomTab === 'problemas'} onClick={() => setBottomTab('problemas')}>
                  Problemas
                  {errors.length > 0 && <Count tone="error">{errors.length}</Count>}
                  {warnings.length > 0 && <Count tone="warning">{warnings.length}</Count>}
                </BottomTabButton>
                <BottomTabButton active={bottomTab === 'midia'} onClick={() => setBottomTab('midia')}>
                  Na mídia
                </BottomTabButton>
                <BottomTabButton active={bottomTab === 'exportacao'} onClick={() => setBottomTab('exportacao')}>
                  Exportação
                  {current && current.id === tilingId && current.status !== 'draft' && (
                    <span
                      className={cn(
                        'ml-1.5 h-2 w-2 rounded-full',
                        running ? 'animate-pulse bg-primary' : current.status === 'failed' ? 'bg-destructive' : 'bg-emerald-500',
                      )}
                    />
                  )}
                </BottomTabButton>
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                {bottomTab === 'paineis' && <PanelTable tiles={geometry.tiles} issues={issues} selected={selected} onSelect={selectTile} />}
                {bottomTab === 'problemas' && <IssuesList issues={issues} onSelectTile={selectById} />}
                {bottomTab === 'midia' && <MediaPreview layout={geometry.media} media={constraint?.media} numbers={numbers} />}
                {bottomTab === 'exportacao' && (
                  <ExportPanel
                    current={current && current.id === tilingId ? current : null}
                    running={running}
                    outdated={outdated}
                    nextRevision={revisionTag(revision + 1)}
                    errors={errors.length}
                    downloads={downloads}
                    panels={active.length}
                  />
                )}
              </div>
            </div>
          )}
        </div>

        {/* ---- Inspetor da seleção ---- */}
        {project && geometry && (
          <aside className="w-full shrink-0 overflow-y-auto border-t border-border bg-card lg:w-[280px] lg:border-l lg:border-t-0">
            {selectedTiles.length > 0 ? (
              <TileInspector project={project} tiles={selectedTiles} onChange={commit} onMoveOrder={moveOrder} />
            ) : seam ? (
              <SeamInspector project={project} seam={seam} onChange={commit} onRemoved={() => setSelectedSeam(null)} />
            ) : (
              <>
                <Section title="Projeto">
                  <Readout label="Arte (tamanho final)" value={`${fmtSize({ w: project.poster.width, h: project.poster.height })} mm`} />
                  <Readout label="Grade" value={`${columns} colunas × ${rows} linhas`} />
                  <Readout label="Painéis a imprimir" value={active.length} strong />
                  {disabledCount > 0 && <Readout label="Não imprimem" value={disabledCount} />}
                  {active.length > 0 && (
                    <Readout
                      label="Maior painel físico"
                      value={`${fmtSize(active.reduce((m, t) => (t.physical.w * t.physical.h > m.physical.w * m.physical.h ? t : m)).physical)} mm`}
                    />
                  )}
                  <Readout
                    label="Situação"
                    value={errors.length ? `${errors.length} erro(s)` : warnings.length ? `pronto, ${warnings.length} aviso(s)` : 'pronto para exportar'}
                    tone={errors.length ? 'error' : warnings.length ? 'warning' : 'ok'}
                  />
                </Section>
                <div className="space-y-1.5 px-3 py-3 text-[11px] text-muted-foreground">
                  <p>Clique num painel para ajustar; Shift + clique ou arrastar um retângulo escolhe vários.</p>
                  <p>Clique numa linha para a fresta; arraste a linha para mover a divisão.</p>
                  <p>Esc limpa a seleção · Ctrl+Z desfaz · Ctrl+S salva.</p>
                </div>
              </>
            )}
          </aside>
        )}
      </div>

      {/* ---- Barra de status ---- */}
      <div className="flex h-7 shrink-0 items-center gap-4 overflow-x-auto whitespace-nowrap border-t border-border bg-muted/60 px-3 text-[11px] text-muted-foreground">
        {project && geometry ? (
          <>
            <span>
              Arte <b className="font-medium text-foreground">{fmtSize({ w: project.poster.width, h: project.poster.height })} mm</b> · 1:{fmt(scale, 2)}
            </span>
            <span>
              <b className="font-medium text-foreground">{active.length}</b> painéis ({columns} × {rows}
              {disabledCount ? `, ${disabledCount} sem impressão` : ''})
            </span>
            <span>Grade {hasManualEdits(project) ? 'editada à mão' : 'automática'}</span>
            {constraint && constraint.printableWidth > 0 ? (
              <span>
                Imprimível <b className="font-medium text-foreground">{fmt(constraint.printableWidth, 0)} mm</b> · uso {fmt(geometry.mediaUsage * 100, 0)}%
              </span>
            ) : (
              <span className="text-amber-700 dark:text-amber-400">Mídia não informada</span>
            )}
            {geometry.media && (
              <span>
                Consumo <b className="font-medium text-foreground">{fmtM(geometry.media.length)}</b> · desperdício {fmt(geometry.media.waste * 100, 0)}%
                {geometry.media.cost !== null && ` · ${fmtMoney(geometry.media.cost)}`}
              </span>
            )}
            <button type="button" className="ml-auto flex items-center gap-3 hover:text-foreground" onClick={() => setBottomTab('problemas')}>
              <span className="flex items-center gap-1">
                {errors.length ? <XCircle className="h-3.5 w-3.5 text-destructive" /> : <CircleCheck className="h-3.5 w-3.5 text-emerald-600" />}
                {errors.length} erro(s)
              </span>
              <span className="flex items-center gap-1">
                <AlertTriangle className={cn('h-3.5 w-3.5', warnings.length ? 'text-amber-500' : '')} />
                {warnings.length} aviso(s)
              </span>
            </button>
          </>
        ) : (
          <span>Nenhuma arte aberta</span>
        )}
      </div>

      <AlertDialog open={!!confirm} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirm?.message}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                confirm?.run()
                setConfirm(null)
              }}
            >
              {confirm?.action}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ---- Peças da tela ----------------------------------------------------------------------

const Divider = () => <span className="mx-1 h-5 w-px bg-border" />

function ToolButton({
  title,
  label,
  disabled,
  onClick,
  children,
}: {
  title?: string
  label?: string
  disabled?: boolean
  onClick: () => void
  children?: ReactNode
}) {
  return (
    <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-xs" title={title} disabled={disabled} onClick={onClick}>
      {children}
      {label}
    </Button>
  )
}

function CheckRow({ checked, onChange, children }: { checked: boolean; onChange: (value: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs text-foreground/80">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} />
      {children}
    </label>
  )
}

function BottomTabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        '-mb-px flex items-center border-b-2 px-3 py-1.5 text-xs transition-colors',
        active ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

function Count({ tone, children }: { tone?: 'error' | 'warning'; children: ReactNode }) {
  return (
    <span
      className={cn(
        'ml-1.5 rounded px-1.5 text-[10px] font-semibold tabular-nums',
        tone === 'error' ? 'bg-destructive text-destructive-foreground' : tone === 'warning' ? 'bg-amber-500 text-white' : 'bg-muted text-muted-foreground',
      )}
    >
      {children}
    </span>
  )
}

/** O que cada traço da prancheta significa. */
function Legend() {
  const items: [string, ReactNode][] = [
    ['Cobre da arte', <span className="h-2.5 w-3.5 border-[1.5px] border-blue-600" />],
    ['Impresso', <span className="h-2.5 w-3.5 border border-dashed border-sky-400" />],
    ['Sobreposição', <span className="h-2.5 w-3.5 bg-orange-500/50" />],
    ['Área branca', <span className="h-2.5 w-3.5 border border-dotted border-slate-400 bg-white/60" />],
    ['Fresta', <span className="h-2.5 w-3.5 bg-slate-800/60" />],
    ['Não imprime', <span className="h-2.5 w-3.5 border border-dashed border-red-500 bg-red-500/20" />],
  ]
  return (
    <div className="pointer-events-none absolute bottom-2 left-2 flex flex-wrap gap-x-3 gap-y-1 rounded border border-border bg-card/90 px-2 py-1 text-[10px] text-muted-foreground shadow-sm">
      {items.map(([label, swatch]) => (
        <span key={label} className="flex items-center gap-1">
          {swatch}
          {label}
        </span>
      ))}
    </div>
  )
}

/** Sem arte aberta: os painelamentos salvos, para retomar um deles. */
function EmptyState({
  saved,
  loading,
  onOpen,
  onRemove,
}: {
  saved: TilingProject[]
  loading: boolean
  onOpen: (row: TilingProject) => void
  onRemove: (row: TilingProject) => void
}) {
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Abrindo a arte…
      </div>
    )
  }
  return (
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="rounded border border-dashed border-border bg-card px-4 py-5 text-center text-xs text-muted-foreground">
          Para um painelamento novo, escolha o trabalho com a arte na aba <b className="text-foreground">Arte</b>, à esquerda.
        </div>
        {saved.length > 0 && (
          <div className="overflow-hidden rounded border border-border bg-card">
            <div className="border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Painelamentos salvos
            </div>
            <table className="w-full text-xs">
              <thead className="bg-muted/60 text-left text-[11px] text-muted-foreground">
                <tr>
                  <th className="px-3 py-1.5 font-medium">Nome</th>
                  <th className="px-3 py-1.5 font-medium">Situação</th>
                  <th className="px-3 py-1.5 text-right font-medium">Painéis</th>
                  <th className="px-3 py-1.5 font-medium">Atualizado</th>
                  <th className="w-24 px-3 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {saved.map((row) => (
                  <tr key={row.id} className="border-t border-border hover:bg-accent/50">
                    <td className="px-3 py-1.5 font-medium text-foreground">{row.name || 'Sem nome'}</td>
                    <td className="px-3 py-1.5">
                      <span
                        className={cn(
                          'rounded px-1.5 py-0.5 text-[10px] font-medium',
                          row.status === 'completed' && 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
                          row.status === 'failed' && 'bg-destructive/15 text-destructive',
                          TILING_ACTIVE.includes(row.status) && 'bg-primary/15 text-primary',
                          row.status === 'draft' && 'bg-muted text-muted-foreground',
                        )}
                      >
                        {STATUS_LABEL[row.status]}
                        {row.status === 'completed' && ` · ${revisionTag(row.result?.revision ?? row.config?.revision ?? 1)}`}
                      </span>
                      {isOutdated(row) && (
                        <span
                          className="ml-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:text-amber-300"
                          title="Alterado depois da exportação: os arquivos não correspondem mais ao projeto"
                        >
                          Desatualizado
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{Array.isArray(row.tiles) ? row.tiles.length : '—'}</td>
                    <td className="px-3 py-1.5 tabular-nums text-muted-foreground">{time(row.updated)}</td>
                    <td className="px-3 py-1 text-right">
                      <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => onOpen(row)}>
                        Abrir
                      </Button>
                      <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground" title="Apagar" onClick={() => onRemove(row)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

const ROTATION_SHORT: Record<number, string> = { 0: 'em pé', 90: 'deitado', 180: 'em pé 180°', 270: 'deitado 180°' }

function ExportPanel({
  current,
  running,
  outdated,
  nextRevision,
  errors,
  downloads,
  panels,
}: {
  current: TilingProject | null
  running: boolean
  outdated: boolean
  nextRevision: string
  errors: number
  downloads: { pdf?: string; zip?: string; guide?: string }
  panels: number
}) {
  if (!current || current.status === 'draft') {
    return (
      <p className="px-3 py-3 text-xs text-muted-foreground">
        {errors
          ? `Corrija ${errors} erro(s) na aba Problemas antes de exportar.`
          : 'Ainda não exportado. "Exportar" gera o PDF com todos os painéis, um PDF por painel (ZIP) e o guia de instalação.'}
      </p>
    )
  }
  if (running) {
    return (
      <div className="space-y-2 px-3 py-3 text-xs">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {current.current_step || 'Na fila do analisador'}
          </span>
          <span className="tabular-nums text-muted-foreground">{current.progress}%</span>
        </div>
        <Progress value={current.progress} className="h-1.5" />
      </div>
    )
  }
  if (current.status === 'failed') {
    return <p className="px-3 py-3 text-xs text-destructive">A exportação falhou: {current.error_message || 'sem detalhes'}</p>
  }
  const files = current.result.files ?? []
  return (
    <div className="flex h-full min-h-0 gap-4 px-3 py-3 text-xs">
    <div className="w-72 shrink-0 space-y-2">
      <p className="flex items-center gap-2 text-foreground">
        <CircleCheck className="h-4 w-4 shrink-0 text-emerald-600" />
        <span>
          <b>{revisionTag(current.result.revision ?? current.config?.revision ?? 1)}</b> · {current.result.panels ?? panels} painéis
          exportados em {current.completed_at ? time(current.completed_at) : time(current.updated)}.
        </span>
      </p>
      {outdated && (
        <p className="flex items-start gap-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
          O projeto mudou depois desta exportação: os arquivos estão desatualizados. Exportar de novo gera a {nextRevision}.
        </p>
      )}
      {current.result.cut && (current.result.cut.contour || current.result.cut.panelEdge) && (
        <p className="text-muted-foreground">
          Faca ({current.result.cut.name}):{' '}
          {[current.result.cut.contour && 'contorno da arte', current.result.cut.panelEdge && 'em volta de cada painel']
            .filter(Boolean)
            .join(' e ')}
          .
        </p>
      )}
      {current.result.imageCrop && current.result.imageCrop.cropped + current.result.imageCrop.kept > 0 && (
        <p className="text-muted-foreground" title="Só imagens sem perda são recortadas; o recorte copia os pixels, sem reamostrar">
          Arquivos por painel: {current.result.imageCrop.cropped} imagem(ns) recortada(s) no painel
          {current.result.imageCrop.kept > 0 &&
            `, ${current.result.imageCrop.kept} mantida(s) inteira(s)${
              current.result.imageCrop.keptBecause.length ? ` (${current.result.imageCrop.keptBecause.join(', ')})` : ''
            }`}
          .
        </p>
      )}
      {current.result.warnings?.map((w) => (
        <p key={w} className="text-amber-700 dark:text-amber-400">
          {w}
        </p>
      ))}
      <div className="flex flex-wrap gap-2">
        {downloads.pdf && (
          <Button size="sm" variant="outline" className="h-7 text-xs" asChild>
            <a href={downloads.pdf} target="_blank" rel="noreferrer">
              <Download className="h-3.5 w-3.5" />
              Todos os painéis (PDF)
            </a>
          </Button>
        )}
        {downloads.zip && !!current.result.sizes?.zip && (
          <Button size="sm" variant="outline" className="h-7 text-xs" asChild>
            <a href={downloads.zip} target="_blank" rel="noreferrer">
              <FileArchive className="h-3.5 w-3.5" />
              Um arquivo por painel (ZIP)
            </a>
          </Button>
        )}
        {downloads.guide && (
          <Button size="sm" variant="outline" className="h-7 text-xs" asChild>
            <a href={downloads.guide} target="_blank" rel="noreferrer">
              <Download className="h-3.5 w-3.5" />
              Guia de instalação
            </a>
          </Button>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">O ZIP traz também o manifesto (planilha CSV) e a configuração.</p>
    </div>
    {files.length > 0 && (
      <div className="min-w-0 flex-1 overflow-auto rounded border border-border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted text-left text-[11px] text-muted-foreground">
            <tr>
              <th className="px-2 py-1 font-medium">Nº</th>
              <th className="px-2 py-1 font-medium">Arquivo gerado</th>
              <th className="px-2 py-1 font-medium">Área</th>
              <th className="px-2 py-1 text-right font-medium">Físico (mm)</th>
              <th className="px-2 py-1 font-medium">Na mídia</th>
            </tr>
          </thead>
          <tbody>
            {files.map((f) => (
              <tr key={f.number} className="border-t border-border tabular-nums">
                <td className="px-2 py-0.5 font-semibold">{String(f.number).padStart(2, '0')}</td>
                <td className="px-2 py-0.5 font-mono text-[11px]">{f.file}</td>
                <td className="px-2 py-0.5">{f.region || ''}</td>
                <td className="px-2 py-0.5 text-right">{fmtSize({ w: (f.physicalMm ?? f.printedMm)[0], h: (f.physicalMm ?? f.printedMm)[1] })}</td>
                <td className="px-2 py-0.5">{ROTATION_SHORT[f.rotation ?? 0]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
    </div>
  )
}
