import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, NumberField, Readout, Section, Segmented } from '@/components/tiling/fields'
import { moveLine, removeLine, setGap, type GapSetting, type SeamGeometry, type TilingProjectModel } from '@/domain/tiling'

const MODES: Record<'vertical' | 'horizontal', { value: GapSetting['mode']; label: string; hint: string }[]> = {
  vertical: [
    { value: 'before', label: 'Esquerda', hint: 'A fresta sai toda do painel da esquerda' },
    { value: 'centered', label: 'Metade', hint: 'Metade da fresta sai de cada painel' },
    { value: 'after', label: 'Direita', hint: 'A fresta sai toda do painel da direita' },
  ],
  horizontal: [
    { value: 'after', label: 'De cima', hint: 'A fresta sai toda do painel de cima' },
    { value: 'centered', label: 'Metade', hint: 'Metade da fresta sai de cada painel' },
    { value: 'before', label: 'De baixo', hint: 'A fresta sai toda do painel de baixo' },
  ],
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
  const vertical = seam.orientation === 'vertical'
  return (
    <>
      <Section
        title={`Linha ${vertical ? 'vertical' : 'horizontal'}`}
        action={
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs text-destructive hover:text-destructive"
            title="Apaga a linha em toda a grade: as colunas/linhas vizinhas viram uma"
            onClick={() => {
              onChange(removeLine(project, seam.id))
              onRemoved()
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Apagar
          </Button>
        }
      >
        <Field label={vertical ? 'Posição (da esquerda)' : 'Posição (de baixo)'}>
          <NumberField value={seam.position} onCommit={(v) => v !== undefined && onChange(moveLine(project, seam.id, v))} />
        </Field>
        <Readout label="Comprimento" value={`${Math.round(seam.end - seam.start)} mm`} />
      </Section>
      <Section title="Fresta">
        <Field label="Largura" hint="Faixa da arte que cai no vão (porta, estrutura, perfil) e não é impressa. 0 = sem fresta.">
          <NumberField
            value={gap?.width ?? 0}
            onCommit={(v) => onChange(setGap(project, seam.id, { width: v ?? 0, mode: gap?.mode ?? 'centered' }))}
          />
        </Field>
        {gap && (
          <div className="space-y-1">
            <p className="text-xs text-foreground/80">Sai de qual painel</p>
            <Segmented value={gap.mode} options={MODES[seam.orientation]} onChange={(mode) => onChange(setGap(project, seam.id, { ...gap, mode }))} />
          </div>
        )}
      </Section>
    </>
  )
}
