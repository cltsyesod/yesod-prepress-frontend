import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CheckCircle2, CircleDashed, FileUp, Layers, Loader2, Shirt, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from '@/hooks/use-toast'
import { useRealtime } from '@/hooks/use-realtime'
import { STAGES } from '@/lib/job-meta'
import { cn } from '@/lib/utils'
import { getErrorMessage } from '@/lib/supabase/errors'
import { jobsService, type Job, type JobTicket } from '@/services/jobsService'
import { MAX_UPLOAD_BYTES, artworkType } from '@/services/projectFilesService'
import { profileService } from '@/services/profileService'
import type { DtgTemplate } from '@/domain/dtg/placement'

type Tech = 'dtf' | 'dtg'

const TECHS: { id: Tech; title: string; text: string; icon: typeof Layers }[] = [
  { id: 'dtf', title: 'DTF', text: 'Transfer em filme: base branca, folha no rolo e espelho conforme o fluxo', icon: Layers },
  { id: 'dtg', title: 'DTG', text: 'Direto na peça: gabarito, posição em mm e base branca conforme a cor da peça', icon: Shirt },
]

const keyOf = (t: DtgTemplate) => `${t.name}${t.size ? ` · ${t.size}` : ''}`
const num = (v: string) => (v === '' ? undefined : Number(v.replace(',', '.')))

/**
 * Trabalhos de DTF / DTG: o processo primeiro, depois a estampa e a ficha têxtil (tamanho
 * da estampa, resolução, cópias ou peça). Nada de sangria, faca ou escala: a conferência
 * vem do perfil DTF/DTG. A lista mostra o que importa para estampar: base branca e posição.
 */
export default function TextileJobsPage() {
  const navigate = useNavigate()
  const profiles = profileService.getProfilesSync()
  const [tech, setTech] = useState<Tech>('dtf')
  const options = profiles.filter((p) => p.technology === tech && p.status !== 'inactive')
  const [profileId, setProfileId] = useState('')
  const profile = options.find((p) => p.id === profileId)
  const templates = (profile?.textile?.templates ?? []).filter((t) => t.name && t.areaWidthMm > 0 && t.areaHeightMm > 0)

  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [clientName, setClientName] = useState('')
  const [ticket, setTicket] = useState<JobTicket>({})
  const [sending, setSending] = useState(false)

  useEffect(() => {
    // Trocar de processo limpa o que é de um só (perfil, gabarito, cópias).
    setProfileId(options.length === 1 ? options[0].id : '')
    setTicket((t) => ({ finalWidthMm: t.finalWidthMm, finalHeightMm: t.finalHeightMm, minResolution: t.minResolution }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tech])

  const set = (patch: Partial<JobTicket>) => setTicket((t) => ({ ...t, ...patch }))
  const setDtg = (patch: NonNullable<JobTicket['dtg']>) => setTicket((t) => ({ ...t, dtg: { ...t.dtg, ...patch } }))

  const pick = (candidate: File | undefined) => {
    if (!candidate) return
    if (!artworkType(candidate.name)) {
      toast({ title: 'Formato não aceito', description: 'Envie PDF, TIFF, JPG ou PNG.', variant: 'destructive' })
      return
    }
    if (candidate.size > MAX_UPLOAD_BYTES) {
      toast({ title: 'O arquivo passa de 50 MB', variant: 'destructive' })
      return
    }
    setFile(candidate)
  }

  const missing = [!file && 'a arte', !profileId && `o perfil ${tech.toUpperCase()}`].filter(Boolean)

  const submit = async () => {
    if (!file || !profile) return
    setSending(true)
    try {
      const template = templates.find((t) => keyOf(t) === ticket.dtg?.template)
      const id = await jobsService.createFromFile(file, {
        clientName: clientName.trim(),
        profileId: profile.id,
        profileName: profile.name,
        ticket: template
          ? { ...ticket, textile: { printWidthMm: template.areaWidthMm, printHeightMm: template.areaHeightMm } }
          : ticket,
      })
      navigate(`/trabalhos/${id}`)
    } catch (err) {
      toast({ title: 'Não foi possível enviar a estampa', description: getErrorMessage(err), variant: 'destructive' })
      setSending(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Processo">
        {TECHS.map((t) => {
          const Icon = t.icon
          const active = tech === t.id
          return (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setTech(t.id)}
              className={cn(
                'flex items-start gap-3 rounded-xl border-2 p-4 text-left transition-colors',
                active ? 'border-primary bg-primary/5' : 'border-border bg-card hover:border-primary/40',
              )}
            >
              <Icon className={cn('mt-0.5 h-6 w-6 shrink-0', active ? 'text-primary' : 'text-muted-foreground')} />
              <span>
                <span className="block text-lg font-semibold text-foreground">{t.title}</span>
                <span className="block text-sm text-muted-foreground">{t.text}</span>
              </span>
            </button>
          )
        })}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <section className="space-y-4 rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">Nova estampa {tech.toUpperCase()}</h2>
          <div
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              pick(e.dataTransfer.files?.[0])
            }}
            className={cn(
              'flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border-2 border-dashed px-4 py-6 text-center',
              dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/60',
            )}
          >
            <FileUp className="h-7 w-7 text-primary" />
            {file ? (
              <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                {file.name}
                <button
                  type="button"
                  aria-label="Trocar arquivo"
                  onClick={(e) => {
                    e.stopPropagation()
                    setFile(null)
                  }}
                >
                  <X className="h-4 w-4 text-muted-foreground" />
                </button>
              </span>
            ) : (
              <>
                <span className="text-sm font-medium text-foreground">Solte a estampa aqui</span>
                <span className="text-xs text-muted-foreground">PNG com transparência, PDF, TIFF ou JPG · até 50 MB</span>
              </>
            )}
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              accept=".pdf,.tif,.tiff,.jpg,.jpeg,.png"
              onChange={(e) => pick(e.target.files?.[0])}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Perfil {tech.toUpperCase()}</Label>
            {options.length ? (
              <Select value={profileId} onValueChange={setProfileId}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Escolher o equipamento/perfil" />
                </SelectTrigger>
                <SelectContent>
                  {options.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Nenhum perfil {tech.toUpperCase()}. <Link className="underline" to="/textil/perfis">Cadastrar</Link>
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Cliente</Label>
            <Input className="h-9" value={clientName} placeholder="opcional" onChange={(e) => setClientName(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Largura da estampa (mm)</Label>
              <Input className="h-9" inputMode="decimal" placeholder="da arte" value={ticket.finalWidthMm ?? ''} onChange={(e) => set({ finalWidthMm: num(e.target.value) })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Altura da estampa (mm)</Label>
              <Input className="h-9" inputMode="decimal" placeholder="da arte" value={ticket.finalHeightMm ?? ''} onChange={(e) => set({ finalHeightMm: num(e.target.value) })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Resolução mínima (ppi)</Label>
              <Input className="h-9" inputMode="numeric" placeholder={profile?.minResolution ? String(profile.minResolution) : 'do perfil'} value={ticket.minResolution ?? ''} onChange={(e) => set({ minResolution: num(e.target.value) })} />
            </div>
            {tech === 'dtf' ? (
              <div className="space-y-1.5">
                <Label className="text-xs">Cópias na folha</Label>
                <Input className="h-9" inputMode="numeric" placeholder="1" value={ticket.dtf?.copies ?? ''} onChange={(e) => set({ dtf: { copies: num(e.target.value) } })} />
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label className="text-xs">Cor da peça</Label>
                <input
                  type="color"
                  className="h-9 w-full cursor-pointer rounded-md border border-border bg-transparent"
                  value={ticket.dtg?.garmentColor ?? '#1f2937'}
                  onChange={(e) => setDtg({ garmentColor: e.target.value })}
                />
              </div>
            )}
          </div>

          {tech === 'dtg' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label className="text-xs">Gabarito da peça</Label>
                {templates.length ? (
                  <Select value={ticket.dtg?.template ?? ''} onValueChange={(v) => setDtg({ template: v })}>
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Escolher peça e tamanho" />
                    </SelectTrigger>
                    <SelectContent>
                      {templates.map((t) => (
                        <SelectItem key={keyOf(t)} value={keyOf(t)}>
                          {keyOf(t)} — área {t.areaWidthMm} × {t.areaHeightMm} mm
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {profile ? 'Este perfil não tem gabaritos.' : 'Escolha o perfil para ver os gabaritos.'}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Tecido</Label>
                <Input className="h-9" placeholder="ex.: 100% algodão" value={ticket.dtg?.fabric ?? ''} onChange={(e) => setDtg({ fabric: e.target.value || undefined })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Pré-tratamento</Label>
                <Input className="h-9" placeholder={profile?.textile?.pretreatment || 'a confirmar'} value={ticket.dtg?.pretreatment ?? ''} onChange={(e) => setDtg({ pretreatment: e.target.value || undefined })} />
              </div>
            </div>
          )}

          <Button className="w-full" onClick={submit} disabled={sending || missing.length > 0}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : `Analisar estampa ${tech.toUpperCase()}`}
          </Button>
          {missing.length > 0 && <p className="text-center text-xs text-muted-foreground">Falta: {missing.join(' e ')}.</p>}
        </section>

        <TextileList tech={tech} />
      </div>
    </div>
  )
}

function TextileList({ tech }: { tech: Tech }) {
  const profiles = profileService.getProfilesSync()
  const [jobs, setJobs] = useState<Job[]>([])
  const [white, setWhite] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const techOf = (job: Job) => profiles.find((p) => p.id === job.profileId)?.technology
  const generates = (job: Job) => profiles.find((p) => p.id === job.profileId)?.textile?.whiteMode === 'generate'

  const load = useCallback(async () => {
    try {
      const all = (await jobsService.listJobs()).filter((job) => techOf(job) === 'dtf' || techOf(job) === 'dtg')
      setJobs(all)
      setWhite(await jobsService.withWhiteBase(all.map((j) => j.id)))
    } catch {
      setJobs([])
    }
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    load()
  }, [load])
  useRealtime('analysis_jobs', () => load(), true)
  useRealtime('projects', () => load(), true)

  const visible = useMemo(() => jobs.filter((job) => techOf(job) === tech && job.stage !== 'archived'), [jobs, tech]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="min-w-0 space-y-2">
      <h2 className="text-sm font-semibold">Estampas {tech.toUpperCase()}</h2>
      {loading ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Nenhuma estampa {tech.toUpperCase()} ainda.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {visible.map((job) => {
            const stage = STAGES.find((s) => s.id === job.stage)
            const size =
              job.ticket.finalWidthMm && job.ticket.finalHeightMm
                ? `${job.ticket.finalWidthMm} × ${job.ticket.finalHeightMm} mm`
                : 'tamanho da arte'
            const whiteOk = !generates(job) || white.has(job.id)
            return (
              <li key={job.id}>
                <Link to={`/trabalhos/${job.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-muted/50">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-foreground">{job.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[job.clientName, size, tech === 'dtf' ? `${job.ticket.dtf?.copies ?? 1} cópia(s)` : job.ticket.dtg?.template].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <Check ok={whiteOk} label={generates(job) ? 'Base branca' : 'Branco (perfil)'} />
                  {tech === 'dtg' && <Check ok={!!job.ticket.dtg?.template} label="Posição" />}
                  <span className={cn('flex items-center gap-1.5 text-xs font-medium', stage?.text)}>
                    <span className={cn('h-2 w-2 rounded-full', stage?.dot)} />
                    {stage?.label ?? '—'}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  const Icon = ok ? CheckCircle2 : CircleDashed
  return (
    <span className={cn('flex items-center gap-1 text-xs', ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground')}>
      <Icon className="h-3.5 w-3.5" />
      {label}
    </span>
  )
}
