import { useState } from 'react'
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
import type { Client } from '@/types'

interface NewClientModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdd: (client: Client) => void
}

export function NewClientModal({ open, onOpenChange, onAdd }: NewClientModalProps) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [company, setCompany] = useState('')
  const [error, setError] = useState('')

  const handleSave = () => {
    if (!name.trim()) {
      setError('Nome é obrigatório')
      return
    }
    onAdd({
      id: `cli-${Date.now()}`,
      name: name.trim(),
      company: company.trim() || name.trim(),
      email: email.trim(),
      phone: phone.trim(),
    })
    setName('')
    setEmail('')
    setPhone('')
    setCompany('')
    setError('')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Criar novo cliente</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs font-medium text-slate-700">Nome *</Label>
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setError('')
              }}
              placeholder="Nome do cliente"
              className="text-sm bg-slate-50/50"
            />
            {error && <p className="text-xs text-red-500">{error}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs font-medium text-slate-700">E-mail</Label>
              <Input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@exemplo.com"
                className="text-sm bg-slate-50/50"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium text-slate-700">Telefone</Label>
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(11) 9999-9999"
                className="text-sm bg-slate-50/50"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-medium text-slate-700">Empresa</Label>
            <Input
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Nome da empresa"
              className="text-sm bg-slate-50/50"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="text-xs">
            Cancelar
          </Button>
          <Button onClick={handleSave} className="bg-blue-600 hover:bg-blue-700 text-white text-xs">
            Salvar cliente
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
