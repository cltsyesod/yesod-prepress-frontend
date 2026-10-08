import { useEffect, useState, type ReactNode } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/** Números como o operador lê: vírgula decimal e ponto de milhar. */
export const fmt = (value: number, digits = 1) =>
  value.toLocaleString('pt-BR', { maximumFractionDigits: digits, minimumFractionDigits: 0 })
export const fmtMm = (value: number) => `${fmt(value)} mm`
export const fmtSize = (r: { w: number; h: number }) => `${fmt(r.w, 0)} × ${fmt(r.h, 0)}`
export const fmtM = (mm: number) => `${fmt(mm / 1000, 2)} m`
export const fmtMoney = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const parse = (text: string): number | null => {
  // "1.234,5" e "1234,5" = 1234,5; sem vírgula, o ponto é decimal ("12.5").
  const raw = text.trim()
  const clean = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw
  if (clean === '') return null
  const n = Number(clean)
  return Number.isFinite(n) ? n : Number.NaN
}

/** Grupo de propriedades com título, como num painel de propriedades. */
export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-b border-border px-3 py-3 last:border-b-0">
      <div className="mb-2 flex min-h-5 items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
        {action}
      </div>
      <div className="space-y-1.5">{children}</div>
    </section>
  )
}

/** Linha "rótulo | valor". `hint` aparece ao passar o mouse no rótulo. */
export function Field({ label, hint, children, wide }: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={cn('grid items-center gap-2', wide ? 'grid-cols-[96px_1fr]' : 'grid-cols-[1fr_118px]')}>
      <label className={cn('truncate text-xs text-foreground/80', hint && 'cursor-help')} title={hint}>
        {label}
      </label>
      {children}
    </div>
  )
}

/** Valor calculado (não editável). */
export function Readout({ label, value, hint, strong, tone }: { label: string; value: ReactNode; hint?: string; strong?: boolean; tone?: 'error' | 'warning' | 'ok' }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-xs">
      <span className={cn('text-muted-foreground', hint && 'cursor-help')} title={hint}>
        {label}
      </span>
      <span
        className={cn(
          'text-right tabular-nums text-foreground',
          strong && 'font-semibold',
          tone === 'error' && 'text-destructive',
          tone === 'warning' && 'text-amber-700 dark:text-amber-400',
          tone === 'ok' && 'text-emerald-700 dark:text-emerald-400',
        )}
      >
        {value}
      </span>
    </div>
  )
}

/**
 * Campo numérico que só aplica ao sair do campo ou com Enter (Esc desfaz), para não
 * recalcular a grade a cada tecla. Vazio = `undefined` quando `allowEmpty`.
 */
export function NumberField({
  value,
  onCommit,
  unit = 'mm',
  placeholder,
  allowEmpty,
  min = 0,
  integer,
  disabled,
  className,
  title,
}: {
  value: number | undefined
  onCommit: (value: number | undefined) => void
  unit?: string
  placeholder?: string
  allowEmpty?: boolean
  min?: number
  integer?: boolean
  disabled?: boolean
  className?: string
  title?: string
}) {
  const show = (v: number | undefined) => (v === undefined || Number.isNaN(v) ? '' : fmt(v, integer ? 0 : 2).replace(/\./g, ''))
  const [draft, setDraft] = useState(show(value))
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    if (!editing) setDraft(show(value))
  }, [value, editing]) // eslint-disable-line react-hooks/exhaustive-deps

  const commit = () => {
    setEditing(false)
    const n = parse(draft)
    if (n === null) {
      if (allowEmpty && value !== undefined) onCommit(undefined)
      else setDraft(show(value))
      return
    }
    if (Number.isNaN(n)) {
      setDraft(show(value))
      return
    }
    const next = Math.max(min, integer ? Math.round(n) : n)
    if (next !== value) onCommit(next)
    else setDraft(show(value))
  }

  return (
    <div className={cn('relative', className)}>
      <Input
        className={cn('h-7 px-2 text-right text-xs tabular-nums', unit && 'pr-8')}
        inputMode="decimal"
        value={draft}
        placeholder={placeholder}
        disabled={disabled}
        title={title}
        onFocus={(e) => {
          setEditing(true)
          e.target.select()
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') {
            setDraft(show(value))
            setEditing(false)
            ;(e.target as HTMLInputElement).blur()
          }
        }}
      />
      {unit && (
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
          {unit}
        </span>
      )}
    </div>
  )
}

/** Campo de texto que aplica ao sair do campo ou com Enter. */
export function TextField({
  value,
  onCommit,
  placeholder,
  className,
  list,
}: {
  value: string
  onCommit: (value: string) => void
  placeholder?: string
  className?: string
  /** Id de um <datalist> com sugestões. */
  list?: string
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <Input
      list={list}
      className={cn('h-7 px-2 text-xs', className)}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  )
}

/** Escolha entre poucas opções, sempre visíveis. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string; hint?: string }[]
  onChange: (value: T) => void
}) {
  return (
    <div className="flex w-full rounded-md border border-border bg-muted/50 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.hint}
          onClick={() => onChange(o.value)}
          className={cn(
            'flex-1 rounded px-2 py-1 text-xs transition-colors',
            value === o.value ? 'bg-background font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
