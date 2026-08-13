import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion'
import { createDefaultRules } from '@/services/profileService'
import type { ProductionProfile, TechnicalRule, Severity } from '@/types'

type FormData = Omit<ProductionProfile, 'id' | 'createdAt' | 'updatedAt'>

const FORMATS = ['PDF', 'AI', 'PSD', 'INDD', 'EPS']
const CATEGORIES = [
  'Offset',
  'Digital',
  'Comunicação Visual',
  'Adesivo',
  'Lona',
  'Backlight',
  'Embalagem',
  'Personalizado',
]
const COLOR_MODES = ['CMYK', 'RGB', 'Grayscale', 'CMYK+Pantone']
const BLACK_OPTS = ['Standard', 'Rich Black', 'Registration Black']
const SEV_OPTS = [
  { v: 'critical', l: 'Crítico' },
  { v: 'warning', l: 'Atenção' },
  { v: 'info', l: 'Informativo' },
]

function defaultForm(): FormData {
  return {
    name: '',
    description: '',
    status: 'active',
    category: 'Offset',
    allowedFormats: ['PDF', 'AI', 'EPS'],
    colorMode: 'CMYK',
    iccProfile: '',
    minResolution: 300,
    blackConfig: 'Standard',
    inkCoverageLimit: 320,
    minBleed: 3,
    safetyMargin: 3,
    scale: '1:1',
    cropMarks: true,
    cutLayerRequired: false,
    cutLayerName: '',
    cutLayerColor: '',
    specialFinishes: '',
    rules: createDefaultRules(),
    isDefault: false,
  }
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialData?: ProductionProfile | null
  onSave: (data: FormData) => void
}

export function ProfileFormDialog({ open, onOpenChange, initialData, onSave }: Props) {
  const [form, setForm] = useState<FormData>(defaultForm())
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      setError('')
      setForm(
        initialData
          ? { ...initialData, rules: initialData.rules.map((r) => ({ ...r })) }
          : defaultForm(),
      )
    }
  }, [open, initialData])

  const update = <K extends keyof FormData>(key: K, value: FormData[K]) =>
    setForm((p) => ({ ...p, [key]: value }))
  const updateRule = (i: number, u: Partial<TechnicalRule>) =>
    setForm((p) => ({ ...p, rules: p.rules.map((r, j) => (j === i ? { ...r, ...u } : r)) }))
  const toggleFormat = (f: string, c: boolean) =>
    setForm((p) => ({
      ...p,
      allowedFormats: c ? [...p.allowedFormats, f] : p.allowedFormats.filter((x) => x !== f),
    }))
  const handleSave = () => {
    if (!form.name.trim()) {
      setError('Nome é obrigatório')
      return
    }
    onSave(form)
    onOpenChange(false)
  }

  const lbl = 'text-xs font-medium text-slate-700'
  const fieldCls = 'mt-1 h-8 text-sm'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm">
            {initialData ? 'Editar perfil' : 'Criar perfil'}
          </DialogTitle>
        </DialogHeader>
        <Accordion type="multiple" defaultValue={['general']}>
          <AccordionItem value="general">
            <AccordionTrigger className="text-sm font-semibold">
              Informações Gerais
            </AccordionTrigger>
            <AccordionContent className="space-y-3 pt-1">
              <div>
                <Label className={lbl}>Nome *</Label>
                <Input
                  value={form.name}
                  onChange={(e) => update('name', e.target.value)}
                  className={fieldCls}
                  placeholder="Ex: Offset padrão"
                />
                {error && <p className="text-[10px] text-red-500 mt-0.5">{error}</p>}
              </div>
              <div>
                <Label className={lbl}>Descrição</Label>
                <Textarea
                  value={form.description}
                  onChange={(e) => update('description', e.target.value)}
                  className="mt-1 text-sm"
                  rows={2}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className={lbl}>Status</Label>
                  <Select
                    value={form.status}
                    onValueChange={(v) => update('status', v as 'active' | 'inactive')}
                  >
                    <SelectTrigger className={fieldCls}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active" className="text-xs">
                        Ativo
                      </SelectItem>
                      <SelectItem value="inactive" className="text-xs">
                        Inativo
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className={lbl}>Categoria</Label>
                  <Select value={form.category} onValueChange={(v) => update('category', v)}>
                    <SelectTrigger className={fieldCls}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c} className="text-xs">
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label className={lbl}>Formatos permitidos</Label>
                <div className="flex flex-wrap gap-3 mt-1">
                  {FORMATS.map((f) => (
                    <label key={f} className="flex items-center gap-1.5 text-xs cursor-pointer">
                      <Checkbox
                        checked={form.allowedFormats.includes(f)}
                        onCheckedChange={(v) => toggleFormat(f, !!v)}
                      />
                      {f}
                    </label>
                  ))}
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="color">
            <AccordionTrigger className="text-sm font-semibold">Cor e Imagem</AccordionTrigger>
            <AccordionContent className="space-y-3 pt-1">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className={lbl}>Modo de cor</Label>
                  <Select value={form.colorMode} onValueChange={(v) => update('colorMode', v)}>
                    <SelectTrigger className={fieldCls}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {COLOR_MODES.map((c) => (
                        <SelectItem key={c} value={c} className="text-xs">
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className={lbl}>Perfil ICC</Label>
                  <Input
                    value={form.iccProfile}
                    onChange={(e) => update('iccProfile', e.target.value)}
                    className={fieldCls}
                    placeholder="Ex: ISO Coated v2"
                  />
                </div>
                <div>
                  <Label className={lbl}>Resolução mínima (DPI)</Label>
                  <Input
                    type="number"
                    value={form.minResolution}
                    onChange={(e) => update('minResolution', Number(e.target.value))}
                    className={fieldCls}
                  />
                </div>
                <div>
                  <Label className={lbl}>Configuração de preto</Label>
                  <Select value={form.blackConfig} onValueChange={(v) => update('blackConfig', v)}>
                    <SelectTrigger className={fieldCls}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {BLACK_OPTS.map((b) => (
                        <SelectItem key={b} value={b} className="text-xs">
                          {b}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className={lbl}>Limite tinta (%)</Label>
                  <Input
                    type="number"
                    value={form.inkCoverageLimit}
                    onChange={(e) => update('inkCoverageLimit', Number(e.target.value))}
                    className={fieldCls}
                  />
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="format">
            <AccordionTrigger className="text-sm font-semibold">
              Formato e Acabamento
            </AccordionTrigger>
            <AccordionContent className="space-y-3 pt-1">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className={lbl}>Sangria mínima (mm)</Label>
                  <Input
                    type="number"
                    value={form.minBleed}
                    onChange={(e) => update('minBleed', Number(e.target.value))}
                    className={fieldCls}
                  />
                </div>
                <div>
                  <Label className={lbl}>Margem de segurança (mm)</Label>
                  <Input
                    type="number"
                    value={form.safetyMargin}
                    onChange={(e) => update('safetyMargin', Number(e.target.value))}
                    className={fieldCls}
                  />
                </div>
                <div>
                  <Label className={lbl}>Escala</Label>
                  <Input
                    value={form.scale}
                    onChange={(e) => update('scale', e.target.value)}
                    className={fieldCls}
                    placeholder="1:1"
                  />
                </div>
                <div>
                  <Label className={lbl}>Acabamentos especiais</Label>
                  <Input
                    value={form.specialFinishes}
                    onChange={(e) => update('specialFinishes', e.target.value)}
                    className={fieldCls}
                    placeholder="Ex: Verniz UV"
                  />
                </div>
              </div>
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 text-xs">
                  <Switch
                    checked={form.cropMarks}
                    onCheckedChange={(v) => update('cropMarks', v)}
                  />{' '}
                  Marcas de corte
                </label>
                <label className="flex items-center gap-2 text-xs">
                  <Switch
                    checked={form.cutLayerRequired}
                    onCheckedChange={(v) => update('cutLayerRequired', v)}
                  />{' '}
                  Layer de corte obrigatório
                </label>
              </div>
              {form.cutLayerRequired && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className={lbl}>Nome do layer de corte</Label>
                    <Input
                      value={form.cutLayerName}
                      onChange={(e) => update('cutLayerName', e.target.value)}
                      className={fieldCls}
                      placeholder="Ex: Corte"
                    />
                  </div>
                  <div>
                    <Label className={lbl}>Cor do layer de corte</Label>
                    <Input
                      value={form.cutLayerColor}
                      onChange={(e) => update('cutLayerColor', e.target.value)}
                      className={fieldCls}
                      placeholder="Ex: Magenta"
                    />
                  </div>
                </div>
              )}
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="rules">
            <AccordionTrigger className="text-sm font-semibold">Regras Técnicas</AccordionTrigger>
            <AccordionContent className="pt-1">
              {form.rules.map((rule, i) => (
                <div
                  key={rule.key}
                  className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0"
                >
                  <span className="text-xs text-slate-700">{rule.label}</span>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={rule.enabled}
                      onCheckedChange={(v) => updateRule(i, { enabled: v })}
                    />
                    <Select
                      value={rule.severity}
                      onValueChange={(v) => updateRule(i, { severity: v as Severity })}
                    >
                      <SelectTrigger className="h-7 w-[110px] text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SEV_OPTS.map((o) => (
                          <SelectItem key={o.v} value={o.v} className="text-xs">
                            {o.l}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ))}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="text-xs">
            Cancelar
          </Button>
          <Button onClick={handleSave} className="bg-blue-600 hover:bg-blue-700 text-white text-xs">
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
