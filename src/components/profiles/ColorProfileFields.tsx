import { useEffect, useRef, useState } from 'react'
import { Loader2, Trash2, Upload } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from '@/hooks/use-toast'
import { CLASS_LABEL } from '@/domain/color/icc'
import { iccService, type IccProfile } from '@/services/iccService'
import type { ColorSettings } from '@/types'

const INTENTS: { id: NonNullable<ColorSettings['intent']>; label: string }[] = [
  { id: 'relative', label: 'Colorimétrica relativa' },
  { id: 'perceptual', label: 'Perceptual' },
  { id: 'saturation', label: 'Saturação' },
  { id: 'absolute', label: 'Colorimétrica absoluta' },
]

const WORKFLOWS: { id: NonNullable<ColorSettings['workflow']>; label: string; hint: string }[] = [
  { id: 'analyze', label: 'Só analisar', hint: 'Nenhuma cor é alterada; o sistema mede e avisa.' },
  { id: 'preserve', label: 'Preservar origem (o RIP converte)', hint: 'As cores e perfis da arte seguem como estão para o RIP.' },
  { id: 'convert', label: 'Preparar para o destino', hint: 'O sistema converte numa cópia, quando o operador pedir (próxima etapa).' },
]

/**
 * Gestão de cor do perfil de produção: biblioteca de perfis ICC da empresa, perfil de
 * destino, perfil para RGB sem perfil, intenção, compensação do ponto preto, tolerância
 * de análise e o fluxo (analisar / preservar / converter).
 */
export function ColorProfileFields({ value, onChange }: { value: ColorSettings; onChange: (v: ColorSettings) => void }) {
  const [library, setLibrary] = useState<IccProfile[] | null>(null)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const set = (patch: Partial<ColorSettings>) => onChange({ ...value, ...patch })
  const lbl = 'text-xs font-medium text-foreground'
  const field = 'mt-1 h-8 text-sm'

  const load = () =>
    iccService
      .list()
      .then((rows) => {
        setLibrary(rows)
        setError('')
      })
      .catch((err: Error) => {
        setLibrary([])
        setError(/icc_profiles/.test(err.message) ? 'A biblioteca ainda não foi criada no banco (migration 0016).' : err.message)
      })
  useEffect(() => {
    load()
  }, [])

  const upload = async (file: File | undefined) => {
    if (!file) return
    setUploading(true)
    try {
      const profile = await iccService.upload(file)
      toast({ title: `Perfil "${profile.name}" na biblioteca`, description: `${profile.color_space} · ${CLASS_LABEL[profile.profile_class] ?? profile.profile_class}` })
      await load()
    } catch (err) {
      toast({ title: 'Perfil não aceito', description: (err as Error).message, variant: 'destructive' })
    }
    setUploading(false)
  }

  const outputs = (library ?? []).filter((p) => ['CMYK', 'RGB', 'GRAY'].includes(p.color_space) && p.profile_class !== 'link')
  const rgbSources = (library ?? []).filter((p) => p.color_space === 'RGB')
  const pick = (list: IccProfile[], id: string | undefined, onPick: (id: string | undefined) => void, placeholder: string) => (
    <Select value={id ?? 'none'} onValueChange={(v) => onPick(v === 'none' ? undefined : v)}>
      <SelectTrigger className={field}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none" className="text-xs">
          {placeholder}
        </SelectItem>
        {list.map((p) => (
          <SelectItem key={p.id} value={p.id} className="text-xs">
            {p.name} · {p.color_space}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Label className={lbl}>Fluxo de cor</Label>
          <Select value={value.workflow ?? 'analyze'} onValueChange={(v) => set({ workflow: v as ColorSettings['workflow'] })}>
            <SelectTrigger className={field}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WORKFLOWS.map((w) => (
                <SelectItem key={w.id} value={w.id} className="text-xs">
                  {w.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-0.5 text-[10px] text-muted-foreground">{WORKFLOWS.find((w) => w.id === (value.workflow ?? 'analyze'))?.hint}</p>
        </div>
        <div>
          <Label className={lbl}>Perfil de destino (condição de impressão)</Label>
          {pick(outputs, value.outputIccId, (id) => set({ outputIccId: id }), 'sem perfil (gamut não é analisado)')}
        </div>
        <div>
          <Label className={lbl}>RGB sem perfil é tratado como</Label>
          {pick(rgbSources, value.rgbSourceIccId, (id) => set({ rgbSourceIccId: id }), 'sRGB (premissa informada)')}
        </div>
        <div>
          <Label className={lbl}>Intenção de renderização</Label>
          <Select value={value.intent ?? 'relative'} onValueChange={(v) => set({ intent: v as ColorSettings['intent'] })}>
            <SelectTrigger className={field}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INTENTS.map((i) => (
                <SelectItem key={i.id} value={i.id} className="text-xs">
                  {i.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <label className="col-span-2 flex items-center gap-2 text-xs">
          <Switch checked={value.blackPointCompensation ?? true} onCheckedChange={(v) => set({ blackPointCompensation: v })} />
          Compensação do ponto preto
        </label>
      </div>

      <div className="space-y-2 rounded-md border border-border p-3">
        <div className="flex items-center justify-between">
          <Label className={lbl}>Biblioteca de perfis ICC da empresa</Label>
          <button
            type="button"
            className="flex items-center gap-1 text-xs font-medium text-primary hover:underline disabled:opacity-50"
            disabled={uploading || !!error}
            onClick={() => input.current?.click()}
          >
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            Enviar .icc / .icm
          </button>
          <input ref={input} type="file" accept=".icc,.icm" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
        </div>
        {error && <p className="text-xs text-amber-600 dark:text-amber-400">{error}</p>}
        {library === null ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : library.length === 0 && !error ? (
          <p className="text-[11px] text-muted-foreground">
            Nenhum perfil. Use os perfis do fabricante da impressora/mídia ou os de condições padronizadas (ex.: ECI, ICC
            Profile Registry). O perfil padrão não substitui o perfil medido da sua máquina.
          </p>
        ) : (
          <ul className="divide-y divide-border text-xs">
            {library.map((p) => (
              <li key={p.id} className="flex items-center gap-2 py-1.5">
                <span className="min-w-0 flex-1 truncate text-foreground" title={p.description}>
                  {p.name}
                </span>
                <span className="text-muted-foreground">
                  {p.color_space} · {CLASS_LABEL[p.profile_class] ?? p.profile_class} · v{p.version}
                </span>
                <button
                  type="button"
                  aria-label={`Remover ${p.name}`}
                  className="text-muted-foreground hover:text-destructive"
                  onClick={async () => {
                    await iccService.remove(p).catch((err: Error) => toast({ title: 'Não foi possível remover', description: err.message, variant: 'destructive' }))
                    if (value.outputIccId === p.id) set({ outputIccId: undefined })
                    if (value.rgbSourceIccId === p.id) set({ rgbSourceIccId: undefined })
                    load()
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
