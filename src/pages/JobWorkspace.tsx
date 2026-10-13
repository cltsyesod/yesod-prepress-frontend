import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  Archive,
  ArrowLeft,
  ClipboardCopy,
  Download,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  SlidersHorizontal,
  Undo2,
  Wand2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Progress } from '@/components/ui/progress'
import { JobStateBadge } from '@/components/jobs/JobStateBadge'
import { JobTicketFields } from '@/components/jobs/JobTicketFields'
import { DtgPlacementPanel } from '@/components/jobs/DtgPlacementPanel'
import { JobMetaFields, type JobMeta } from '@/components/jobs/JobMetaFields'
import { useTeam } from '@/hooks/use-team'
import { BleedDialog, type BleedOptions } from '@/components/jobs/BleedDialog'
import { ContourCutDialog, type ContourCutOptions } from '@/components/jobs/ContourCutDialog'
import { CropMarksDialog } from '@/components/jobs/CropMarksDialog'
import { JobMetricsLine } from '@/components/jobs/JobMetricsLine'
import { ArtStage } from '@/components/jobs/stage/ArtStage'
import { compareRows } from '@/components/jobs/xray/CompareTable'
import { SectionDetail } from '@/components/jobs/xray/SectionDetail'
import { StatusHero } from '@/components/jobs/xray/StatusHero'
import { XRayTiles, type View } from '@/components/jobs/xray/XRayTiles'
import { hasProfile, type FileProfile } from '@/lib/xray'
import { useAnalysisJob } from '@/hooks/use-analysis-job'
import { toast } from '@/hooks/use-toast'
import { buildClientMessage } from '@/lib/clientMessage'
import { getErrorMessage } from '@/lib/supabase/errors'
import { jobsService, summarizeIssues, type Job, type JobTicket } from '@/services/jobsService'
import {
  analysisJobsService,
  type AnalysisIssue,
  type FixRequest,
  type IssueFix,
} from '@/services/analysisJobsService'
import { profileService } from '@/services/profileService'
import { isImageFile, projectFilesService } from '@/services/projectFilesService'
import type { ProjectFile } from '@/types'

// Correções que dependem do formato final e da escala (ver `fixBlock`).
const GEOMETRY_FIXES = new Set([
  'set_page_boxes',
  'add_bleed',
  'add_crop_marks',
  'add_cut_contour',
  'add_contour_cut',
  'upscale_images',
])

const ACTIVE = ['queued', 'preparing', 'downloading', 'validating', 'extracting', 'analyzing', 'generating_preview']

export default function JobWorkspacePage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const profiles = profileService.getProfilesSync()
  const { nameOf } = useTeam()

  const [job, setJob] = useState<Job | null>(null)
  const [file, setFile] = useState<ProjectFile | null>(null)
  const [pdfUrl, setPdfUrl] = useState('')
  const [clientUrl, setClientUrl] = useState('')
  // Inspeção do arquivo de produção (placas + mapa de objetos), gerada pelo analisador.
  const [inspectionUrl, setInspectionUrl] = useState('')
  const [page, setPage] = useState(1)
  const [loadError, setLoadError] = useState('')
  const [editingTicket, setEditingTicket] = useState(false)
  const [ticket, setTicket] = useState<JobTicket>({})
  const [profileId, setProfileId] = useState('')
  const [correction, setCorrection] = useState<ProjectFile | null>(null)
  const [fixing, setFixing] = useState(false)
  // O arquivo como o cliente enviou e o raio-x dele (para comparar com o que vai à produção).
  const [original, setOriginal] = useState<ProjectFile | null>(null)
  const [clientProfile, setClientProfile] = useState<FileProfile | null>(null)
  // O que aparece ao lado da arte: o que precisa de decisão, uma seção do raio-x ou a entrega.
  const [view, setView] = useState<View>('pending')

  // Durante uma correção, a análise acompanhada é a da cópia corrigida.
  const analysis = useAnalysisJob(correction?.id ?? file?.id ?? null)
  const running = !!analysis.job && ACTIVE.includes(analysis.job.status)

  const loadJob = useCallback(async () => {
    try {
      const current = await jobsService.getJob(id)
      if (!current) {
        setLoadError('Trabalho não encontrado.')
        return
      }
      setJob(current)
      setTicket(current.ticket)
      setProfileId(current.profileId)
      const { primary, correction: pending, original: client } = await jobsService.getFiles(id)
      setFile(primary)
      setCorrection(pending)
      setOriginal(client)
      const profile =
        client && primary && client.id !== primary.id
          ? await analysisJobsService.getLatestProfile(client.id).catch(() => null)
          : null
      setClientProfile(hasProfile(profile) ? profile : null)
      setPdfUrl(primary ? await projectFilesService.getFileUrl(primary) : '')
      // Arquivo do cliente em PDF, para comparar na mesa (imagem convertida não compara).
      setClientUrl(
        client && primary && client.id !== primary.id && !isImageFile(client)
          ? await projectFilesService.getFileUrl(client).catch(() => '')
          : '',
      )
    } catch (err) {
      setLoadError(getErrorMessage(err))
    }
  }, [id])

  useEffect(() => {
    loadJob()
  }, [loadJob])

  // A inspeção fica em <dono>/inspection/<arquivo>.pdf e só existe depois da análise:
  // procura de novo quando a análise do arquivo termina.
  const fileId = file?.id
  const fileOwner = file?.storage_path?.split('/')[0]
  const finished = analysis.job?.file === fileId && ['completed', 'completed_with_warnings'].includes(analysis.job?.status ?? '')
  useEffect(() => {
    setInspectionUrl('')
    if (!fileId || !fileOwner || !finished) return
    let cancelled = false
    projectFilesService
      .getFileUrl({ storage_path: `${fileOwner}/inspection/${fileId}.pdf` })
      .then((url) => !cancelled && setInspectionUrl(url))
      .catch(() => null)
    return () => {
      cancelled = true
    }
  }, [fileId, fileOwner, finished])

  // Correção terminou: a cópia corrigida vira o arquivo principal (ou é descartada).
  const correctionId = correction?.id
  const correctionStatus = analysis.job?.file === correctionId ? analysis.job?.status : undefined
  const correctionMessage = analysis.job?.error_message
  useEffect(() => {
    if (!correctionId || !correctionStatus || ACTIVE.includes(correctionStatus)) return
    if (correctionStatus === 'failed') {
      toast({
        title: 'A correção automática falhou',
        description: correctionMessage || 'O arquivo original continua como estava.',
        variant: 'destructive',
      })
    }
    loadJob()
  }, [correctionId, correctionStatus, correctionMessage, loadJob])

  // Correções que medem o arquivo (formato, sangria, marcas, faca, resolução) dependem do
  // tamanho final e da escala. Sem eles, o sistema teria de supor (página inteira = formato
  // final, 1:1) e poderia gerar sangria, faca e ppi sobre a premissa errada.
  const scaleIssue = analysis.issues.find((issue) => issue.status === 'pending' && issue.fix?.id === 'set_scale')
  const fixBlock = useCallback(
    (fixes: FixRequest[]): { title: string; description: string } | null => {
      if (!fixes.some((fix) => GEOMETRY_FIXES.has(fix.id))) return null
      const saved = job?.ticket ?? {}
      if (!(Number(saved.finalWidthMm) > 0 && Number(saved.finalHeightMm) > 0)) {
        return {
          title: 'Complete a ficha primeiro',
          description:
            'Informe o tamanho final (e a escala, se o arquivo não for 1:1) e salve. Sem isso, sangria, marcas, faca e resolução seriam calculadas supondo que a página inteira é o formato final em 1:1.',
        }
      }
      if (scaleIssue?.fix) {
        return {
          title: 'Confirme a escala primeiro',
          description: `O arquivo parece estar em outra escala. Clique em "${scaleIssue.fix.label}" (ou devolva ao cliente) antes de corrigir o formato.`,
        }
      }
      return null
    },
    [job?.ticket, scaleIssue],
  )
  const blockedBy = useCallback(
    (fixes: FixRequest[]) => {
      const block = fixBlock(fixes)
      if (!block) return false
      toast(block)
      if (block.title.startsWith('Complete')) setEditingTicket(true)
      return true
    },
    [fixBlock],
  )

  const applyFixes = useCallback(
    async (fixes: FixRequest[]) => {
      if (!file || !fixes.length || blockedBy(fixes)) return
      setFixing(true)
      try {
        await analysisJobsService.startCorrection(file.id, profileId, fixes)
        await loadJob()
      } catch (err) {
        toast({ title: 'Não foi possível corrigir', description: getErrorMessage(err), variant: 'destructive' })
      }
      setFixing(false)
    },
    [file, profileId, loadJob, blockedBy],
  )

  // A faca pelo contorno depende do afastamento escolhido pelo operador: pergunta antes.
  const [contourFixes, setContourFixes] = useState<FixRequest[] | null>(null)
  const [cropMarksOpen, setCropMarksOpen] = useState(false)
  // A sangria gerada também: o operador escolhe esticar ou espelhar a borda.
  const [bleedFixes, setBleedFixes] = useState<FixRequest[] | null>(null)
  const requestFixes = useCallback(
    async (fixes: FixRequest[]) => {
      // Antes de abrir qualquer janela: não adianta escolher opções de uma correção bloqueada.
      if (blockedBy(fixes)) return
      if (fixes.some((fix) => fix.id === 'add_bleed' && !fix.params?.method)) {
        setBleedFixes(fixes)
        return
      }
      if (fixes.some((fix) => fix.id === 'add_contour_cut')) {
        setContourFixes(fixes)
        return
      }
      await applyFixes(fixes)
    },
    [applyFixes, blockedBy],
  )
  const confirmContour = async (options: ContourCutOptions) => {
    const fixes = (contourFixes ?? []).map((fix) =>
      fix.id === 'add_contour_cut' ? { ...fix, params: { ...fix.params, ...options } } : fix,
    )
    setContourFixes(null)
    await applyFixes(fixes)
  }
  const confirmBleed = async (options: BleedOptions) => {
    const fixes = (bleedFixes ?? []).map((fix) =>
      fix.id === 'add_bleed' ? { ...fix, params: { ...fix.params, ...options } } : fix,
    )
    setBleedFixes(null)
    await requestFixes(fixes)
  }
  const bleedDefault = Number(bleedFixes?.find((fix) => fix.id === 'add_bleed')?.params?.bleedMm) || 0

  const fixIssue = useCallback(
    async (issue: AnalysisIssue, chosen?: IssueFix) => {
      // A correção escolhida em "Como resolver"; sem escolha, a que a ocorrência traz.
      const fix = chosen ?? issue.fix
      if (!fix || !job) return
      if (fix.target === 'ticket') {
        // Ex.: escala — o PDF está certo, a ficha é que precisa mudar.
        const next = { ...ticket, ...(fix.params as JobTicket) }
        setTicket(next)
        try {
          await jobsService.updateTicket(job.id, next, profileId)
          await analysis.startAnalysis(profileId || 'default')
          await loadJob()
        } catch (err) {
          toast({ title: 'Não foi possível ajustar a ficha', description: getErrorMessage(err), variant: 'destructive' })
        }
        return
      }
      await requestFixes([{ id: fix.id, params: fix.params }])
    },
    [job, ticket, profileId, analysis, loadJob, requestFixes],
  )

  const pendingPdfFixes = useMemo(() => {
    const byId = new Map<string, FixRequest>()
    for (const issue of analysis.issues) {
      if (issue.status === 'pending' && issue.fix?.target === 'pdf' && !byId.has(issue.fix.id)) {
        byId.set(issue.fix.id, { id: issue.fix.id, params: issue.fix.params })
      }
    }
    return [...byId.values()]
  }, [analysis.issues])

  const restoreOriginal = async () => {
    if (!job || !file?.derived_from) return
    try {
      await jobsService.setPrimaryFile(job.id, file.derived_from)
      await loadJob()
    } catch (err) {
      toast({ title: 'Não foi possível voltar ao original', description: getErrorMessage(err), variant: 'destructive' })
    }
  }

  // O resumo da fila acompanha o resultado da análise e as decisões do operador.
  const jobId = job?.id
  const analysisStatus = analysis.job?.status
  useEffect(() => {
    if (jobId && analysisStatus && !running) {
      jobsService.syncSummary(jobId, analysis.issues).catch(() => null)
    }
  }, [jobId, analysisStatus, analysis.issues, running])

  const decide = useCallback(
    async (issueId: string, status: string, reason?: string) => {
      try {
        await analysis.updateIssueStatus(issueId, status, reason)
      } catch (err) {
        toast({ title: 'Decisão não salva', description: getErrorMessage(err), variant: 'destructive' })
      }
    },
    [analysis],
  )

  // Gestão do trabalho: salva na hora, sem reanalisar (não muda o arquivo nem a ficha técnica).
  const saveMeta = async (change: Partial<JobMeta>) => {
    if (!job) return
    const previous = job
    setJob({ ...job, ...change })
    try {
      await jobsService.updateMeta(job.id, change)
    } catch (err) {
      setJob(previous)
      toast({ title: 'Não foi possível salvar', description: getErrorMessage(err), variant: 'destructive' })
    }
  }

  const sendToRip = async (sent: boolean) => {
    if (!job) return
    try {
      await jobsService.setSentToRip(job.id, sent)
      await loadJob()
      toast({ title: sent ? 'Enviado ao RIP' : 'Envio ao RIP desfeito' })
    } catch (err) {
      toast({ title: 'Não foi possível atualizar', description: getErrorMessage(err), variant: 'destructive' })
    }
  }

  const reanalyze = async () => {
    if (!job) return
    try {
      await jobsService.updateTicket(job.id, ticket, profileId)
      setEditingTicket(false)
      await analysis.startAnalysis(profileId || 'default')
      await loadJob()
    } catch (err) {
      toast({ title: 'Não foi possível reanalisar', description: getErrorMessage(err), variant: 'destructive' })
    }
  }

  const copyMessage = async () => {
    if (!job) return
    const text = buildClientMessage(job.name, job.clientName, analysis.issues)
    try {
      await navigator.clipboard.writeText(text)
      toast({ title: 'Mensagem copiada', description: 'Cole no WhatsApp ou no e-mail do cliente.' })
    } catch {
      toast({ title: 'Não foi possível copiar', variant: 'destructive' })
    }
  }

  const archive = async () => {
    if (!job) return
    await jobsService.archive(job.id)
    navigate('/trabalhos')
  }

  const cutLayerName = profiles.find((p) => p.id === profileId)?.cutLayerName?.trim() || ''

  // Histórico de correções desde o arquivo do cliente, sem as que não mudaram nada.
  const appliedFixes = (file?.applied_fixes ?? []).filter(
    (fix) => fix.details.length > 0 && !fix.details.every((d) => d.includes('já tinha')),
  )
  const applied = (id: string) => appliedFixes.some((fix) => fix.id === id)

  // Janelas que levam a correções de formato (ex.: marcas de corte) checam antes de abrir.
  const guardScale = (run: () => void) => () => {
    if (blockedBy([{ id: 'add_crop_marks' }])) return
    run()
  }

  if (loadError) {
    return (
      <div className="space-y-4">
        <BackLink />
        <p className="text-sm text-destructive">{loadError}</p>
      </div>
    )
  }

  if (!job) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }


  const liveJob: Job = analysis.job
    ? { ...job, ...summarizeIssues(analysis.issues), latestAnalysis: analysis.job }
    : job

  // Análise concluída (não está rodando nem falhou): mostra situação, raio-x e decisões.
  const done = !!analysis.job && !running && analysis.job.status !== 'failed' && analysis.job.status !== 'cancelled'
  const dtgProfile = profiles.find((p) => p.id === profileId && p.technology === 'dtg')
  const deliveredProfile = hasProfile(analysis.job?.file_profile) ? (analysis.job!.file_profile as FileProfile) : null
  const changes = canCompareCount(clientProfile, deliveredProfile)
  const profileName = profiles.find((p) => p.id === job.profileId)?.name

  return (
    <div className="flex flex-col gap-3 p-3 sm:p-4 lg:h-[calc(100vh-56px)]">
      {/* ---- Cabeçalho: quem, o quê e as ações do trabalho ---- */}
      <header className="flex shrink-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <BackLink />
          <h1 className="truncate text-xl font-semibold tracking-tight text-foreground">{job.name}</h1>
          <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            {[job.clientName, profileName].filter(Boolean).map((part, i) => (
              <span key={i} className="flex items-center gap-2">
                {i > 0 && <span className="h-1 w-1 rounded-full bg-muted-foreground/50" />}
                {part}
              </span>
            ))}
            {!done && <JobStateBadge job={liveJob} />}
          </p>
          <div className="mt-2">
            <JobMetaFields
              compact
              value={{ assigneeId: job.assigneeId, dueDate: job.dueDate, priority: job.priority }}
              onChange={saveMeta}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => setEditingTicket((v) => !v)}>
            <SlidersHorizontal className="h-4 w-4" />
            Ficha do trabalho
          </Button>
          <Button variant="outline" onClick={copyMessage} disabled={running || !analysis.job}>
            <ClipboardCopy className="h-4 w-4" />
            Mensagem ao cliente
          </Button>
          <Button onClick={reanalyze} disabled={running || fixing || analysis.starting || !file}>
            <RefreshCw className="h-4 w-4" />
            {analysis.job ? 'Reanalisar' : 'Analisar'}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Mais ações" disabled={!file}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuLabel className="text-xs text-muted-foreground">Inserir no arquivo</DropdownMenuLabel>
              <DropdownMenuItem
                disabled={applied('add_bleed') || applied('add_crop_marks') || running || fixing}
                onSelect={guardScale(() =>
                  requestFixes([{ id: 'add_bleed', params: { bleedMm: deliveredProfile?.targets?.minBleedMm ?? 0 } }]),
                )}
              >
                <Wand2 className="h-4 w-4" />
                Gerar sangria…{applied('add_bleed') && ' (já gerada)'}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={applied('add_crop_marks') || running || fixing} onSelect={guardScale(() => setCropMarksOpen(true))}>
                <Wand2 className="h-4 w-4" />
                Marcas de corte…{applied('add_crop_marks') && ' (já inseridas)'}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={applied('add_contour_cut') || applied('add_cut_contour') || running || fixing}
                onSelect={guardScale(() =>
                  requestFixes([{ id: 'add_contour_cut', params: cutLayerName ? { name: cutLayerName } : {} }]),
                )}
              >
                <Wand2 className="h-4 w-4" />
                Faca pelo contorno da arte…{applied('add_contour_cut') && ' (já inserida)'}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={applied('add_cut_contour') || applied('add_contour_cut') || running || fixing}
                onSelect={guardScale(() =>
                  applyFixes([{ id: 'set_page_boxes' }, { id: 'add_cut_contour', params: cutLayerName ? { name: cutLayerName } : {} }]),
                )}
              >
                <Wand2 className="h-4 w-4" />
                Faca retangular{cutLayerName ? ` (${cutLayerName})` : ''}
                {applied('add_cut_contour') && ' (já inserida)'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {pdfUrl && (
                <DropdownMenuItem asChild>
                  <a href={pdfUrl} target="_blank" rel="noreferrer">
                    <Download className="h-4 w-4" />
                    Baixar o arquivo atual
                  </a>
                </DropdownMenuItem>
              )}
              {file?.derived_from && !correction && appliedFixes[0]?.id !== 'image_to_pdf' && (
                <DropdownMenuItem onSelect={restoreOriginal} disabled={running}>
                  <Undo2 className="h-4 w-4" />
                  Voltar ao arquivo do cliente
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={archive} className="text-destructive focus:text-destructive">
                <Archive className="h-4 w-4" />
                Arquivar trabalho
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <BleedDialog
        open={!!bleedFixes}
        defaultMm={bleedDefault}
        onCancel={() => setBleedFixes(null)}
        onConfirm={confirmBleed}
      />
      <ContourCutDialog
        open={!!contourFixes}
        defaultName={cutLayerName}
        onCancel={() => setContourFixes(null)}
        onConfirm={confirmContour}
      />
      <CropMarksDialog
        open={cropMarksOpen}
        defaultSlug={[job.clientName, job.name, new Date().toLocaleDateString('pt-BR')].filter(Boolean).join(' · ')}
        onCancel={() => setCropMarksOpen(false)}
        onConfirm={(options) => {
          setCropMarksOpen(false)
          applyFixes([{ id: 'set_page_boxes' }, { id: 'add_crop_marks', params: { ...options } }])
        }}
      />

      {/* ---- A mesa: a arte em destaque, e a coluna de análise e decisões ao lado ---- */}
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_400px] 2xl:grid-cols-[minmax(0,1fr)_460px]">
        <div className="h-[70vh] min-h-0 lg:h-auto">
          {file ? (
            <ArtStage
              production={pdfUrl ? { url: pdfUrl, name: file.original_name, image: isImageFile(file) } : null}
              client={clientUrl && original ? { url: clientUrl, name: original.original_name } : null}
              page={page}
              onPageChange={setPage}
              fileScale={scaleOf(job.ticket.fileScale)}
              changes={appliedFixes}
              correcting={!!correction}
              inspectionUrl={inspectionUrl || null}
            />
          ) : (
            <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
              Este trabalho não tem arquivo.
            </div>
          )}
        </div>

        <aside id="detail" className="min-h-0 space-y-3 lg:overflow-y-auto lg:pr-1">
          {editingTicket && (
            <section className="space-y-4 rounded-xl border border-primary/40 bg-card p-4">
              <JobTicketFields
                ticket={ticket}
                onChange={setTicket}
                profiles={profiles}
                profileId={profileId}
                onProfileChange={setProfileId}
              />
              <div className="flex gap-2">
                <Button onClick={reanalyze} disabled={running}>
                  Salvar e reanalisar
                </Button>
                <Button variant="ghost" onClick={() => setEditingTicket(false)}>
                  Cancelar
                </Button>
              </div>
            </section>
          )}

          {dtgProfile && (
            <DtgPlacementPanel
              profile={dtgProfile}
              ticket={ticket}
              pdfUrl={pdfUrl || null}
              page={page}
              measured={deliveredProfile?.textile?.pages?.find((p) => p.page === page)}
              onSave={async (next) => {
                await jobsService.updateTicket(job.id, next, profileId)
                setTicket(next)
                toast({ title: 'Posição salva na ficha', description: 'Reanalise para conferir a área do gabarito.' })
              }}
            />
          )}

          {running && analysis.job && (
            <section className="space-y-3 rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-3 text-foreground">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  <span>
                    <span className="block text-sm font-medium">{analysis.job.current_step || 'Na fila do analisador'}</span>
                    <span className="text-xs text-muted-foreground">O raio-x aparece assim que a análise terminar.</span>
                  </span>
                </span>
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  {analysis.job.progress}%
                  <Button size="sm" variant="ghost" onClick={analysis.cancelAnalysis}>
                    Cancelar
                  </Button>
                </span>
              </div>
              <Progress value={analysis.job.progress} className="h-1.5" />
            </section>
          )}

          {analysis.error && (
            <p className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{analysis.error}</p>
          )}

          {analysis.job?.status === 'failed' && (
            <section className="space-y-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4">
              <div className="text-sm">
                <p className="font-medium text-destructive">A análise falhou</p>
                <p className="text-muted-foreground">{analysis.job.error_message || 'Sem detalhes.'}</p>
              </div>
              <Button variant="outline" onClick={analysis.retryAnalysis}>
                Tentar de novo
              </Button>
            </section>
          )}

          {analysis.loading ? (
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
          ) : !analysis.job ? (
            <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              Ainda não há análise. Clique em Analisar.
            </p>
          ) : null}

          {done && (
            <StatusHero
              issues={analysis.issues}
              autoFixes={pendingPdfFixes.length}
              fixing={fixing}
              correcting={!!correction}
              original={original}
              delivered={file}
              fixes={appliedFixes}
              downloadUrl={pdfUrl}
              onFixAll={guardScale(() => requestFixes(pendingPdfFixes))}
              onMessage={copyMessage}
              onShowPending={() => {
                setView('pending')
                document.getElementById('issues')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }}
              sentToRip={job.sentToRipAt ? { at: job.sentToRipAt, by: nameOf(job.sentToRipBy) } : null}
              onSendToRip={sendToRip}
            />
          )}

          {done && deliveredProfile && (
            <XRayTiles
              profile={deliveredProfile}
              issues={analysis.issues}
              view={view}
              onSelect={(next) => {
                setView(next)
                requestAnimationFrame(() =>
                  document.getElementById('issues')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
                )
              }}
              delivery={file?.derived_from ? { changes } : null}
            />
          )}

          {done && !deliveredProfile && (
            <p className="rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
              Esta análise é anterior ao raio-x. Clique em <b className="text-foreground">Reanalisar</b> para ver as
              características do arquivo.
            </p>
          )}

          {done && (
            <div id="issues" className="scroll-mt-2">
              <SectionDetail
                view={view}
                profile={deliveredProfile}
                issues={analysis.issues}
                clientProfile={clientProfile}
                fixes={appliedFixes}
                onClose={() => setView('pending')}
                onDecide={decide}
                onShowPage={setPage}
                onFix={fixIssue}
                fixing={fixing}
              />
            </div>
          )}
          {done && analysis.job?.metrics && <JobMetricsLine metrics={analysis.job.metrics} />}
        </aside>
      </div>
    </div>
  )
}

/** Escala da ficha ("1:10") como fator para o tamanho final (10). */
function scaleOf(value?: string): number {
  const match = String(value ?? '').match(/(\d+(?:[.,]\d+)?)\s*:\s*(\d+(?:[.,]\d+)?)/)
  if (!match) return 1
  const factor = Number(match[2].replace(',', '.')) / Number(match[1].replace(',', '.'))
  return Number.isFinite(factor) && factor > 0 ? factor : 1
}

/** Quantas características mudaram entre o arquivo do cliente e o de produção. */
function canCompareCount(client: FileProfile | null, delivered: FileProfile | null): number {
  if (!client || !delivered) return 0
  return compareRows(client, delivered).filter((row) => row.changed).length
}

function BackLink() {
  return (
    <Link
      to="/trabalhos"
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" />
      Fila de trabalho
    </Link>
  )
}
