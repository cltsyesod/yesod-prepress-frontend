import { useState, useEffect, useMemo } from 'react'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Plus, Search, Settings2, AlertCircle, RefreshCw } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { profileService } from '@/services/profileService'
import { ProfileTable } from '@/components/profiles/ProfileTable'
import { ProfileFormDialog } from '@/components/profiles/ProfileFormDialog'
import { DeleteProfileDialog } from '@/components/profiles/DeleteProfileDialog'
import type { ProductionProfile } from '@/types'

type FormData = Omit<ProductionProfile, 'id' | 'createdAt' | 'updatedAt'>

export default function ProductionProfilesPage() {
  const { toast } = useToast()
  const [profiles, setProfiles] = useState<ProductionProfile[]>([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editingProfile, setEditingProfile] = useState<ProductionProfile | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ProductionProfile | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const loadProfiles = async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await profileService.listProfiles()
      setProfiles(data)
    } catch {
      setError('Erro ao carregar perfis. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadProfiles()
  }, [])

  const filtered = useMemo(() => {
    return profiles.filter((p) => {
      const matchSearch = p.name.toLowerCase().includes(search.toLowerCase())
      const matchStatus = statusFilter === 'all' || p.status === statusFilter
      return matchSearch && matchStatus
    })
  }, [profiles, search, statusFilter])

  const handleCreate = () => {
    setEditingProfile(null)
    setFormOpen(true)
  }
  const handleEdit = (p: ProductionProfile) => {
    setEditingProfile(p)
    setFormOpen(true)
  }

  const handleSave = async (data: FormData) => {
    try {
      if (editingProfile) {
        await profileService.updateProfile(editingProfile.id, data)
        toast({ title: 'Perfil atualizado' })
      } else {
        await profileService.createProfile(data)
        toast({ title: 'Perfil criado' })
      }
      loadProfiles()
    } catch {
      toast({ title: 'Erro ao salvar perfil', variant: 'destructive' })
    }
  }

  const handleDuplicate = async (p: ProductionProfile) => {
    try {
      await profileService.duplicateProfile(p.id)
      toast({ title: 'Perfil duplicado' })
      loadProfiles()
    } catch {
      toast({ title: 'Erro ao duplicar', variant: 'destructive' })
    }
  }

  const handleToggleStatus = async (p: ProductionProfile) => {
    try {
      await profileService.toggleStatus(p.id)
      toast({ title: p.status === 'active' ? 'Perfil desativado' : 'Perfil ativado' })
      loadProfiles()
    } catch {
      toast({ title: 'Erro ao alterar status', variant: 'destructive' })
    }
  }

  const handleDelete = (p: ProductionProfile) => {
    setDeleteTarget(p)
    setDeleteOpen(true)
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    try {
      await profileService.deleteProfile(deleteTarget.id)
      toast({ title: 'Perfil excluído' })
      setDeleteOpen(false)
      setDeleteTarget(null)
      loadProfiles()
    } catch {
      toast({ title: 'Erro ao excluir', variant: 'destructive' })
    }
  }

  const handleRetry = () => {
    profileService.resetProfiles()
    loadProfiles()
  }

  return (
    <div>
      <PageHeader
        title="Perfis de Produção"
        breadcrumbs={[{ label: 'Home', href: '/dashboard' }, { label: 'Perfis de Produção' }]}
      />
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 flex-1 max-w-md">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Buscar perfil..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-xs bg-slate-50/50"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 text-xs w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">
                Todos
              </SelectItem>
              <SelectItem value="active" className="text-xs">
                Ativos
              </SelectItem>
              <SelectItem value="inactive" className="text-xs">
                Inativos
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          onClick={handleCreate}
          className="bg-blue-600 hover:bg-blue-700 text-white text-xs gap-1.5"
        >
          <Plus className="h-3.5 w-3.5" /> Criar perfil
        </Button>
      </div>

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <AlertCircle className="h-10 w-10 text-red-400" />
          <p className="text-sm text-slate-600">{error}</p>
          <Button variant="outline" onClick={handleRetry} className="text-xs gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" /> Tentar novamente
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Settings2 className="h-10 w-10 text-slate-300" />
          {search || statusFilter !== 'all' ? (
            <>
              <p className="text-sm text-slate-500">Nenhum resultado para a busca</p>
              <Button
                variant="outline"
                onClick={() => {
                  setSearch('')
                  setStatusFilter('all')
                }}
                className="text-xs"
              >
                Limpar filtros
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm text-slate-500">Nenhum perfil encontrado</p>
              <Button
                onClick={handleCreate}
                className="bg-blue-600 hover:bg-blue-700 text-white text-xs gap-1.5"
              >
                <Plus className="h-3.5 w-3.5" /> Criar perfil
              </Button>
            </>
          )}
        </div>
      ) : (
        <ProfileTable
          profiles={filtered}
          onEdit={handleEdit}
          onDuplicate={handleDuplicate}
          onToggleStatus={handleToggleStatus}
          onDelete={handleDelete}
        />
      )}

      <ProfileFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        initialData={editingProfile}
        onSave={handleSave}
      />
      <DeleteProfileDialog
        profile={deleteTarget}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={confirmDelete}
      />
    </div>
  )
}
