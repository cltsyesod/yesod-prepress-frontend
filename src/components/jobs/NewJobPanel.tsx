import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileUp, Loader2, SlidersHorizontal, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { getErrorMessage } from '@/lib/supabase/errors'
import { JobTicketFields } from '@/components/jobs/JobTicketFields'
import { jobsService, type JobTicket } from '@/services/jobsService'
import { profileService } from '@/services/profileService'
import { ARTWORK_ACCEPT, MAX_UPLOAD_BYTES, artworkType } from '@/services/projectFilesService'

/** Soltar a arte do cliente (PDF ou imagem), ajustar a ficha (opcional) e analisar. */
export function NewJobPanel() {
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const profiles = profileService.getProfilesSync()
  const [file, setFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [showTicket, setShowTicket] = useState(false)
  const [clientName, setClientName] = useState('')
  const [profileId, setProfileId] = useState(
    profiles.find((p) => p.isDefault)?.id ?? profiles[0]?.id ?? '',
  )
  const [ticket, setTicket] = useState<JobTicket>({})
  const [sending, setSending] = useState(false)

  const pick = (candidate: File | undefined) => {
    if (!candidate) return
    if (!artworkType(candidate.name)) {
      toast({ title: 'Formato não aceito', description: 'Envie PDF, TIFF, JPG ou PNG.', variant: 'destructive' })
      return
    }
    if (candidate.size > MAX_UPLOAD_BYTES) {
      toast({
        title: 'O arquivo passa de 50 MB',
        description: 'É o limite por arquivo do armazenamento atual.',
        variant: 'destructive',
      })
      return
    }
    setFile(candidate)
  }

  const submit = async () => {
    if (!file) return
    setSending(true)
    try {
      const profile = profiles.find((p) => p.id === profileId)
      const id = await jobsService.createFromFile(file, {
        clientName: clientName.trim(),
        profileId,
        profileName: profile?.name ?? '',
        ticket,
      })
      navigate(`/trabalhos/${id}`)
    } catch (err) {
      toast({
        title: 'Não foi possível enviar o arquivo',
        description: getErrorMessage(err),
        variant: 'destructive',
      })
      setSending(false)
    }
  }

  return (
    <section className="rounded-lg border border-border bg-card p-4 sm:p-5 space-y-4">
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
          'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-4 py-8 text-center transition-colors',
          dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/60',
        )}
      >
        <FileUp className="h-8 w-8 text-primary" />
        {file ? (
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground">{file.name}</span>
            <span className="text-sm text-muted-foreground">
              {(file.size / 1024 / 1024).toFixed(1)} MB
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              aria-label="Remover arquivo"
              onClick={(e) => {
                e.stopPropagation()
                setFile(null)
              }}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <>
            <p className="font-medium text-foreground">Solte aqui a arte do cliente</p>
            <p className="text-sm text-muted-foreground">
              PDF, TIFF, JPG ou PNG, até 50 MB. Imagens são convertidas em PDF sem perder qualidade.
            </p>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={ARTWORK_ACCEPT}
          className="hidden"
          onChange={(e) => pick(e.target.files?.[0])}
        />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="client">Cliente (opcional)</Label>
          <Input
            id="client"
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            placeholder="Nome do cliente"
          />
        </div>
        <Button variant="outline" onClick={() => setShowTicket((v) => !v)}>
          <SlidersHorizontal className="h-4 w-4" />
          {showTicket ? 'Ocultar ficha do trabalho' : 'Ficha do trabalho'}
        </Button>
        <Button onClick={submit} disabled={!file || sending} className="sm:min-w-[140px]">
          {sending && <Loader2 className="h-4 w-4 animate-spin" />}
          {sending ? 'Enviando...' : 'Analisar'}
        </Button>
      </div>

      {showTicket && (
        <div className="border-t border-border pt-4">
          <JobTicketFields
            ticket={ticket}
            onChange={setTicket}
            profiles={profiles}
            profileId={profileId}
            onProfileChange={setProfileId}
          />
        </div>
      )}
    </section>
  )
}
