import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  Archive,
  ArrowLeft,
  ClipboardCopy,
  Download,
  Loader2,
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Progress } from '@/components/ui/progress'
import { IssueChecklist } from '@/components/jobs/IssueChecklist'
import { JobStateBadge } from '@/components/jobs/JobStateBadge'
import { JobTicketFields } from '@/components/jobs/JobTicketFields'
import { ContourCutDialog, type ContourCutOptions } from '@/components/jobs/ContourCutDialog'
import { PdfPreview } from '@/components/jobs/PdfPreview'
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
import { projectFilesService } from '@/services/projectFilesService'
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
      const { primary, correction: pending } = await jobsService.getFiles(id)
      setFile(primary)
      setCorrection(pending)
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

  return (
    <div className="space-y-4">
      <BackLink />

      <header className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="truncate text-2xl font-semibold text-foreground">{job.name}</h1>
            <JobStateBadge job={liveJob} />
          </div>
          <p className="text-sm text-muted-foreground">
            {[job.clientName, profiles.find((p) => p.id === job.profileId)?.name, file?.original_name]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={copyMessage} disabled={running || !analysis.job}>
            <ClipboardCopy className="h-4 w-4" />
            Mensagem ao cliente
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" disabled={running || fixing || !file}>
                <Wand2 className="h-4 w-4" />
                Correções
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuItem
                disabled={!pendingPdfFixes.length}
                onSelect={guardScale(() => requestFixes(pendingPdfFixes))}
              >
                Corrigir tudo que for automático
                {pendingPdfFixes.length > 0 && ` (${pendingPdfFixes.length})`}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={applied('add_crop_marks')}
                onSelect={guardScale(() => applyFixes([{ id: 'set_page_boxes' }, { id: 'add_crop_marks' }]))}
              >
                Inserir marcas de corte{applied('add_crop_marks') && ' (já inseridas)'}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={applied('add_contour_cut') || applied('add_cut_contour')}
                onSelect={guardScale(() =>
                  requestFixes([
                    { id: 'add_contour_cut', params: cutLayerName ? { name: cutLayerName } : {} },
                  ]),
                )}
              >
                Faca pelo contorno da arte…
                {applied('add_contour_cut') && ' — já inserida'}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={applied('add_cut_contour') || applied('add_contour_cut')}
                onSelect={guardScale(() =>
                  applyFixes([
                    { id: 'set_page_boxes' },
                    { id: 'add_cut_contour', params: cutLayerName ? { name: cutLayerName } : {} },
                  ]),
                )}
              >
                Inserir faca retangular{cutLayerName ? ` (${cutLayerName})` : ''}
                {applied('add_cut_contour') && ' — já inserida'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" onClick={() => setEditingTicket((v) => !v)}>
            <SlidersHorizontal className="h-4 w-4" />
            Ficha do trabalho
          </Button>
          <Button onClick={reanalyze} disabled={running || fixing || analysis.starting || !file}>
            <RefreshCw className="h-4 w-4" />
            {analysis.job ? 'Reanalisar' : 'Analisar'}
          </Button>
          {pdfUrl && (
            <Button variant="ghost" size="icon" asChild title="Baixar PDF">
              <a href={pdfUrl} target="_blank" rel="noreferrer" aria-label="Baixar PDF">
                <Download className="h-4 w-4" />
              </a>
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={archive} title="Arquivar trabalho" aria-label="Arquivar">
            <Archive className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <ContourCutDialog
        open={!!contourFixes}
        defaultName={cutLayerName}
        onCancel={() => setContourFixes(null)}
        onConfirm={confirmContour}
      />

      {editingTicket && (
        <section className="space-y-4 rounded-lg border border-border bg-card p-4">
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

      {!!file?.derived_from && !correction && (
        <div className="flex flex-col gap-2 rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <p className="flex items-center gap-2 font-medium text-foreground">
              <Wand2 className="h-4 w-4 text-primary" />
              Versão corrigida automaticamente
            </p>
            <ul className="text-muted-foreground">
              {appliedFixes.map((fix, index) => (
                <li key={`${fix.id}-${index}`}>
                  {fix.label}
                  {fix.details.length > 0 && <span className="text-xs"> — {fix.details.join(' · ')}</span>}
                </li>
              ))}
            </ul>
          </div>
          {file.derived_from && (
            <Button size="sm" variant="ghost" className="shrink-0" onClick={restoreOriginal} disabled={running}>
              <Undo2 className="h-4 w-4" />
              Voltar ao original
            </Button>
          )}
        </div>
      )}

      {running && analysis.job && (
        <div className="space-y-2 rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {analysis.job.current_step || 'Na fila do analisador'}
            </span>
            <span className="flex items-center gap-3 text-muted-foreground">
              {analysis.job.progress}%
              <Button size="sm" variant="ghost" onClick={analysis.cancelAnalysis}>
                Cancelar
              </Button>
            </span>
          </div>
          <Progress value={analysis.job.progress} />
        </div>
      )}

      {analysis.error && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {analysis.error}
        </p>
      )}

      {analysis.job?.status === 'failed' && (
        <div className="flex flex-col gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm">
            <p className="font-medium text-destructive">A análise falhou</p>
            <p className="text-muted-foreground">{analysis.job.error_message || 'Sem detalhes.'}</p>
          </div>
          <Button variant="outline" onClick={analysis.retryAnalysis}>
            Tentar de novo
          </Button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)]">
        <div className="h-[60vh] overflow-hidden rounded-lg border border-border bg-muted lg:sticky lg:top-[72px] lg:h-[calc(100vh-120px)]">
          {pdfUrl ? (
            <PdfPreview url={pdfUrl} page={page} onPageChange={setPage} />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {file ? 'Carregando o PDF...' : 'Este trabalho não tem arquivo.'}
            </div>
          )}
        </div>

        <div className="min-w-0">
          {analysis.loading ? (
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
          ) : !analysis.job ? (
            <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              Ainda não há análise. Clique em Analisar.
            </p>
          ) : running ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              As ocorrências aparecem aqui assim que a análise terminar.
            </p>
          ) : (
            <IssueChecklist
              issues={analysis.issues}
              onDecide={decide}
              onShowPage={setPage}
              onFix={fixIssue}
              fixing={fixing}
            />
          )}
        </div>
      </div>
    </div>
  )
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
