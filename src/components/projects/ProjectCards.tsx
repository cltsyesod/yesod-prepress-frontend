import { useNavigate } from 'react-router-dom'
import { FileSearch, Layers, FileCheck, MoreHorizontal } from 'lucide-react'
import { StatusBadge, SeverityBadge } from '@/components/Badges'
import { formatDate, formatFileSize } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import type { Project } from '@/types'

interface ProjectCardsProps {
  projects: Project[]
}

export function ProjectCards({ projects }: ProjectCardsProps) {
  const navigate = useNavigate()

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {projects.map((p) => (
        <div
          key={p.id}
          className="bg-white border border-slate-200 rounded-lg p-4 hover:border-blue-300 transition-colors"
        >
          <div className="flex items-start justify-between mb-2">
            <button
              onClick={() => navigate(`/projects/${p.id}`)}
              className="text-sm font-semibold text-slate-800 hover:text-blue-600 text-left"
            >
              {p.name}
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 shrink-0">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => navigate(`/projects/${p.id}`)}>
                  Ver Detalhes
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate(`/projects/${p.id}/analysis`)}>
                  <FileSearch className="h-3.5 w-3.5 mr-1.5" /> Análise
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate(`/projects/${p.id}/versions`)}>
                  <Layers className="h-3.5 w-3.5 mr-1.5" /> Versões
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate(`/projects/${p.id}/report`)}>
                  <FileCheck className="h-3.5 w-3.5 mr-1.5" /> Relatório
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="flex items-center gap-2 mb-2">
            <StatusBadge status={p.status} />
            <SeverityBadge severity={p.severity} />
          </div>
          <p className="text-xs text-slate-500 mb-3 line-clamp-2">{p.description}</p>
          <div className="space-y-1 text-[11px] text-slate-400 border-t border-slate-100 pt-2">
            <div className="flex justify-between">
              <span>Cliente:</span>
              <span className="text-slate-600">{p.clientName}</span>
            </div>
            <div className="flex justify-between">
              <span>Arquivo:</span>
              <span className="text-slate-600 truncate ml-2">
                {p.filename} ({formatFileSize(p.fileSize)})
              </span>
            </div>
            <div className="flex justify-between">
              <span>Produção:</span>
              <span className="text-slate-600">{p.productionType}</span>
            </div>
            <div className="flex justify-between">
              <span>Responsável:</span>
              <span className="text-slate-600">{p.responsibleName}</span>
            </div>
            <div className="flex justify-between">
              <span>Prazo:</span>
              <span className="text-slate-600">{formatDate(p.deadline)}</span>
            </div>
            <div className="flex justify-between">
              <span>Pedido:</span>
              <span className="text-slate-600">{p.orderNumber}</span>
            </div>
            <div className="flex justify-between">
              <span>Problemas:</span>
              <span className="text-slate-600 font-medium">{p.issueCount}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
