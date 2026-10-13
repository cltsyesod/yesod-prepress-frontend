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
  const lbl = 'text-xs font-medium text-slate-700'
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
      {hint && <p className="mt-0.5 text-[10px] text-slate-500">{hint}</p>}
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
      <p className="text-[11px] text-slate-500">
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
      <label className="flex items-center gap-2 text-xs">
        <Switch checked={!!value.mirror} onCheckedChange={(v) => set({ mirror: v })} />
        Espelhar na saída (somente se o fluxo deste equipamento exigir)
      </label>
    </div>
  )
}
