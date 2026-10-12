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
import { ContourCutDialog, type ContourCutOptions } from '@/components/jobs/ContourCutDialog'
import { CropMarksDialog } from '@/components/jobs/CropMarksDialog'
import { JobMetricsLine } from '@/components/jobs/JobMetricsLine'
import { PdfPreview } from '@/components/jobs/PdfPreview'
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
} from '@/services/analysisJobsService'
import { profileService } from '@/services/profileService'
import { isImageFile, projectFilesService } from '@/services/projectFilesService'
import type { ProjectFile } from '@/types'

const ACTIVE = ['queued', 'preparing', 'downloading', 'validating', 'extracting', 'analyzing', 'generating_preview']

export default function JobWorkspacePage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const profiles = profileService.getProfilesSync()

  const [job, setJob] = useState<Job | null>(null)
  const [file, setFile] = useState<ProjectFile | null>(null)
  const [pdfUrl, setPdfUrl] = useState('')
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
    } catch (err) {
      setLoadError(getErrorMessage(err))
    }
  }, [id])

  useEffect(() => {
    loadJob()
  }, [loadJob])

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

  const applyFixes = useCallback(
    async (fixes: FixRequest[]) => {
      if (!file || !fixes.length) return
      setFixing(true)
      try {
        await analysisJobsService.startCorrection(file.id, profileId, fixes)
        await loadJob()
      } catch (err) {
        toast({ title: 'Não foi possível corrigir', description: getErrorMessage(err), variant: 'destructive' })
      }
      setFixing(false)
    },
    [file, profileId, loadJob],
  )

  // A faca pelo contorno depende do afastamento escolhido pelo operador: pergunta antes.
  const [contourFixes, setContourFixes] = useState<FixRequest[] | null>(null)
  const [cropMarksOpen, setCropMarksOpen] = useState(false)
  const requestFixes = useCallback(
    async (fixes: FixRequest[]) => {
      if (fixes.some((fix) => fix.id === 'add_contour_cut')) {
        setContourFixes(fixes)
        return
      }
      await applyFixes(fixes)
    },
    [applyFixes],
  )
  const confirmContour = async (options: ContourCutOptions) => {
    const fixes = (contourFixes ?? []).map((fix) =>
      fix.id === 'add_contour_cut' ? { ...fix, params: { ...fix.params, ...options } } : fix,
    )
    setContourFixes(null)
    await applyFixes(fixes)
  }

  const fixIssue = useCallback(
    async (issue: AnalysisIssue) => {
      if (!issue.fix || !job) return
      if (issue.fix.target === 'ticket') {
        // Ex.: escala — o PDF está certo, a ficha é que precisa mudar.
        const next = { ...ticket, ...(issue.fix.params as JobTicket) }
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
      await requestFixes([{ id: issue.fix.id, params: issue.fix.params }])
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

  // Marcas e faca são desenhadas no tamanho do arquivo: com uma escala ainda por
  // confirmar, sairiam N vezes maiores (ou menores) na peça final.
  const pendingScale = analysis.issues.find(
    (issue) => issue.status === 'pending' && issue.fix?.id === 'set_scale',
  )
  const guardScale = (run: () => void) => () => {
    if (pendingScale?.fix) {
      toast({
        title: 'Confirme a escala primeiro',
        description: `O arquivo parece estar em outra escala. Clique em "${pendingScale.fix.label}" (ou devolva ao cliente) antes de inserir marcas ou faca.`,
      })
      return
    }
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
  const deliveredProfile = hasProfile(analysis.job?.file_profile) ? (analysis.job!.file_profile as FileProfile) : null
  const changes = canCompareCount(clientProfile, deliveredProfile)
  const profileName = profiles.find((p) => p.id === job.profileId)?.name

  return (
    <div className="space-y-5">
      {/* ---- Cabeçalho: quem, o quê e as ações do trabalho ---- */}
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 space-y-1">
          <BackLink />
          <h1 className="truncate text-2xl font-semibold tracking-tight text-foreground">{job.name}</h1>
          <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            {[job.clientName, profileName].filter(Boolean).map((part, i) => (
              <span key={i} className="flex items-center gap-2">
                {i > 0 && <span className="h-1 w-1 rounded-full bg-muted-foreground/50" />}
                {part}
              </span>
            ))}
            {!done && <JobStateBadge job={liveJob} />}
          </p>
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

      {editingTicket && (
        <section className="space-y-4 rounded-xl border border-border bg-card p-5">
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

      {/* ---- Andamento, erro ou falha ---- */}
      {running && analysis.job && (
        <section className="space-y-3 rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-3 text-foreground">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <span>
                <span className="block font-medium">{analysis.job.current_step || 'Na fila do analisador'}</span>
                <span className="text-xs text-muted-foreground">O raio-x aparece assim que a análise terminar.</span>
              </span>
            </span>
            <span className="flex items-center gap-3 text-sm text-muted-foreground">
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
        <section className="flex flex-col gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm">
            <p className="font-medium text-destructive">A análise falhou</p>
            <p className="text-muted-foreground">{analysis.job.error_message || 'Sem detalhes.'}</p>
          </div>
          <Button variant="outline" onClick={analysis.retryAnalysis}>
            Tentar de novo
          </Button>
        </section>
      )}

      {/* ---- Situação + raio-x ---- */}
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
            document.getElementById('detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }}
        />
      )}

      {done && deliveredProfile && (
        <XRayTiles
          profile={deliveredProfile}
          issues={analysis.issues}
          view={view}
          onSelect={setView}
          delivery={file?.derived_from ? { changes } : null}
        />
      )}

      {done && !deliveredProfile && (
        <p className="rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
          Esta análise é anterior ao raio-x. Clique em <b className="text-foreground">Reanalisar</b> para ver as características do
          arquivo (formato, sangria, imagens, cores, fontes e faca) em cartões.
        </p>
      )}

      {/* ---- Arte e detalhe lado a lado ---- */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className="h-[62vh] overflow-hidden rounded-xl border border-border bg-muted xl:sticky xl:top-[72px] xl:h-[calc(100vh-110px)]">
          {pdfUrl && isImageFile(file) ? (
            // Imagem do cliente ainda não convertida: mostra a própria imagem.
            <img src={pdfUrl} alt={file?.original_name ?? ''} className="h-full w-full object-contain" />
          ) : pdfUrl ? (
            <PdfPreview url={pdfUrl} page={page} onPageChange={setPage} />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {file ? 'Carregando o arquivo…' : 'Este trabalho não tem arquivo.'}
            </div>
          )}
        </div>

        <div id="detail" className="min-w-0 scroll-mt-20 space-y-3">
          {analysis.loading ? (
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
          ) : !analysis.job ? (
            <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              Ainda não há análise. Clique em Analisar.
            </p>
          ) : done ? (
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
          ) : null}
          {done && analysis.job?.metrics && <JobMetricsLine metrics={analysis.job.metrics} />}
        </div>
      </div>
    </div>
  )
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
