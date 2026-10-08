import { useState } from 'react'
import { ChevronDown, ChevronUp, RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Section, Segmented, TextField } from '@/components/tiling/fields'
import {
  addArea,
  areaNames,
  moveArea,
  removeArea,
  renameArea,
  resetSequence,
  setArea,
  setNumbering,
  type ProjectGeometry,
  type TilingProjectModel,
} from '@/domain/tiling'
import { cn } from '@/lib/utils'

/** Cores das áreas na prancheta (repetem depois da oitava). */
export const AREA_COLORS = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#dc2626', '#0891b2', '#db2777', '#65a30d']

export const areaColor = (project: TilingProjectModel, name: string) => {
  const i = areaNames(project).indexOf(name)
  return i < 0 ? undefined : AREA_COLORS[i % AREA_COLORS.length]
}

/**
 * Áreas da instalação (nomes livres, em qualquer superfície) e a ordem de instalação dos
 * painéis, área por área.
 */
export function InstallPanel({
  project,
  geometry,
  selected,
  onChange,
  onSelect,
  onMoveOrder,
}: {
  project: TilingProjectModel
  geometry: ProjectGeometry
  /** Chaves dos painéis selecionados na prancheta. */
  selected: string[]
  onChange: (next: TilingProjectModel) => void
  onSelect: (key: string) => void
  onMoveOrder: (key: string, delta: -1 | 1) => void
}) {
  const [newArea, setNewArea] = useState('')
  const names = areaNames(project)
  const byId = new Map(geometry.tiles.map((t) => [t.id, t]))
  const count = (name: string) => geometry.tiles.filter((t) => t.enabled && t.zone === name).length

  const create = () => {
    const name = newArea.trim()
    if (!name) return
    // Com painéis selecionados, a área nova já recebe esses painéis.
    onChange(selected.length ? setArea(project, selected, name) : addArea(project, name))
    setNewArea('')
  }

  return (
    <>
      <Section title="Áreas da instalação">
        <p className="text-[11px] text-muted-foreground">
          Partes da superfície instaladas em sequência (térreo, parede A, vitrine 2…). A ordem da lista é a ordem de
          instalação.
        </p>
        {names.map((name, i) => (
          <div key={name} className="flex items-center gap-1">
            <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: AREA_COLORS[i % AREA_COLORS.length] }} />
            <TextField className="min-w-0 flex-1" value={name} onCommit={(to) => onChange(renameArea(project, name, to))} />
            <span className="w-6 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground" title="Painéis nesta área">
              {count(name)}
            </span>
            <IconButton title="Instalar antes" disabled={i === 0} onClick={() => onChange(moveArea(project, name, -1))}>
              <ChevronUp className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton title="Instalar depois" disabled={i === names.length - 1} onClick={() => onChange(moveArea(project, name, 1))}>
              <ChevronDown className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton title="Apagar a área (os painéis ficam sem área)" onClick={() => onChange(removeArea(project, name))}>
              <Trash2 className="h-3.5 w-3.5" />
            </IconButton>
          </div>
        ))}
        {selected.length > 0 && names.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 rounded border border-dashed border-border px-2 py-1.5 text-[11px]">
            <span className="text-muted-foreground">{selected.length} selecionado(s) para:</span>
            {names.map((name, i) => (
              <button
                key={name}
                type="button"
                className="rounded border border-border px-1.5 py-0.5 hover:bg-accent"
                style={{ borderLeft: `3px solid ${AREA_COLORS[i % AREA_COLORS.length]}` }}
                onClick={() => onChange(setArea(project, selected, name))}
              >
                {name}
              </button>
            ))}
            <button type="button" className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-accent" onClick={() => onChange(setArea(project, selected, undefined))}>
              sem área
            </button>
          </div>
        )}
        <div className="flex gap-1">
          <Input
            className="h-7 text-xs"
            placeholder={selected.length ? `Nova área com os ${selected.length} selecionados` : 'Nova área'}
            value={newArea}
            onChange={(e) => setNewArea(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
          />
          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!newArea.trim()} onClick={create}>
            Criar
          </Button>
        </div>
      </Section>

      <Section
        title="Ordem de instalação"
        action={
          project.sequence ? (
            <button
              type="button"
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
              title="Voltar à ordem sugerida pelas sobreposições"
              onClick={() => onChange(resetSequence(project))}
            >
              <RotateCcw className="h-3 w-3" />
              Sugerida
            </button>
          ) : undefined
        }
      >
        <p className="text-[11px] text-muted-foreground">
          {project.sequence
            ? 'Definida à mão.'
            : 'Sugerida: o painel que fica por baixo na sobreposição é instalado primeiro.'}
        </p>
        <div className="space-y-1">
          <p className="text-xs text-foreground/80">Numeração dos painéis</p>
          <Segmented<'reading' | 'install'>
            value={project.numbering ?? 'reading'}
            onChange={(numbering) => onChange(setNumbering(project, numbering))}
            options={[
              { value: 'reading', label: 'Pela grade', hint: 'De cima para baixo, da esquerda para a direita' },
              { value: 'install', label: 'Pela instalação', hint: 'O painel 01 é o primeiro a instalar' },
            ]}
          />
        </div>
        <div className="space-y-2 pt-1">
          {geometry.areas.map((area) => (
            <div key={area.name}>
              <p className="mb-0.5 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                {area.name ? (
                  <span className="h-2 w-2 rounded-sm" style={{ background: areaColor(project, area.name) }} />
                ) : null}
                {area.name || 'Sem área'}
              </p>
              {area.tiles.map((id, i) => {
                const t = byId.get(id)
                if (!t) return null
                return (
                  <div
                    key={id}
                    className={cn(
                      'flex items-center gap-1 rounded px-1 text-xs',
                      selected.includes(t.key) ? 'bg-primary/10' : 'hover:bg-accent/60',
                    )}
                  >
                    <button type="button" className="flex flex-1 items-center gap-2 py-0.5 text-left" onClick={() => onSelect(t.key)}>
                      <span className="w-7 font-semibold tabular-nums text-orange-700 dark:text-orange-400">{t.install}º</span>
                      <span className="w-10 tabular-nums">{t.id}</span>
                      <span className="text-muted-foreground">nº {String(t.number).padStart(2, '0')}</span>
                    </button>
                    <IconButton title="Instalar antes" disabled={i === 0} onClick={() => onMoveOrder(t.key, -1)}>
                      <ChevronUp className="h-3.5 w-3.5" />
                    </IconButton>
                    <IconButton title="Instalar depois" disabled={i === area.tiles.length - 1} onClick={() => onMoveOrder(t.key, 1)}>
                      <ChevronDown className="h-3.5 w-3.5" />
                    </IconButton>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </Section>
    </>
  )
}

function IconButton({
  title,
  disabled,
  onClick,
  children,
}: {
  title: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
    >
      {children}
    </button>
  )
}
