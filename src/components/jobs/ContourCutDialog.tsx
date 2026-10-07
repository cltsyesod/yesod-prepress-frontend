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

const STORAGE_KEY = 'yesod.contourCut'

export interface ContourCutOptions {
  offsetMm: number
  name: string
}

function remembered(defaultName: string): ContourCutOptions {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    if (saved && typeof saved.offsetMm === 'number') {
      return { offsetMm: saved.offsetMm, name: defaultName || saved.name || 'CutContour' }
    }
  } catch {
    /* sem armazenamento local: começa vazio */
  }
  return { offsetMm: 0, name: defaultName || 'CutContour' }
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

  useEffect(() => {
    if (!open) return
    const initial = remembered(defaultName)
    setOffset(String(initial.offsetMm))
    setName(initial.name)
  }, [open, defaultName])

  const value = Number(offset.replace(',', '.'))
  const valid = offset.trim() !== '' && Number.isFinite(value) && name.trim() !== ''

  const confirm = () => {
    if (!valid) return
    const options = { offsetMm: value, name: name.trim() }
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
            <Label htmlFor="contour-name">Cor especial da faca</Label>
            <Input id="contour-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
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
