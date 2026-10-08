import { Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EdgesInput } from '@/components/tiling/EdgesInput'
import { Field, NumberField, Readout, Section, TextField, fmtSize } from '@/components/tiling/fields'
import {
  EDGES,
  applyToGrid,
  areaNames,
  resetTileEdges,
  setArea,
  setEnabled,
  setTileEdges,
  setTileInfo,
  type Edges,
  type TileGeometry,
  type TilingProjectModel,
} from '@/domain/tiling'

export const ROTATION_LABEL: Record<number, string> = { 0: 'Em pé', 90: 'Deitado', 180: 'Em pé, 180°', 270: 'Deitado, 180°' }

/** Valor comum de uma borda entre os painéis escolhidos (vazio se forem diferentes). */
function common(project: TilingProjectModel, keys: string[], field: 'overlap' | 'white'): Partial<Edges> {
  const result: Partial<Edges> = {}
  for (const edge of EDGES) {
    const values = keys.map((k) => project.tiles[k]?.[field]?.[edge])
    if (values.every((v) => v !== undefined && v === values[0])) result[edge] = values[0]
  }
  return result
}

/** Ajustes dos painéis escolhidos: um ou vários ao mesmo tempo. */
export function TileInspector({
  project,
  tiles,
  onChange,
  onMoveOrder,
}: {
  project: TilingProjectModel
  tiles: TileGeometry[]
  onChange: (next: TilingProjectModel) => void
  /** Antecipa (-1) ou adia (+1) o painel na ordem de instalação. */
  onMoveOrder?: (key: string, delta: -1 | 1) => void
}) {
  const keys = tiles.map((t) => t.key)
  const single = tiles.length === 1 ? tiles[0] : null
  // Área comum aos painéis escolhidos (undefined se forem de áreas diferentes).
  const sameArea = tiles.every((t) => t.zone === tiles[0].zone) ? tiles[0].zone : undefined
  const allOff = tiles.every((t) => !t.enabled)
  const effective = (field: 'overlap' | 'white'): Edges =>
    single ? single[field] : { ...project.rules[field], ...common(project, keys, field) }
  const custom = (field: 'overlap' | 'white') => Object.keys(common(project, keys, field)).length > 0

  return (
    <>
      <Section
        title={single ? `Painel ${single.id}` : `${tiles.length} painéis`}
        action={
          <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => onChange(setEnabled(project, keys, allOff))}>
            {allOff ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            {allOff ? 'Imprimir' : 'Não imprimir'}
          </Button>
        }
      >
        {!single && <p className="text-xs text-muted-foreground">{tiles.map((t) => t.id).join(', ')}</p>}
        {single && (
          <>
            <Field label="Número" wide>
              <NumberField
                unit=""
                integer
                min={1}
                allowEmpty
                value={project.tiles[single.key]?.number}
                placeholder={single.enabled ? String(single.number) : '—'}
                onCommit={(n) => onChange(setTileInfo(project, single.key, { number: n }))}
              />
            </Field>
            <Field label="Arquivo" wide>
              <TextField
                value={project.tiles[single.key]?.name ?? ''}
                placeholder={single.name}
                onCommit={(name) => onChange(setTileInfo(project, single.key, { name: name || undefined }))}
              />
            </Field>
          </>
        )}
        <Field label="Área" wide>
          <div>
            <TextField
              list="tiling-areas"
              value={sameArea ?? ''}
              placeholder={sameArea === undefined ? 'várias' : 'sem área'}
              onCommit={(area) => onChange(setArea(project, keys, area))}
            />
            <datalist id="tiling-areas">
              {areaNames(project).map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </div>
        </Field>
        {single && single.enabled && onMoveOrder && (
          <Field label="Instalação" wide>
            <div className="flex items-center gap-1">
              <span className="flex-1 text-xs font-medium tabular-nums">{single.install}º</span>
              <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" title="Instalar antes" onClick={() => onMoveOrder(single.key, -1)}>
                Antes
              </Button>
              <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" title="Instalar depois" onClick={() => onMoveOrder(single.key, 1)}>
                Depois
              </Button>
            </div>
          </Field>
        )}
      </Section>

      {single && single.enabled && (
        <Section title="Medidas">
          <Readout label="Cobre da arte" hint="Parte da arte que é deste painel" value={`${fmtSize(single.logical)} mm`} />
          <Readout label="Impresso" hint="Cobre + sobreposições + sangria" value={`${fmtSize(single.print)} mm`} />
          <Readout label="Painel físico" hint="Impresso + área branca de colagem" value={`${fmtSize(single.physical)} mm`} strong />
          <Readout label="Na mídia" value={ROTATION_LABEL[single.rotation]} />
          <Readout
            label="Vizinhos"
            value={
              (['left', 'top', 'right', 'bottom'] as const)
                .filter((e) => single.neighbours[e])
                .map((e) => `${{ left: 'E', top: 'C', right: 'D', bottom: 'B' }[e]} ${single.neighbours[e]}`)
                .join(' · ') || '—'
            }
          />
        </Section>
      )}

      {(['overlap', 'white'] as const).map((field) => (
        <Section
          key={field}
          title={field === 'overlap' ? 'Sobreposição' : 'Área branca'}
          action={
            <div className="flex gap-0.5">
              {custom(field) && (
                <button
                  type="button"
                  className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
                  title="Voltar ao padrão do projeto"
                  onClick={() => onChange(resetTileEdges(project, keys, field))}
                >
                  Padrão
                </button>
              )}
              <button
                type="button"
                className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
                title="Estes valores viram o padrão de todos os painéis"
                onClick={() => onChange(applyToGrid(project, field, effective(field)))}
              >
                Aplicar a todos
              </button>
            </div>
          }
        >
          <EdgesInput
            value={common(project, keys, field)}
            placeholder={project.rules[field]}
            onChange={(edge, value) => onChange(setTileEdges(project, keys, field, { [edge]: value }))}
          />
          <p className="text-[11px] text-muted-foreground">
            {field === 'overlap'
              ? single
                ? `Valendo: ${EDGES.map((e) => `${{ top: 'C', right: 'D', bottom: 'B', left: 'E' }[e]} ${Math.round(single.overlap[e])}`).join(' · ')}. Sem vizinho, a borda fica sem sobreposição.`
                : 'Campo vazio = padrão do projeto.'
              : 'Sem tinta, fora da imagem. Campo vazio = padrão do projeto.'}
          </p>
        </Section>
      ))}
    </>
  )
}
