import type { FileProfile } from '@/lib/xray'
import { cn } from '@/lib/utils'

const INTENT: Record<string, string> = {
  relative: 'colorimétrica relativa',
  perceptual: 'perceptual',
  saturation: 'saturação',
  absolute: 'colorimétrica absoluta',
}
const pct = (v: number) => `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
const de = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })

/**
 * Gestão de cor: o que a condição de impressão (perfil de destino) não alcança, medido
 * com o Little CMS. Nada é convertido; é a leitura para decidir com o cliente.
 */
export function GamutPanel({ profile }: { profile: FileProfile }) {
  const g = profile.gamut
  if (!g) {
    return (
      <p className="text-xs text-muted-foreground">
        Gamut não analisado: escolha o perfil de destino (ICC) na Gestão de cor do perfil de produção e reanalise.
      </p>
    )
  }
  if (g.error) return <p className="text-xs text-amber-600 dark:text-amber-400">Gestão de cor: {g.error}</p>
  const vectors = g.vectors ?? { colors: 0, outOfGamut: 0, worst: [] }
  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-sm font-semibold text-foreground">Gamut no destino</h4>
        <p className="text-xs text-muted-foreground">
          {g.output} ({g.outputSpace}) · verificação {g.check ?? 'Little CMS'} · RGB sem perfil: {g.rgbSource}
        </p>
      </div>

      <dl className="divide-y divide-border rounded-lg border border-border text-xs">
        <div className="flex justify-between gap-3 px-3 py-1.5">
          <dt className="text-muted-foreground">Cores de vetor/texto fora do gamut</dt>
          <dd className={cn('font-medium tabular-nums', vectors.outOfGamut ? 'text-amber-600 dark:text-amber-400' : 'text-foreground')}>
            {vectors.colors ? `${vectors.outOfGamut} de ${vectors.colors}` : 'nenhuma cor RGB de vetor'}
          </dd>
        </div>
        {(g.images ?? []).map((image) => (
          <div key={`${image.page}-${image.name}`} className="flex justify-between gap-3 px-3 py-1.5">
            <dt className="text-muted-foreground">
              Imagem {image.name} (pág. {image.page}){image.embeddedProfile ? '' : ' · sem perfil'}
            </dt>
            <dd className={cn('font-medium tabular-nums', image.share > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-foreground')}>
              {pct(image.share)} fora · maior variação {de(image.maxDe)} ΔE00
            </dd>
          </div>
        ))}
        {g.outputIntent?.name && (
          <div className="flex justify-between gap-3 px-3 py-1.5">
            <dt className="text-muted-foreground">Perfil de saída da arte</dt>
            <dd className="font-medium text-foreground">
              {g.outputIntent.name}
              {g.outputIntent.matchesDestination === false && ' · diferente do destino'}
              {g.outputIntent.matchesDestination === true && ' · igual ao destino'}
            </dd>
          </div>
        )}
      </dl>

      {vectors.worst.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Cores que o destino não alcança (como estão na arte):</p>
          <div className="flex flex-wrap gap-2">
            {vectors.worst.map((c) => (
              <span key={c.rgb.join(',')} className="flex items-center gap-1.5 rounded border border-border px-1.5 py-0.5 text-[11px] tabular-nums">
                <span className="h-3 w-3 rounded-sm border border-border" style={{ background: `rgb(${c.rgb.join(',')})` }} />
                RGB {c.rgb.join(' ')} · {de(c.de)} ΔE00
              </span>
            ))}
          </div>
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        Medição por perfil ICC (intenção da conversão no perfil: {INTENT[g.intent] ?? g.intent}). Mostra o que o perfil prevê;
        a cor física só é comprovada medindo a impressão com espectrofotômetro.
      </p>
    </div>
  )
}
