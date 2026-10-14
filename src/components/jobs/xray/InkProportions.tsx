import { useState } from 'react'
import type { FileProfile } from '@/lib/xray'
import { cn } from '@/lib/utils'

/** Cor de identificação de cada tinta (a da própria tinta, para o operador reconhecer). */
const SWATCH: Record<string, string> = {
  Cyan: '#00AEEF',
  Magenta: '#EC008C',
  Yellow: '#FFE600',
  Black: '#231F20',
}
const LABEL: Record<string, string> = { Cyan: 'Ciano', Magenta: 'Magenta', Yellow: 'Amarelo', Black: 'Preto' }
const pct = (v: number) => `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: v < 0.1 ? 1 : 0 })}%`

function swatchOf(name: string) {
  if (SWATCH[name]) return { background: SWATCH[name] }
  if (/white|branco/i.test(name)) return { background: '#ffffff' }
  return {
    background: 'repeating-linear-gradient(45deg, #94a3b8 0 3px, #cbd5e1 3px 6px)',
  }
}

/**
 * Proporção de tintas medida na separação do arquivo (como num RIP): quanto cada tinta
 * cobre da página, quanto da página ela toca e a divisão entre as tintas. Vale para
 * qualquer módulo (gráfica, painéis, montagem, DTF, DTG).
 */
export function InkProportions({ profile, compact = false }: { profile: FileProfile; compact?: boolean }) {
  const data = profile.inks
  const [index, setIndex] = useState(0)
  if (!data) return null
  if (!data.pages?.length) {
    return (
      <p className="text-xs text-muted-foreground">
        Proporção de tintas indisponível{data.error ? `: ${data.error}` : ''}. Reanalise depois de atualizar o analisador.
      </p>
    )
  }
  const page = data.pages[Math.min(index, data.pages.length - 1)]
  const used = page.inks.filter((i) => i.coverage > 0.0005)
  const hasRgb = (profile.colors?.rgbOperators ?? 0) > 0 || (profile.images?.items ?? []).some((i) => /RGB/i.test(String(i.colorSpace ?? '')))

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold text-foreground">Proporção de tintas</h4>
        {data.pages.length > 1 && (
          <div className="flex gap-1">
            {data.pages.map((p, i) => (
              <button
                key={p.page}
                type="button"
                onClick={() => setIndex(i)}
                className={cn('rounded px-1.5 text-xs', i === index ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
              >
                pág. {p.page}
              </button>
            ))}
          </div>
        )}
      </div>

      {used.length > 0 && (
        <div className="flex h-3 overflow-hidden rounded-full border border-border" role="img" aria-label="Divisão entre as tintas">
          {used.map((ink) => (
            <span key={ink.name} title={`${LABEL[ink.name] ?? ink.name}: ${pct(ink.share)} da tinta`} style={{ ...swatchOf(ink.name), width: `${ink.share * 100}%` }} />
          ))}
        </div>
      )}

      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-1 font-normal">Tinta</th>
            <th className="py-1 text-right font-normal" title="Quanto da página a tinta pintaria se fosse toda a 100%">
              Cobertura
            </th>
            {!compact && (
              <th className="py-1 text-right font-normal" title="Parte da página que recebe essa tinta">
                Área tocada
              </th>
            )}
            <th className="py-1 text-right font-normal" title="Parte desta tinta no total de tinta da página">
              Do total
            </th>
          </tr>
        </thead>
        <tbody>
          {page.inks.map((ink) => (
            <tr key={ink.name} className={cn('border-t border-border/60', ink.coverage <= 0.0005 && 'text-muted-foreground')}>
              <td className="py-1">
                <span className="flex items-center gap-2">
                  <span className="h-3 w-3 shrink-0 rounded-sm border border-border" style={swatchOf(ink.name)} />
                  {LABEL[ink.name] ?? ink.name}
                  {!ink.process && <span className="text-[10px] text-muted-foreground">especial</span>}
                </span>
              </td>
              <td className="py-1 text-right tabular-nums">{pct(ink.coverage)}</td>
              {!compact && <td className="py-1 text-right tabular-nums">{pct(ink.area)}</td>}
              <td className="py-1 text-right tabular-nums">{pct(ink.share)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="text-xs text-muted-foreground">
        Cobertura máxima de CMYK num ponto: <b className="text-foreground">{page.maxProcessTotal.toLocaleString('pt-BR')}%</b>.
        {' '}Separação a {data.dpi?.toLocaleString('pt-BR')} ppi, com sobreimpressão como no RIP.
        {hasRgb && ' O RGB foi convertido pelo perfil padrão do separador: a proporção vale, os valores exatos dependem do RIP.'}
      </p>
    </div>
  )
}
