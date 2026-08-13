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

interface EmailReportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectName: string
  onSend: (data: { recipient: string; subject: string; message: string }) => void
}

export function EmailReportDialog({
  open,
  onOpenChange,
  projectName,
  onSend,
}: EmailReportDialogProps) {
  const [recipient, setRecipient] = useState('')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (open) {
      setRecipient('')
      setSubject(`Relatório técnico - ${projectName}`)
      setMessage(`Segue o relatório técnico do projeto "${projectName}".`)
    }
  }, [open, projectName])

  const handleSubmit = () => {
    onSend({ recipient, subject, message })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="text-base">Enviar relatório por e-mail</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-600">Destinatário</Label>
            <Input
              type="email"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="email@exemplo.com"
              className="text-xs h-8"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-600">Assunto</Label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="text-xs h-8"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-600">Mensagem</Label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              className="text-xs"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="text-xs h-8">
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!recipient.trim()}
            className="bg-blue-600 hover:bg-blue-700 text-white text-xs h-8"
          >
            Enviar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
