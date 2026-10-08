import { Eye, EyeOff, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { EdgesInput } from '@/components/tiling/EdgesInput'
import {
  EDGES,
  applyToGrid,
  resetTileEdges,
  setEnabled,
  setTileEdges,
  setTileInfo,
  type Edges,
  type TileGeometry,
  type TilingProjectModel,
} from '@/domain/tiling'

const mm = (v: number) => Math.round(v)
const size = (r: { w: number; h: number }) => `${mm(r.w)} × ${mm(r.h)} mm`

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
}: {
  project: TilingProjectModel
  tiles: TileGeometry[]
  onChange: (next: TilingProjectModel) => void
}) {
  const keys = tiles.map((t) => t.key)
  const single = tiles.length === 1 ? tiles[0] : null
  const allOff = tiles.every((t) => !t.enabled)
  const effective = (field: 'overlap' | 'white'): Edges =>
    single ? single[field] : { ...project.rules[field], ...common(project, keys, field) }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium text-foreground">
          {single
            ? `Painel ${single.id}${single.enabled ? ` · nº ${String(single.number).padStart(2, '0')}` : ' · não imprime'}`
            : `${tiles.length} painéis: ${tiles.map((t) => t.id).join(', ')}`}
        </p>
        <Button size="sm" variant="outline" onClick={() => onChange(setEnabled(project, keys, allOff))}>
          {allOff ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          {allOff ? 'Imprimir' : 'Não imprimir'}
        </Button>
      </div>

      {single && (
        <div className="grid grid-cols-[72px_1fr] items-center gap-2">
          <Label className="text-xs text-muted-foreground">Número</Label>
          <Input
            className="h-8"
            inputMode="numeric"
            value={project.tiles[single.key]?.number ?? ''}
            placeholder={String(single.number)}
            onChange={(e) => {
              const n = Math.round(Number(e.target.value))
              onChange(setTileInfo(project, single.key, { number: e.target.value.trim() && n > 0 ? n : undefined }))
            }}
          />
          <Label className="text-xs text-muted-foreground">Arquivo</Label>
          <Input
            className="h-8"
            value={project.tiles[single.key]?.name ?? ''}
            placeholder={single.name}
            onChange={(e) => onChange(setTileInfo(project, single.key, { name: e.target.value || undefined }))}
          />
          <Label className="text-xs text-muted-foreground">Região</Label>
          <Input
            className="h-8"
            value={project.tiles[single.key]?.zone ?? ''}
            placeholder="ex.: Lateral esquerda, porta"
            onChange={(e) => onChange(setTileInfo(project, single.key, { zone: e.target.value || undefined }))}
          />
        </div>
      )}

      {(['overlap', 'white'] as const).map((field) => (
        <div key={field} className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs">
              {field === 'overlap' ? 'Sobreposição (mm)' : 'Área branca de colagem (mm)'}
            </Label>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                title="Usar o padrão do projeto"
                onClick={() => onChange(resetTileEdges(project, keys, field))}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Padrão
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                title="Estes valores viram o padrão de todos os painéis"
                onClick={() => onChange(applyToGrid(project, field, effective(field)))}
              >
                Aplicar a toda a grade
              </Button>
            </div>
          </div>
          <EdgesInput
            value={common(project, keys, field)}
            placeholder={project.rules[field]}
            onChange={(edge, value) => onChange(setTileEdges(project, keys, field, { [edge]: value }))}
          />
          {field === 'overlap' && single && (
            <p className="text-xs text-muted-foreground">
              Valendo: {EDGES.map((e) => `${{ top: 'C', right: 'D', bottom: 'B', left: 'E' }[e]} ${mm(single.overlap[e])}`).join(' · ')}
              {' '}(sem painel vizinho, a borda fica sem sobreposição)
            </p>
          )}
        </div>
      ))}

      {single && single.enabled && (
        <p className="text-xs text-muted-foreground">
          Cobre {size(single.logical)} · impresso {size(single.print)}
          {(single.physical.w !== single.print.w || single.physical.h !== single.print.h) &&
            ` · painel com área branca ${size(single.physical)}`}
        </p>
      )}
    </div>
  )
}
