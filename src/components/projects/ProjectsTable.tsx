import { useNavigate } from 'react-router-dom'
import { MoreHorizontal, FileSearch, Layers, FileCheck } from 'lucide-react'
import { StatusBadge, SeverityBadge } from '@/components/Badges'
import { formatDate } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import type { Project } from '@/types'

interface ProjectsTableProps {
  projects: Project[]
}

export function ProjectsTable({ projects }: ProjectsTableProps) {
  const navigate = useNavigate()

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden overflow-x-auto">
      <table className="w-full text-sm min-w-[900px]">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <th className="text-left font-medium px-4 py-2.5">Nome</th>
            <th className="text-left font-medium px-3 py-2.5">Cliente</th>
            <th className="text-left font-medium px-3 py-2.5">Arquivo</th>
            <th className="text-left font-medium px-3 py-2.5">Tipo Produção</th>
            <th className="text-left font-medium px-3 py-2.5">Responsável</th>
            <th className="text-left font-medium px-3 py-2.5">Criação</th>
            <th className="text-left font-medium px-3 py-2.5">Prazo</th>
            <th className="text-left font-medium px-3 py-2.5">Status</th>
            <th className="text-left font-medium px-3 py-2.5">Criticidade</th>
            <th className="text-center font-medium px-3 py-2.5">Probl.</th>
            <th className="px-3 py-2.5"></th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50/50">
              <td className="px-4 py-2.5">
                <button
                  onClick={() => navigate(`/projects/${p.id}`)}
                  className="font-medium text-slate-800 hover:text-blue-600 text-left"
                >
                  {p.name}
                </button>
              </td>
              <td className="px-3 py-2.5 text-slate-700">{p.clientName}</td>
              <td className="px-3 py-2.5 text-slate-600 max-w-[120px] truncate">{p.filename}</td>
              <td className="px-3 py-2.5 text-slate-700">{p.productionType}</td>
              <td className="px-3 py-2.5 text-slate-700">{p.responsibleName}</td>
              <td className="px-3 py-2.5 text-slate-600">{formatDate(p.createdAt)}</td>
              <td className="px-3 py-2.5 text-slate-600">{formatDate(p.deadline)}</td>
              <td className="px-3 py-2.5">
                <StatusBadge status={p.status} />
              </td>
              <td className="px-3 py-2.5">
                <SeverityBadge severity={p.severity} />
              </td>
              <td className="px-3 py-2.5 text-center text-slate-700 font-medium">{p.issueCount}</td>
              <td className="px-3 py-2.5">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500">
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
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
