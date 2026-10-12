import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

const STORAGE_KEY = 'yesod.bleedMethod'

export type BleedMethod = 'stretch' | 'mirror'

export interface BleedOptions {
  method: BleedMethod
  bleedMm: number
}

const METHODS: { id: BleedMethod; title: string; text: string }[] = [
  {
    id: 'stretch',
    title: 'Esticar a borda',
    text: 'A última faixa da arte continua para fora. Melhor para fundos chapados e degradês.',
  },
  {
    id: 'mirror',
    title: 'Espelhar a borda',
    text: 'A arte é refletida para fora do corte. Melhor para fotos e texturas.',
  },
]

/** Desenho do método: o formato final (tracejado) e a faixa gerada em volta. */
function Sketch({ method }: { method: BleedMethod }) {
  return (
    <svg viewBox="0 0 96 56" className="h-14 w-full" aria-hidden>
      <defs>
        <linearGradient id={`bleed-${method}`} x1="0" x2="1">
          <stop offset="0" stopColor="#0ea5e9" />
          <stop offset="1" stopColor="#f97316" />
        </linearGradient>
      </defs>
      {method === 'stretch' ? (
        <>
          <rect x="4" y="4" width="88" height="48" fill="url(#bleed-stretch)" opacity="0.45" />
          <rect x="14" y="12" width="68" height="32" fill="url(#bleed-stretch)" />
        </>
      ) : (
        <>
          <rect x="4" y="4" width="88" height="48" fill="url(#bleed-mirror)" opacity="0.45" />
          <rect x="14" y="12" width="68" height="32" fill="url(#bleed-mirror)" />
          <circle cx="22" cy="28" r="6" fill="#facc15" />
          <circle cx="6" cy="28" r="6" fill="#facc15" opacity="0.45" />
        </>
      )}
      <rect x="14" y="12" width="68" height="32" fill="none" stroke="currentColor" strokeDasharray="3 2" strokeWidth="1" />
    </svg>
  )
}

/**
 * Sangria gerada pelo sistema a partir da borda da arte. Nada dentro do formato final muda;
 * o operador escolhe o método conforme a arte e confere na pré-visualização.
 */
export function BleedDialog({
  open,
  defaultMm,
  onCancel,
  onConfirm,
}: {
  open: boolean
  /** Sangria da ficha/perfil (o mínimo pedido para o trabalho). */
  defaultMm: number
  onCancel: () => void
  onConfirm: (options: BleedOptions) => void
}) {
  const [method, setMethod] = useState<BleedMethod>('stretch')
  const [bleed, setBleed] = useState('')

  useEffect(() => {
    if (!open) return
    setBleed(String(defaultMm || ''))
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved === 'stretch' || saved === 'mirror') setMethod(saved)
    } catch {
      /* sem armazenamento local: começa com esticar */
    }
  }, [open, defaultMm])

  const value = Number(bleed.replace(',', '.'))
  const valid = Number.isFinite(value) && value > 0

  const confirm = () => {
    if (!valid) return
    try {
      localStorage.setItem(STORAGE_KEY, method)
    } catch {
      /* segue sem lembrar */
    }
    onConfirm({ method, bleedMm: value })
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Gerar sangria</DialogTitle>
          <DialogDescription>
            O sistema estende a arte para fora do formato final. O que está dentro do corte não muda, e o arquivo do
            cliente continua guardado.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          {METHODS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setMethod(item.id)}
              aria-pressed={method === item.id}
              className={cn(
                'space-y-2 rounded-lg border p-3 text-left text-muted-foreground transition-colors',
                method === item.id ? 'border-primary ring-1 ring-primary' : 'border-border hover:border-foreground/30',
              )}
            >
              <Sketch method={item.id} />
              <span className="block text-sm font-medium text-foreground">{item.title}</span>
              <span className="block text-xs">{item.text}</span>
            </button>
          ))}
        </div>
        <div className="max-w-[200px] space-y-1.5">
          <Label htmlFor="bleed-mm">Sangria (mm)</Label>
          <Input
            id="bleed-mm"
            inputMode="decimal"
            value={bleed}
            onChange={(e) => setBleed(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && confirm()}
          />
          <p className="text-xs text-muted-foreground">Em cada lado, no tamanho final.</p>
        </div>
        <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          Textos ou elementos importantes encostados na borda também serão estendidos. Confira a pré-visualização e, se
          a arte não aceitar, devolva ao cliente.
        </p>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
          <Button disabled={!valid} onClick={confirm}>
            Gerar sangria
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
