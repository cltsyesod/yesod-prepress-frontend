import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { AddVersionData } from '@/types'

const FORMAT_OPTIONS = ['PDF', 'AI', 'PSD', 'EPS', 'INDD', 'TIFF', 'JPG', 'PNG']

interface AddVersionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  nextVersionNumber: number
  defaultResponsibleId: string
  defaultResponsibleName: string
  defaultFileName: string
  onAdd: (data: AddVersionData) => void
}

export function AddVersionDialog({
  open,
  onOpenChange,
  nextVersionNumber,
  defaultResponsibleId,
  defaultResponsibleName,
  defaultFileName,
  onAdd,
}: AddVersionDialogProps) {
  const [fileName, setFileName] = useState('')
  const [format, setFormat] = useState('PDF')
  const [sizeKb, setSizeKb] = useState('500')
  const [comment, setComment] = useState('')
  const [responsibleName, setResponsibleName] = useState('')

  useEffect(() => {
    if (open) {
      setFileName(defaultFileName.replace(/(\.[^.]+)?$/, `_v${nextVersionNumber}.pdf`))
      setFormat('PDF')
      setSizeKb('500')
      setComment('')
      setResponsibleName(defaultResponsibleName)
    }
  }, [open, nextVersionNumber, defaultFileName, defaultResponsibleName])

  const handleSubmit = () => {
    onAdd({
      fileName: fileName || `arquivo_v${nextVersionNumber}.pdf`,
      format,
      size: parseInt(sizeKb) * 1024 || 0,
      comment,
      responsibleId: defaultResponsibleId,
      responsibleName: responsibleName || defaultResponsibleName,
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="text-base">Adicionar Versão #{nextVersionNumber}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-600">Nome do arquivo</Label>
            <Input
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              className="text-xs h-8"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-600">Formato</Label>
              <Select value={format} onValueChange={setFormat}>
                <SelectTrigger className="text-xs h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FORMAT_OPTIONS.map((f) => (
                    <SelectItem key={f} value={f} className="text-xs">
                      {f}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-600">Tamanho (KB)</Label>
              <Input
                type="number"
                value={sizeKb}
                onChange={(e) => setSizeKb(e.target.value)}
                className="text-xs h-8"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-600">Responsável</Label>
            <Input
              value={responsibleName}
              onChange={(e) => setResponsibleName(e.target.value)}
              className="text-xs h-8"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-600">Comentário</Label>
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              className="text-xs"
              placeholder="Adicione um comentário sobre esta versão..."
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="text-xs h-8">
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            className="bg-blue-600 hover:bg-blue-700 text-white text-xs h-8"
          >
            Adicionar versão
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
