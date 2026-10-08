import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { moveLine, removeLine, setGap, type GapSetting, type SeamGeometry, type TilingProjectModel } from '@/domain/tiling'

const MODES: Record<'vertical' | 'horizontal', Record<GapSetting['mode'], string>> = {
  vertical: {
    centered: 'Metade de cada painel',
    before: 'Sai do painel da esquerda',
    after: 'Sai do painel da direita',
  },
  horizontal: {
    centered: 'Metade de cada painel',
    before: 'Sai do painel de baixo',
    after: 'Sai do painel de cima',
  },
}

const parse = (value: string, fallback: number) => {
  const n = Number(value.replace(',', '.'))
  return value.trim() === '' || !Number.isFinite(n) ? fallback : n
}

/** Uma linha de divisão: posição e fresta (faixa da arte que não é impressa). */
export function SeamInspector({
  project,
  seam,
  onChange,
  onRemoved,
}: {
  project: TilingProjectModel
  seam: SeamGeometry
  onChange: (next: TilingProjectModel) => void
  onRemoved: () => void
}) {
  const gap = seam.gap
  return (
    <div className="space-y-2 rounded-lg border border-border bg-card p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium text-foreground">
          Linha {seam.orientation === 'vertical' ? 'vertical' : 'horizontal'} em {Math.round(seam.position)} mm
        </p>
        <Button
          size="sm"
          variant="ghost"
          title="Apaga a linha em toda a grade: as colunas/linhas vizinhas viram uma"
          onClick={() => {
            onChange(removeLine(project, seam.id))
            onRemoved()
          }}
        >
          <Trash2 className="h-4 w-4" />
          Apagar linha
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Posição (mm)</Label>
          <Input
            className="h-8"
            inputMode="decimal"
            value={Math.round(seam.position * 10) / 10}
            onChange={(e) => onChange(moveLine(project, seam.id, parse(e.target.value, seam.position)))}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Fresta (mm)</Label>
          <Input
            className="h-8"
            inputMode="decimal"
            placeholder="0 = sem fresta"
            value={gap?.width ?? ''}
            onChange={(e) =>
              onChange(setGap(project, seam.id, { width: Math.max(0, parse(e.target.value, 0)), mode: gap?.mode ?? 'centered' }))
            }
          />
        </div>
      </div>
      {gap && (
        <Select value={gap.mode} onValueChange={(mode) => onChange(setGap(project, seam.id, { ...gap, mode: mode as GapSetting['mode'] }))}>
          <SelectTrigger className="h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(['centered', 'before', 'after'] as const).map((mode) => (
              <SelectItem key={mode} value={mode}>
                {MODES[seam.orientation][mode]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <p className="text-xs text-muted-foreground">
        A fresta é a faixa da arte que cai no vão (entre portas, estrutura, perfil) e não é impressa. A sobreposição de
        cada lado é ajustada nos painéis.
      </p>
    </div>
  )
}
