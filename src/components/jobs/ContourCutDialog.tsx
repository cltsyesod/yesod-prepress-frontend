import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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

const STORAGE_KEY = 'yesod.contourCut'

export interface ContourCutOptions {
  offsetMm: number
  name: string
  /** Também corta as áreas sem impressão fechadas pela arte (o miolo de um "O"). */
  cutHoles: boolean
  /** "ignore": fundo branco não é arte; "keep": o fundo branco faz parte da peça. */
  whiteBackground: 'ignore' | 'keep'
}

function remembered(defaultName: string): ContourCutOptions {
  const base: ContourCutOptions = {
    offsetMm: 0,
    name: defaultName || 'CutContour',
    cutHoles: false,
    whiteBackground: 'ignore',
  }
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    if (saved && typeof saved.offsetMm === 'number') {
      return { ...base, ...saved, name: defaultName || saved.name || 'CutContour' }
    }
  } catch {
    /* sem armazenamento local: começa com o padrão */
  }
  return base
}

/**
 * Faca pelo contorno da arte: o operador define o afastamento a cada trabalho.
 * Positivo = por fora da arte (nada impresso é cortado); 0 = na borda; negativo = para dentro.
 */
export function ContourCutDialog({
  open,
  defaultName,
  onCancel,
  onConfirm,
}: {
  open: boolean
  defaultName: string
  onCancel: () => void
  onConfirm: (options: ContourCutOptions) => void
}) {
  const [offset, setOffset] = useState('')
  const [name, setName] = useState('')
  const [cutHoles, setCutHoles] = useState(false)
  const [keepWhite, setKeepWhite] = useState(false)

  useEffect(() => {
    if (!open) return
    const initial = remembered(defaultName)
    setOffset(String(initial.offsetMm))
    setName(initial.name)
    setCutHoles(initial.cutHoles)
    setKeepWhite(initial.whiteBackground === 'keep')
  }, [open, defaultName])

  const value = Number(offset.replace(',', '.'))
  const valid = offset.trim() !== '' && Number.isFinite(value) && name.trim() !== ''

  const confirm = () => {
    if (!valid) return
    const options: ContourCutOptions = {
      offsetMm: value,
      name: name.trim(),
      cutHoles,
      whiteBackground: keepWhite ? 'keep' : 'ignore',
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(options))
    } catch {
      /* segue sem lembrar */
    }
    onConfirm(options)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Faca pelo contorno da arte</DialogTitle>
          <DialogDescription>
            A faca contorna tudo o que é impresso. Com afastamento positivo ela fica por fora da arte, e nada
            impresso é cortado.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="contour-offset">Afastamento da arte (mm)</Label>
            <Input
              id="contour-offset"
              inputMode="decimal"
              autoFocus
              value={offset}
              onChange={(e) => setOffset(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && confirm()}
            />
            <p className="text-xs text-muted-foreground">No tamanho final. 0 = na borda da arte.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="contour-name">Nome da faca no RIP</Label>
            <Input id="contour-name" value={name} onChange={(e) => setName(e.target.value)} />
            <p className="text-xs text-muted-foreground">
              Nome da separação que o RIP/plotter reconhece como corte (ex.: CutContour).
            </p>
          </div>
        </div>
        <div className="space-y-2 text-sm">
          <label className="flex items-start gap-2">
            <Checkbox checked={cutHoles} onCheckedChange={(v) => setCutHoles(v === true)} className="mt-0.5" />
            <span>
              Cortar os vazados internos
              <span className="block text-xs text-muted-foreground">
                Áreas sem impressão fechadas pela arte (o miolo de um "O") também são cortadas.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <Checkbox checked={keepWhite} onCheckedChange={(v) => setKeepWhite(v === true)} className="mt-0.5" />
            <span>
              O fundo branco faz parte da peça
              <span className="block text-xs text-muted-foreground">
                Desligado: um retângulo branco atrás da arte é ignorado e a faca segue a arte. Bordas brancas
                dentro da arte são sempre mantidas.
              </span>
            </span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
          <Button disabled={!valid} onClick={confirm}>
            Gerar faca
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
