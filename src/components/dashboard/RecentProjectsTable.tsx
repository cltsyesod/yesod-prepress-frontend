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

interface RecentProjectsTableProps {
  projects: Project[]
}

export function RecentProjectsTable({ projects }: RecentProjectsTableProps) {
  const navigate = useNavigate()

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <h2 className="text-base font-semibold text-card-foreground">Projetos Recentes</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted border-b border-border text-muted-foreground">
              <th className="text-left font-medium px-4 py-2">Projeto</th>
              <th className="text-left font-medium px-3 py-2">Cliente</th>
              <th className="text-left font-medium px-3 py-2">Arquivo</th>
              <th className="text-left font-medium px-3 py-2 hidden lg:table-cell">Perfil</th>
              <th className="text-left font-medium px-3 py-2 hidden md:table-cell">Resp.</th>
              <th className="text-left font-medium px-3 py-2 hidden sm:table-cell">Data</th>
              <th className="text-left font-medium px-3 py-2">Criticidade</th>
              <th className="text-left font-medium px-3 py-2">Status</th>
              <th className="text-center font-medium px-3 py-2">Probl.</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id} className="border-b border-border/50 hover:bg-accent/50">
                <td className="px-4 py-2">
                  <button
                    onClick={() => navigate(`/projects/${p.id}`)}
                    className="font-medium text-card-foreground hover:text-primary text-left"
                  >
                    {p.name}
                  </button>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{p.clientName}</td>
                <td className="px-3 py-2 text-muted-foreground max-w-[120px] truncate">
                  {p.filename}
                </td>
                <td className="px-3 py-2 text-muted-foreground hidden lg:table-cell">
                  {p.productionProfile}
                </td>
                <td className="px-3 py-2 text-muted-foreground hidden md:table-cell">
                  {p.responsibleName}
                </td>
                <td className="px-3 py-2 text-muted-foreground hidden sm:table-cell">
                  {formatDate(p.createdAt)}
                </td>
                <td className="px-3 py-2">
                  <SeverityBadge severity={p.severity} />
                </td>
                <td className="px-3 py-2">
                  <StatusBadge status={p.status} />
                </td>
                <td className="px-3 py-2 text-center text-card-foreground font-medium">
                  {p.issueCount}
                </td>
                <td className="px-3 py-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:bg-accent"
                      >
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
    </div>
  )
}
