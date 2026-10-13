import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { ProfileTechnology, TextileSettings } from '@/types'
import type { DtgTemplate } from '@/domain/dtg/placement'

/**
 * Campos de DTF / DTG. Nenhum valor vem preenchido: são do equipamento, do RIP e do
 * fluxo de cada empresa (manual do fabricante). Vazio = o sistema não confere e avisa.
 */
export function TextileProfileFields({
  technology,
  value,
  onChange,
}: {
  technology: Exclude<ProfileTechnology, 'grafica'>
  value: TextileSettings
  onChange: (value: TextileSettings) => void
}) {
  const set = (patch: Partial<TextileSettings>) => onChange({ ...value, ...patch })
  const lbl = 'text-xs font-medium text-foreground'
  const field = 'mt-1 h-8 text-sm'
  const dtf = technology === 'dtf'

  const num = (key: keyof TextileSettings, label: string, hint?: string) => (
    <div>
      <Label className={lbl}>{label}</Label>
      <Input
        type="number"
        min={0}
        step="any"
        className={field}
        value={(value[key] as number | undefined) ?? ''}
        placeholder="cadastrar"
        onChange={(e) =>
          set({ [key]: e.target.value === '' ? undefined : Number(e.target.value) })
        }
      />
      {hint && <p className="mt-0.5 text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  )
  const text = (key: keyof TextileSettings, label: string, placeholder = '') => (
    <div>
      <Label className={lbl}>{label}</Label>
      <Input
        className={field}
        value={(value[key] as string | undefined) ?? ''}
        placeholder={placeholder}
        onChange={(e) => set({ [key]: e.target.value || undefined })}
      />
    </div>
  )

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted-foreground">
        Preencha com os dados do seu equipamento e do fabricante. Campo vazio não é suposto:
        a verificação correspondente não roda e o relatório pede a confirmação.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {text('equipment', 'Equipamento', 'modelo da impressora')}
        {text('rip', 'RIP / software de saída')}
        {text('media', dtf ? 'Filme' : 'Substrato / peça')}
        {text('ink', 'Tinta')}
        {text('outputFormat', 'Formato de saída', 'ex.: PDF, TIFF')}
        {!dtf && text('pretreatment', 'Pré-tratamento')}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {num('printWidthMm', dtf ? 'Largura útil do filme (mm)' : 'Largura da área imprimível (mm)')}
        {dtf
          ? num('gapMm', 'Espaçamento entre artes (mm)')
          : num('printHeightMm', 'Altura da área imprimível (mm)')}
        {dtf && num('marginMm', 'Margem lateral (mm)')}
        {num('minLineMm', 'Traço mínimo (mm)', 'abaixo disso o detalhe é apontado')}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className={lbl}>Base branca</Label>
          <Select
            value={value.whiteMode ?? ''}
            onValueChange={(v) => set({ whiteMode: v as TextileSettings['whiteMode'] })}
          >
            <SelectTrigger className={field}>
              <SelectValue placeholder="definir" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="generate" className="text-xs">
                O sistema gera (cor especial)
              </SelectItem>
              <SelectItem value="from_file" className="text-xs">
                Vem na arte
              </SelectItem>
              <SelectItem value="rip" className="text-xs">
                O RIP gera (só pré-visualizar)
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        {text('whiteSpotName', 'Nome da cor do branco', 'como o RIP espera')}
        {num('alphaThreshold', 'Opacidade mínima para branco (%)')}
        {num('whiteDensity', 'Densidade do branco (%)')}
        {num('chokeMm', 'Choke do branco (mm)', 'recuo do branco sob a cor')}
        {num('spreadMm', 'Spread (mm)')}
      </div>
      {!dtf && <TemplatesEditor value={value.templates ?? []} onChange={(templates) => set({ templates })} />}
      <label className="flex items-center gap-2 text-xs">
        <Switch checked={!!value.mirror} onCheckedChange={(v) => set({ mirror: v })} />
        Espelhar na saída (somente se o fluxo deste equipamento exigir)
      </label>
    </div>
  )
}

/** Gabaritos de peça do DTG: cada peça/tamanho com a sua área imprimível em mm. */
function TemplatesEditor({
  value,
  onChange,
}: {
  value: DtgTemplate[]
  onChange: (value: DtgTemplate[]) => void
}) {
  const update = (index: number, patch: Partial<DtgTemplate>) =>
    onChange(value.map((t, i) => (i === index ? { ...t, ...patch } : t)))
  const num = (v: string) => (v === '' ? 0 : Number(v))
  return (
    <div className="space-y-2">
      <Label className="text-xs font-medium text-foreground">Gabaritos de peça</Label>
      {value.length === 0 && (
        <p className="text-[11px] text-muted-foreground">
          Nenhum gabarito. Cadastre cada peça e tamanho com a área imprimível do seu berço/platen.
        </p>
      )}
      {value.map((t, i) => (
        <div key={i} className="grid grid-cols-[1fr_70px_80px_80px_auto] items-center gap-2">
          <Input className="h-8 text-sm" placeholder="Peça (ex.: camiseta frente)" value={t.name} onChange={(e) => update(i, { name: e.target.value })} />
          <Input className="h-8 text-sm" placeholder="Tam." value={t.size ?? ''} onChange={(e) => update(i, { size: e.target.value || undefined })} />
          <Input className="h-8 text-sm" type="number" min={0} placeholder="L (mm)" value={t.areaWidthMm || ''} onChange={(e) => update(i, { areaWidthMm: num(e.target.value) })} />
          <Input className="h-8 text-sm" type="number" min={0} placeholder="A (mm)" value={t.areaHeightMm || ''} onChange={(e) => update(i, { areaHeightMm: num(e.target.value) })} />
          <button type="button" className="text-xs text-muted-foreground hover:text-destructive" onClick={() => onChange(value.filter((_, j) => j !== i))}>
            remover
          </button>
        </div>
      ))}
      <button
        type="button"
        className="text-xs font-medium text-primary hover:underline"
        onClick={() => onChange([...value, { name: '', areaWidthMm: 0, areaHeightMm: 0 }])}
      >
        + gabarito
      </button>
    </div>
  )
}
