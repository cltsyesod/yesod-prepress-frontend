import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Loader2, AlertTriangle } from 'lucide-react'
import { projectService } from '@/services/projectService'
import type { ProductionProfile } from '@/types'

interface Props {
  profile: ProductionProfile | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

export function DeleteProfileDialog({ profile, open, onOpenChange, onConfirm }: Props) {
  const [projectCount, setProjectCount] = useState(0)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open && profile) {
      setLoading(true)
      setProjectCount(0)
      projectService
        .listProjects()
        .then((projects) => {
          const count = projects.filter(
            (p) => p.productionProfile === profile.name || p.profileId === profile.id,
          ).length
          setProjectCount(count)
          setLoading(false)
        })
        .catch(() => setLoading(false))
    }
  }, [open, profile])

  const isBlocked = projectCount > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-sm">Excluir perfil</DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : isBlocked ? (
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-sm text-slate-600">
              Este perfil está em uso por {projectCount}{' '}
              {projectCount === 1 ? 'projeto' : 'projetos'}. Desative-o antes de excluir.
            </p>
          </div>
        ) : (
          <p className="text-sm text-slate-600">
            Tem certeza que deseja excluir o perfil "{profile?.name}"? Esta ação não pode ser
            desfeita.
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="text-xs">
            Cancelar
          </Button>
          <Button
            variant="destructive"
            disabled={isBlocked || loading}
            onClick={onConfirm}
            className="text-xs"
          >
            Excluir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
