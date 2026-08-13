import { MoreHorizontal, Pencil, Copy, Trash2, Power } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import type { ProductionProfile } from '@/types'

interface ProfileTableProps {
  profiles: ProductionProfile[]
  onEdit: (profile: ProductionProfile) => void
  onDuplicate: (profile: ProductionProfile) => void
  onToggleStatus: (profile: ProductionProfile) => void
  onDelete: (profile: ProductionProfile) => void
}

export function ProfileTable({
  profiles,
  onEdit,
  onDuplicate,
  onToggleStatus,
  onDelete,
}: ProfileTableProps) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden overflow-x-auto">
      <table className="w-full text-xs min-w-[700px]">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
            <th className="text-left font-medium px-4 py-2.5">Nome</th>
            <th className="text-left font-medium px-3 py-2.5">Descrição</th>
            <th className="text-left font-medium px-3 py-2.5">Categoria</th>
            <th className="text-left font-medium px-3 py-2.5">Status</th>
            <th className="text-center font-medium px-3 py-2.5">Regras</th>
            <th className="px-3 py-2.5"></th>
          </tr>
        </thead>
        <tbody>
          {profiles.map((p) => (
            <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50/50">
              <td className="px-4 py-2.5">
                <span className="font-medium text-slate-800">{p.name}</span>
                {p.isDefault && (
                  <Badge variant="secondary" className="ml-2 text-[10px] h-4 px-1">
                    Padrão
                  </Badge>
                )}
              </td>
              <td className="px-3 py-2.5 text-slate-500 max-w-[200px] truncate">
                {p.description || '—'}
              </td>
              <td className="px-3 py-2.5 text-slate-600">{p.category}</td>
              <td className="px-3 py-2.5">
                <Badge
                  variant="outline"
                  className={cn(
                    'text-[10px] h-5',
                    p.status === 'active'
                      ? 'border-green-200 bg-green-50 text-green-700'
                      : 'border-slate-200 bg-slate-100 text-slate-500',
                  )}
                >
                  {p.status === 'active' ? 'Ativo' : 'Inativo'}
                </Badge>
              </td>
              <td className="px-3 py-2.5 text-center text-slate-600 font-medium">
                {p.rules.filter((r) => r.enabled).length}/{p.rules.length}
              </td>
              <td className="px-3 py-2.5">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => onEdit(p)}>
                      <Pencil className="h-3.5 w-3.5 mr-1.5" /> Editar
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onDuplicate(p)}>
                      <Copy className="h-3.5 w-3.5 mr-1.5" /> Duplicar
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onToggleStatus(p)}>
                      <Power className="h-3.5 w-3.5 mr-1.5" />
                      {p.status === 'active' ? 'Desativar' : 'Ativar'}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => onDelete(p)}
                      className="text-red-600 focus:text-red-600"
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Excluir
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
