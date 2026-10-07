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
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { IssueChecklist } from '@/components/jobs/IssueChecklist'
import { JobStateBadge } from '@/components/jobs/JobStateBadge'
import { JobTicketFields } from '@/components/jobs/JobTicketFields'
import { useAnalysisJob } from '@/hooks/use-analysis-job'
import { toast } from '@/hooks/use-toast'
import { buildClientMessage } from '@/lib/clientMessage'
import { getErrorMessage } from '@/lib/supabase/errors'
import { jobsService, type Job, type JobTicket } from '@/services/jobsService'
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

  const analysis = useAnalysisJob(file?.id ?? null)
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
      const primary = await jobsService.getPrimaryFile(id)
      setFile(primary)
      if (primary) setPdfUrl(await projectFilesService.getFileUrl(primary))
    } catch (err) {
      setLoadError(getErrorMessage(err))
    }
  }, [id])

  useEffect(() => {
    loadJob()
  }, [loadJob])

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

  const viewerSrc = useMemo(() => (pdfUrl ? `${pdfUrl}#page=${page}&view=FitH` : ''), [pdfUrl, page])

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
    ? { ...job, latestAnalysis: analysis.job }
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
          <Button variant="outline" onClick={() => setEditingTicket((v) => !v)}>
            <SlidersHorizontal className="h-4 w-4" />
            Ficha do trabalho
          </Button>
          <Button onClick={reanalyze} disabled={running || analysis.starting || !file}>
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

      {running && analysis.job && (
        <div className="space-y-2 rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {analysis.job.current_step || 'Na fila do analisador'}
            </span>
            <span className="text-muted-foreground">{analysis.job.progress}%</span>
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
          {viewerSrc ? (
            <iframe key={viewerSrc} src={viewerSrc} title="PDF do cliente" className="h-full w-full" />
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
            <IssueChecklist issues={analysis.issues} onDecide={decide} onShowPage={setPage} />
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
