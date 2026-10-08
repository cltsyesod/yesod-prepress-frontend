import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Combine,
  Download,
  Eye,
  EyeOff,
  FileArchive,
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
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { TilingCanvas } from '@/components/tiling/TilingCanvas'
import { useAuth } from '@/hooks/use-auth'
import { usePdfPageImage } from '@/hooks/use-pdf-page-image'
import { useRealtime } from '@/hooks/use-realtime'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/supabase/errors'
import {
  computeTiles,
  mergeTiles,
  moveLine,
  newLayout,
  scaleLayout,
  splitAt,
  splitTile,
  toggleRemoved,
  type Rect,
  type SeamKind,
  type TilingLayout,
  type TilingSettings,
} from '@/lib/tiling'
import { jobsService, type Job } from '@/services/jobsService'
import { profileService } from '@/services/profileService'
import { projectFilesService } from '@/services/projectFilesService'
import {
  TILING_ACTIVE,
  tilingService,
  type TilingBackground,
  type TilingConfig,
  type TilingProject,
  type TilingTemplate,
} from '@/services/tilingService'

const MM = 72 / 25.4

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

interface Options {
  direction: 'standing' | 'lying'
  materialWidthMm: number
  materialLengthMm: number
  mode: 'equal' | 'max'
  overlapMm: number
  overlapSide: 'next' | 'split'
  gapMm: number
  nameTemplate: string
  marks: { marginMm: number; cropMarks: boolean; label: boolean }
}

// Valores iniciais da tela; o operador ajusta a cada trabalho.
const DEFAULT_OPTIONS: Options = {
  direction: 'standing',
  materialWidthMm: 0,
  materialLengthMm: 0,
  mode: 'equal',
  overlapMm: 20,
  overlapSide: 'next',
  gapMm: 10,
  nameTemplate: '{trabalho}_PAINEL_{nn}',
  marks: { marginMm: 10, cropMarks: true, label: true },
}

export default function TilingPage() {
  const { user } = useAuth()
  const profiles = profileService.getProfilesSync()
  const [jobs, setJobs] = useState<Job[]>([])
  const [jobId, setJobId] = useState('')
  const [fileId, setFileId] = useState('')
  const [pdfUrl, setPdfUrl] = useState('')
  const [pageNumber, setPageNumber] = useState(1)
  const { image: art, error: artError } = usePdfPageImage(pdfUrl, pageNumber)

  const [name, setName] = useState('')
  const [scale, setScale] = useState(1)
  const [unit, setUnit] = useState<Unit>('mm')
  const [options, setOptions] = useState<Options>({ ...DEFAULT_OPTIONS })
  const [layout, setLayout] = useState<TilingLayout | null>(null)
  const [history, setHistory] = useState<{ past: TilingLayout[]; future: TilingLayout[] }>({ past: [], future: [] })
  const [selected, setSelected] = useState<string[]>([])
  const [selectedSeam, setSelectedSeam] = useState<string | null>(null)
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

  const loadSaved = useCallback(() => {
    tilingService.list().then(setSaved).catch(() => setSaved([]))
  }, [])
  useEffect(() => {
    jobsService.listJobs().then(setJobs).catch(() => setJobs([]))
    tilingService.listTemplates().then(setTemplates).catch(() => setTemplates([]))
    loadSaved()
  }, [loadSaved])
  useRealtime('tiling_projects', () => loadSaved())

  // Arte: arquivo principal do trabalho escolhido.
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
      if (!keep) {
        setName(chosen?.name ?? '')
        setLayout(null)
        setTilingId(null)
      }
    } catch (err) {
      toast({ title: 'Não foi possível abrir a arte', description: getErrorMessage(err), variant: 'destructive' })
    }
  }

  // Medidas da arte no tamanho final (formato final = TrimBox × escala).
  const trimMm = art ? { w: (art.trim[2] - art.trim[0]) / MM, h: (art.trim[3] - art.trim[1]) / MM } : null
  const settings: TilingSettings | null = useMemo(() => {
    if (!art || !trimMm) return null
    const k = scale / MM
    const v = art.visible
    const t = art.trim
    const b = art.bleed ?? v
    const side = (outer: number, inner: number) => Math.max(0, outer * k - inner * k)
    const material = options.materialWidthMm
    const length = options.materialLengthMm
    return {
      artWidthMm: trimMm.w * scale,
      artHeightMm: trimMm.h * scale,
      bleedMm: {
        left: side(t[0], Math.max(b[0], v[0])),
        bottom: side(t[1], Math.max(b[1], v[1])),
        right: side(Math.min(b[2], v[2]), t[2]),
        top: side(Math.min(b[3], v[3]), t[3]),
      },
      maxWidthMm: options.direction === 'standing' ? material : length,
      maxHeightMm: options.direction === 'standing' ? length : material,
      mode: options.mode,
      overlapMm: options.overlapMm,
      overlapSide: options.overlapSide,
      gapMm: options.gapMm,
      nameTemplate: options.nameTemplate,
    }
  }, [art, trimMm?.w, trimMm?.h, scale, options]) // eslint-disable-line react-hooks/exhaustive-deps

  // Primeira divisão automática ao abrir uma arte.
  useEffect(() => {
    if (settings && !layout && settings.maxWidthMm + settings.maxHeightMm > 0) {
      setLayout(newLayout(settings))
    }
  }, [settings, layout])

  const result = useMemo(
    () =>
      layout && settings
        ? computeTiles(layout, settings, { job: name || job?.name, client: job?.clientName })
        : { tiles: [], seams: [] },
    [layout, settings, name, job],
  )

  const removedRects = useMemo(() => {
    if (!layout) return []
    const cells = new Set(layout.removed)
    return [...cells].map((key) => {
      const [c, r] = key.split(',').map(Number)
      return {
        key,
        rect: { x: layout.xs[c], y: layout.ys[r], w: layout.xs[c + 1] - layout.xs[c], h: layout.ys[r + 1] - layout.ys[r] },
      }
    })
  }, [layout])

  const overlaps = useMemo(() => {
    const strips: Rect[] = []
    const t = result.tiles
    for (let i = 0; i < t.length; i++) {
      for (let j = i + 1; j < t.length; j++) {
        const a = t[i].printed
        const b = t[j].printed
        const x0 = Math.max(a.x, b.x)
        const y0 = Math.max(a.y, b.y)
        const x1 = Math.min(a.x + a.w, b.x + b.w)
        const y1 = Math.min(a.y + a.h, b.y + b.h)
        if (x1 - x0 > 0.5 && y1 - y0 > 0.5) strips.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 })
      }
    }
    return strips
  }, [result.tiles])

  // Histórico (desfazer/refazer) de toda edição da divisão.
  const commit = (next: TilingLayout | null) => {
    if (!next || !layout) return
    setHistory((h) => ({ past: [...h.past.slice(-49), layout], future: [] }))
    setLayout(next)
  }
  const undo = () =>
    setHistory((h) => {
      if (!h.past.length || !layout) return h
      setLayout(h.past[h.past.length - 1])
      return { past: h.past.slice(0, -1), future: [layout, ...h.future] }
    })
  const redo = () =>
    setHistory((h) => {
      if (!h.future.length || !layout) return h
      setLayout(h.future[0])
      return { past: [...h.past, layout], future: h.future.slice(1) }
    })
  // Arrastar uma linha atualiza ao vivo; o histórico guarda o estado de antes do arraste.
  const [dragStart, setDragStart] = useState<TilingLayout | null>(null)

  const regenerate = () => {
    if (!settings) return
    if (layout) setHistory((h) => ({ past: [...h.past.slice(-49), layout], future: [] }))
    setLayout(newLayout(settings))
    setSelected([])
    setSelectedSeam(null)
  }

  const selectedTiles = result.tiles.filter((t) => selected.includes(t.key))
  const selectedRemoved = removedRects.filter((r) => selected.includes(r.key))
  const single = selectedTiles.length === 1 ? selectedTiles[0] : null
  const seam = result.seams.find((s) => s.id === selectedSeam) ?? null
  const tooBig = result.tiles.filter((t) => t.tooBig)

  const setOverride = (key: string, patch: { name?: string; region?: string; number?: number }) => {
    if (!layout) return
    commit({ ...layout, overrides: { ...layout.overrides, [key]: { ...layout.overrides[key], ...patch } } })
  }
  const setSeamKind = (id: string, kind: SeamKind, widthMm?: number) => {
    if (!layout) return
    commit({ ...layout, seams: { ...layout.seams, [id]: { kind, widthMm } } })
  }

  // Imagem de referência (veículo, fachada): só na tela e no guia.
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
    if (!user || !settings) return
    try {
      const path = await tilingService.uploadBackground(user.id, file)
      setBackground({
        path,
        xMm: 0,
        yMm: 0,
        widthMm: Math.round(settings.artWidthMm),
        opacity: 0.6,
        visible: true,
        visibleInGuide: true,
      })
    } catch (err) {
      toast({ title: 'Não foi possível enviar a imagem', description: getErrorMessage(err), variant: 'destructive' })
    }
  }

  const config = (): TilingConfig | null =>
    layout && settings && trimMm
      ? {
          page: pageNumber,
          fileScale: scale,
          trimMm,
          settings,
          layout,
          marks: options.marks,
          direction: options.direction,
          materialWidthMm: options.materialWidthMm,
          materialLengthMm: options.materialLengthMm,
        }
      : null

  const save = async (): Promise<string | null> => {
    const cfg = config()
    if (!cfg || !job || !fileId) return null
    const id = await tilingService.save(tilingId, {
      name: name || job.name,
      projectId: job.id,
      fileId,
      config: cfg,
      tiles: result.tiles,
      seams: result.seams,
      background,
    })
    setTilingId(id)
    loadSaved()
    return id
  }

  const exportPanels = async () => {
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

  // Downloads quando a exportação termina.
  useEffect(() => {
    if (current?.status !== 'completed') {
      setDownloads({})
      return
    }
    const output = current.output ?? {}
    Promise.all(
      (['pdf', 'zip', 'guide'] as const).map(async (key) => [key, output[key] ? await tilingService.signedUrl(output[key]!).catch(() => '') : ''] as const),
    ).then((pairs) => setDownloads(Object.fromEntries(pairs)))
  }, [current?.id, current?.status, current?.updated]) // eslint-disable-line react-hooks/exhaustive-deps

  const openSaved = async (project: TilingProject) => {
    const cfg = project.config
    await chooseJob(project.project_id ?? '', { fileId: project.file_id ?? '', scale: cfg.fileScale })
    setTilingId(project.id)
    setName(project.name)
    setPageNumber(cfg.page || 1)
    setOptions({
      direction: cfg.direction,
      materialWidthMm: cfg.materialWidthMm,
      materialLengthMm: cfg.materialLengthMm,
      mode: cfg.settings.mode,
      overlapMm: cfg.settings.overlapMm,
      overlapSide: cfg.settings.overlapSide,
      gapMm: cfg.settings.gapMm,
      nameTemplate: cfg.settings.nameTemplate,
      marks: cfg.marks,
    })
    setLayout(cfg.layout)
    setHistory({ past: [], future: [] })
    setBackground(project.background)
  }

  const applyTemplate = (template: TilingTemplate) => {
    const cfg = template.config
    setOptions({
      direction: cfg.direction,
      materialWidthMm: cfg.materialWidthMm,
      materialLengthMm: cfg.materialLengthMm,
      mode: cfg.settings.mode,
      overlapMm: cfg.settings.overlapMm,
      overlapSide: cfg.settings.overlapSide,
      gapMm: cfg.settings.gapMm,
      nameTemplate: cfg.settings.nameTemplate,
      marks: cfg.marks,
    })
    if (settings) {
      // Mesma estrutura numa arte de outro tamanho: as divisões acompanham a proporção.
      const scaled = scaleLayout(
        cfg.layout,
        { w: cfg.settings.artWidthMm, h: cfg.settings.artHeightMm },
        { w: settings.artWidthMm, h: settings.artHeightMm },
      )
      if (layout) setHistory((h) => ({ past: [...h.past.slice(-49), layout], future: [] }))
      setLayout(scaled)
    }
    if (template.background) setBackground(template.background)
    toast({ title: `Modelo "${template.name}" aplicado` })
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

  const u = UNIT_FACTOR[unit]
  const show = (mm: number) => String(Math.round((mm / u) * 100) / 100)
  const largest = result.tiles.reduce((acc, t) => Math.max(acc, t.printed.w * t.printed.h), 0)
  const biggest = result.tiles.find((t) => t.printed.w * t.printed.h === largest)
  const running = current ? TILING_ACTIVE.includes(current.status) : false

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Painéis</h1>
          <p className="text-sm text-muted-foreground">
            Divida uma arte grande (veículo, fachada, empena) em painéis imprimíveis, com sobreposição, frestas e
            guia de instalação.
          </p>
        </div>
        {saved.length > 0 && (
          <Select value={tilingId ?? ''} onValueChange={(id) => { const p = saved.find((s) => s.id === id); if (p) openSaved(p) }}>
            <SelectTrigger className="w-72">
              <SelectValue placeholder="Abrir painelamento salvo" />
            </SelectTrigger>
            <SelectContent>
              {saved.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name || 'Sem nome'} · {p.status === 'completed' ? 'exportado' : p.status === 'draft' ? 'rascunho' : p.status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
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
                <Input className="h-8 w-20" inputMode="numeric" value={pageNumber} onChange={(e) => setPageNumber(Math.min(art.pageCount, Math.max(1, Math.round(numberOr(e.target.value, 1)))))} />
                <span className="text-muted-foreground">de {art.pageCount}</span>
              </div>
            )}
            {artError && <p className="text-sm text-destructive">Não foi possível abrir o PDF ({artError}).</p>}
          </div>

          {settings && trimMm && (
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
                  <Input inputMode="decimal" value={show(settings.artWidthMm)} onChange={(e) => { const w = numberOr(e.target.value, 0) * u; if (w > 0) { setScale(w / trimMm.w); setLayout(null) } }} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Altura ({unit})</Label>
                  <Input inputMode="decimal" value={show(settings.artHeightMm)} onChange={(e) => { const h = numberOr(e.target.value, 0) * u; if (h > 0) { setScale(h / trimMm.h); setLayout(null) } }} />
                </div>
                <p className="col-span-2 text-xs text-muted-foreground">
                  Escala do arquivo 1:{Math.round(scale * 100) / 100} · proporção mantida (a arte nunca é distorcida).
                  {(settings.bleedMm.left > 0 || settings.bleedMm.top > 0) &&
                    ` Sangria no arquivo: ${Math.round(Math.min(settings.bleedMm.left, settings.bleedMm.right, settings.bleedMm.top, settings.bleedMm.bottom))} mm.`}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Label className="col-span-2">2. Material de impressão</Label>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Largura útil ({unit})</Label>
                  <Input inputMode="decimal" value={options.materialWidthMm ? show(options.materialWidthMm) : ''} onChange={(e) => setOptions((o) => ({ ...o, materialWidthMm: numberOr(e.target.value, 0) * u }))} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Comprimento máx. ({unit})</Label>
                  <Input inputMode="decimal" placeholder="Rolo: sem limite" value={options.materialLengthMm ? show(options.materialLengthMm) : ''} onChange={(e) => setOptions((o) => ({ ...o, materialLengthMm: numberOr(e.target.value, 0) * u }))} />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Painéis</Label>
                  <Select value={options.direction} onValueChange={(v) => setOptions((o) => ({ ...o, direction: v as 'standing' | 'lying' }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="standing">Em pé (largura do material = largura do painel)</SelectItem>
                      <SelectItem value="lying">Deitados (largura do material = altura do painel)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Divisão</Label>
                  <Select value={options.mode} onValueChange={(v) => setOptions((o) => ({ ...o, mode: v as 'equal' | 'max' }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="equal">Painéis iguais</SelectItem>
                      <SelectItem value="max">Máximo do material + resto</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Label className="col-span-2">3. Emendas</Label>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Sobreposição (mm)</Label>
                  <Input inputMode="decimal" value={options.overlapMm} onChange={(e) => setOptions((o) => ({ ...o, overlapMm: numberOr(e.target.value, 0) }))} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Fresta padrão (mm)</Label>
                  <Input inputMode="decimal" value={options.gapMm} onChange={(e) => setOptions((o) => ({ ...o, gapMm: numberOr(e.target.value, 0) }))} />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Quem imprime a sobreposição</Label>
                  <Select value={options.overlapSide} onValueChange={(v) => setOptions((o) => ({ ...o, overlapSide: v as 'next' | 'split' }))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="next">O painel seguinte (direita / de cima cobre o outro)</SelectItem>
                      <SelectItem value="split">Metade para cada painel</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <p className="col-span-2 text-xs text-muted-foreground">
                  Clique numa linha de divisão para trocá-la por fresta (a arte que cai na fresta, entre portas por
                  exemplo, não é impressa) ou emenda topo a topo. Arraste a linha para mudar a posição.
                </p>
                <Button className="col-span-2" variant="outline" onClick={regenerate}>
                  <RotateCcw className="h-4 w-4" />
                  Gerar a divisão automática
                </Button>
              </div>

              <div className="space-y-2">
                <Label>4. Nomes dos arquivos</Label>
                <Input value={options.nameTemplate} onChange={(e) => setOptions((o) => ({ ...o, nameTemplate: e.target.value }))} />
                <p className="text-xs text-muted-foreground">
                  Use {'{trabalho}'}, {'{cliente}'}, {'{nn}'} (número com 2 dígitos), {'{n}'}, {'{col}'}, {'{lin}'} e{' '}
                  {'{regiao}'}. Cada painel também pode ter um nome próprio.
                </p>
              </div>

              <div className="space-y-2">
                <Label>5. Imagem de referência</Label>
                <p className="text-xs text-muted-foreground">
                  Gabarito do veículo ou foto da fachada. Fica só na tela e no guia, nunca nos painéis.
                </p>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-primary">
                  <Upload className="h-4 w-4" />
                  {background ? 'Trocar imagem' : 'Enviar imagem (PNG, JPEG ou WebP)'}
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) uploadBackground(file); e.target.value = '' }} />
                </label>
                {background && (
                  <div className="grid grid-cols-3 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">X (mm)</Label>
                      <Input inputMode="decimal" value={background.xMm} onChange={(e) => setBackground({ ...background, xMm: numberOr(e.target.value, 0) })} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Y (mm)</Label>
                      <Input inputMode="decimal" value={background.yMm} onChange={(e) => setBackground({ ...background, yMm: numberOr(e.target.value, 0) })} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Largura (mm)</Label>
                      <Input inputMode="decimal" value={background.widthMm} onChange={(e) => setBackground({ ...background, widthMm: Math.max(1, numberOr(e.target.value, 1)) })} />
                    </div>
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
                <Label>6. Marcas e etiqueta</Label>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Margem em volta de cada painel (mm)</span>
                  <Input className="h-8 w-20" inputMode="decimal" value={options.marks.marginMm} onChange={(e) => setOptions((o) => ({ ...o, marks: { ...o.marks, marginMm: Math.max(0, numberOr(e.target.value, 0)) } }))} />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={options.marks.cropMarks} onCheckedChange={(v) => setOptions((o) => ({ ...o, marks: { ...o.marks, cropMarks: v === true } }))} />
                  Marcas de corte e de sobreposição
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={options.marks.label} onCheckedChange={(v) => setOptions((o) => ({ ...o, marks: { ...o.marks, label: v === true } }))} />
                  Etiqueta com número, posição e vizinhos
                </label>
                <p className="text-xs text-muted-foreground">Tudo fica na margem, fora da área impressa.</p>
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
                  <Input placeholder="Nome do modelo (ex.: Fiorino 2024)" value={templateName} onChange={(e) => setTemplateName(e.target.value)} />
                  <Button variant="outline" disabled={!templateName.trim() || !layout} onClick={saveTemplate}>
                    <Save className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </section>

        <section className="min-w-0 space-y-3">
          {!settings ? (
            <p className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
              {pdfUrl && !art ? 'Abrindo a arte…' : 'Escolha o trabalho com a arte grande.'}
            </p>
          ) : !layout ? (
            <p className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
              Informe a largura útil do material para gerar os painéis.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2">
                <Input className="h-8 w-56" value={name} placeholder="Nome do painelamento" onChange={(e) => setName(e.target.value)} />
                <span className="mx-1 h-5 w-px bg-border" />
                <Button size="sm" variant="ghost" disabled={!history.past.length} onClick={undo} title="Desfazer">
                  <Undo2 className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="ghost" disabled={!history.future.length} onClick={redo} title="Refazer">
                  <Redo2 className="h-4 w-4" />
                </Button>
                <span className="mx-1 h-5 w-px bg-border" />
                <Button size="sm" variant="outline" disabled={selectedTiles.length < 2} onClick={() => { const next = mergeTiles(layout, selectedTiles); if (!next) { toast({ title: 'Os painéis escolhidos precisam formar um retângulo' }); return } commit(next); setSelected([]) }}>
                  <Combine className="h-4 w-4" />
                  Juntar
                </Button>
                <Button size="sm" variant="outline" disabled={!single || single.cells.length < 2} onClick={() => single && commit(splitTile(layout, single))}>
                  <Scissors className="h-4 w-4" />
                  Separar
                </Button>
                <Button size="sm" variant="outline" disabled={!single} onClick={() => single && commit(splitAt(layout, 'vertical', Math.round(single.visible.x + single.visible.w / 2)))} title="Dividir o painel em duas colunas">
                  <SplitSquareHorizontal className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="outline" disabled={!single} onClick={() => single && commit(splitAt(layout, 'horizontal', Math.round(single.visible.y + single.visible.h / 2)))} title="Dividir o painel em duas linhas">
                  <SplitSquareVertical className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="outline" disabled={!selectedTiles.length && !selectedRemoved.length} onClick={() => {
                  let next = layout
                  for (const t of selectedTiles) next = toggleRemoved(next, t, true)
                  for (const r of selectedRemoved) next = { ...next, removed: next.removed.filter((c) => c !== r.key) }
                  commit(next)
                  setSelected([])
                }}>
                  <Trash2 className="h-4 w-4" />
                  {selectedRemoved.length && !selectedTiles.length ? 'Restaurar' : 'Não imprimir'}
                </Button>
                <div className="ml-auto flex items-center gap-2">
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => save().then(() => toast({ title: 'Painelamento salvo' })).catch((err) => toast({ title: 'Não foi possível salvar', description: getErrorMessage(err), variant: 'destructive' }))}>
                    <Save className="h-4 w-4" />
                    Salvar
                  </Button>
                  <Button size="sm" disabled={busy || running || !result.tiles.length} onClick={exportPanels}>
                    {busy || running ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileArchive className="h-4 w-4" />}
                    Exportar painéis
                  </Button>
                </div>
              </div>

              <div className="h-[calc(100vh-18rem)] min-h-[360px] overflow-hidden rounded-lg border border-border bg-muted p-2">
                <TilingCanvas
                  art={art ? {
                    url: art.url,
                    rect: {
                      x: ((art.visible[0] - art.trim[0]) * scale) / MM,
                      y: ((art.visible[1] - art.trim[1]) * scale) / MM,
                      w: ((art.visible[2] - art.visible[0]) * scale) / MM,
                      h: ((art.visible[3] - art.visible[1]) * scale) / MM,
                    },
                  } : null}
                  artSize={{ w: settings.artWidthMm, h: settings.artHeightMm }}
                  background={background && background.visible && backgroundUrl ? {
                    url: backgroundUrl,
                    rect: { x: background.xMm, y: background.yMm, w: background.widthMm, h: background.widthMm * backgroundAspect },
                    opacity: background.opacity,
                  } : null}
                  tiles={result.tiles}
                  removed={removedRects}
                  seams={result.seams}
                  overlaps={overlaps}
                  selected={selected}
                  selectedSeam={selectedSeam}
                  onSelectTile={(key, additive) => {
                    setSelectedSeam(null)
                    setSelected((s) => (additive ? (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]) : [key]))
                  }}
                  onSelectSeam={(id) => {
                    setSelectedSeam(id)
                    if (id) setSelected([])
                  }}
                  onMoveSeam={(id, position) => {
                    if (!dragStart) setDragStart(layout)
                    setLayout((l) => (l ? moveLine(l, id, position) : l))
                  }}
                  onMoveEnd={() => {
                    if (dragStart) setHistory((h) => ({ past: [...h.past.slice(-49), dragStart], future: [] }))
                    setDragStart(null)
                  }}
                />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1 rounded-lg border border-border bg-card p-3 text-sm">
                  <p className="text-foreground">
                    <strong>{result.tiles.length}</strong> painéis
                    {biggest && ` · maior impresso ${Math.round(biggest.printed.w)} × ${Math.round(biggest.printed.h)} mm`}
                  </p>
                  {tooBig.length > 0 && (
                    <p className="text-amber-700 dark:text-amber-400">
                      {tooBig.length} painel(is) maior(es) que o material: {tooBig.map((t) => String(t.number).padStart(2, '0')).join(', ')}.
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Azul: o que cada painel cobre · tracejado: o que é impresso · laranja: sobreposição · cinza: fresta ·
                    vermelho: não impresso. Shift + clique escolhe vários.
                  </p>
                </div>

                {single && (
                  <div className="space-y-2 rounded-lg border border-border bg-card p-3 text-sm">
                    <p className="font-medium text-foreground">
                      Painel {String(single.number).padStart(2, '0')} · coluna {single.column}, linha {single.row}
                    </p>
                    <div className="grid grid-cols-[80px_1fr] items-center gap-2">
                      <Label className="text-xs text-muted-foreground">Número</Label>
                      <Input className="h-8" inputMode="numeric" value={single.number} onChange={(e) => setOverride(single.key, { number: Math.max(1, Math.round(numberOr(e.target.value, single.number))) })} />
                      <Label className="text-xs text-muted-foreground">Arquivo</Label>
                      <Input className="h-8" value={layout.overrides[single.key]?.name ?? ''} placeholder={single.name} onChange={(e) => setOverride(single.key, { name: e.target.value })} />
                      <Label className="text-xs text-muted-foreground">Região</Label>
                      <Input className="h-8" value={single.region} placeholder="ex.: Lateral esquerda" onChange={(e) => setOverride(single.key, { region: e.target.value })} />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Cobre {Math.round(single.visible.w)} × {Math.round(single.visible.h)} mm · impresso{' '}
                      {Math.round(single.printed.w)} × {Math.round(single.printed.h)} mm
                    </p>
                  </div>
                )}

                {seam && (
                  <div className="space-y-2 rounded-lg border border-border bg-card p-3 text-sm">
                    <p className="font-medium text-foreground">
                      Emenda {seam.orientation === 'vertical' ? 'vertical' : 'horizontal'} em {Math.round(seam.position)} mm
                    </p>
                    <Select value={seam.kind} onValueChange={(v) => setSeamKind(seam.id, v as SeamKind, v === 'gap' ? options.gapMm : undefined)}>
                      <SelectTrigger className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="overlap">Sobreposição ({options.overlapMm} mm)</SelectItem>
                        <SelectItem value="gap">Fresta (a arte da fresta não é impressa)</SelectItem>
                        <SelectItem value="butt">Topo a topo (sem sobreposição)</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Posição (mm)</Label>
                        <Input className="h-8" inputMode="decimal" value={Math.round(seam.position)} onChange={(e) => commit(moveLine(layout, seam.id, numberOr(e.target.value, seam.position)))} />
                      </div>
                      {seam.kind === 'gap' && (
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Largura da fresta (mm)</Label>
                          <Input className="h-8" inputMode="decimal" value={seam.widthMm} onChange={(e) => setSeamKind(seam.id, 'gap', Math.max(0, numberOr(e.target.value, 0)))} />
                        </div>
                      )}
                    </div>
                  </div>
                )}
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
                      <p className="text-foreground">Painéis prontos ({current.result.panels ?? result.tiles.length}).</p>
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
    </div>
  )
}
