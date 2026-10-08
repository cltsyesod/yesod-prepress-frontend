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

const STORAGE_KEY = 'yesod.cropMarks'

export interface CropMarksOptions {
  registrationTargets: boolean
  slug: string
}

/** Marcas de corte: sempre fora da sangria; cruzes de registro e identificação são opcionais. */
export function CropMarksDialog({
  open,
  defaultSlug,
  onCancel,
  onConfirm,
}: {
  open: boolean
  defaultSlug: string
  onCancel: () => void
  onConfirm: (options: CropMarksOptions) => void
}) {
  const [targets, setTargets] = useState(false)
  const [withSlug, setWithSlug] = useState(true)
  const [slug, setSlug] = useState('')

  useEffect(() => {
    if (!open) return
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
      setTargets(!!saved?.registrationTargets)
      setWithSlug(saved?.withSlug !== false)
    } catch {
      /* sem armazenamento local */
    }
    setSlug(defaultSlug)
  }, [open, defaultSlug])

  const confirm = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ registrationTargets: targets, withSlug }))
    } catch {
      /* segue sem lembrar */
    }
    onConfirm({ registrationTargets: targets, slug: withSlug ? slug.trim() : '' })
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Marcas de corte</DialogTitle>
          <DialogDescription>
            As marcas ficam por fora da sangria, nunca sobre a arte. A página é ampliada para caberem.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <label className="flex items-start gap-2">
            <Checkbox checked={targets} onCheckedChange={(v) => setTargets(v === true)} className="mt-0.5" />
            <span>
              Cruzes de registro
              <span className="block text-xs text-muted-foreground">
                No meio de cada lado, na mesma faixa das marcas, em cor de registro.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <Checkbox checked={withSlug} onCheckedChange={(v) => setWithSlug(v === true)} className="mt-0.5" />
            <span>Faixa de identificação abaixo da peça</span>
          </label>
          {withSlug && <Input value={slug} onChange={(e) => setSlug(e.target.value)} maxLength={200} />}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
          <Button onClick={confirm}>Inserir marcas</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
