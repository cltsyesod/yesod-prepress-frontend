import { Star, MoreVertical, FolderOpen, CheckCircle2, GitCompare, Eye } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { formatFileSize, formatDate } from '@/lib/utils'
import { VersionStatusBadge, VERSION_ORIGIN_LABELS } from './versionStatus'
import type { ProjectVersion } from '@/types'

interface VersionListProps {
  versions: ProjectVersion[]
  onOpenVersion: (id: string) => void
  onSetCurrent: (id: string) => void
  onCompare: (id: string) => void
  onAddVersion: () => void
}

export function VersionList({
  versions,
  onOpenVersion,
  onSetCurrent,
  onCompare,
  onAddVersion,
}: VersionListProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-slate-500">{versions.length} versão(ões)</p>
        <Button
          onClick={onAddVersion}
          size="sm"
          className="bg-blue-600 hover:bg-blue-700 text-white text-xs h-8"
        >
          + Adicionar versão
        </Button>
      </div>
      <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
        <table className="w-full text-xs min-w-[900px]">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/50">
              <th className="text-left font-medium text-slate-500 px-3 py-2.5">Versão</th>
              <th className="text-left font-medium text-slate-500 px-3 py-2.5">Arquivo</th>
              <th className="text-left font-medium text-slate-500 px-3 py-2.5">Formato</th>
              <th className="text-left font-medium text-slate-500 px-3 py-2.5">Tamanho</th>
              <th className="text-left font-medium text-slate-500 px-3 py-2.5">Data</th>
              <th className="text-left font-medium text-slate-500 px-3 py-2.5">Responsável</th>
              <th className="text-left font-medium text-slate-500 px-3 py-2.5">Origem</th>
              <th className="text-center font-medium text-slate-500 px-3 py-2.5">Problemas</th>
              <th className="text-left font-medium text-slate-500 px-3 py-2.5">Status</th>
              <th className="text-right font-medium text-slate-500 px-3 py-2.5">Ações</th>
            </tr>
          </thead>
          <tbody>
            {versions.map((v) => (
              <tr
                key={v.id}
                className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors"
              >
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-slate-800">v{v.versionNumber}</span>
                    {v.isCurrent && (
                      <span className="flex items-center gap-0.5 px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded text-[10px] font-medium">
                        <Star className="h-2.5 w-2.5 fill-blue-600" /> Atual
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-slate-700 max-w-[180px] truncate">{v.fileName}</td>
                <td className="px-3 py-2.5">
                  <span className="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px] font-medium">
                    {v.format}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-slate-500">{formatFileSize(v.size)}</td>
                <td className="px-3 py-2.5 text-slate-500">{formatDate(v.createdAt)}</td>
                <td className="px-3 py-2.5 text-slate-600">{v.responsibleName}</td>
                <td className="px-3 py-2.5 text-slate-500">{VERSION_ORIGIN_LABELS[v.origin]}</td>
                <td className="px-3 py-2.5 text-center">
                  <span
                    className={`font-medium ${v.problemSummary.pending > 0 ? 'text-red-500' : 'text-slate-400'}`}
                  >
                    {v.problemSummary.critical + v.problemSummary.warning + v.problemSummary.info}
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <VersionStatusBadge status={v.status} />
                </td>
                <td className="px-3 py-2.5 text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                        <MoreVertical className="h-3.5 w-3.5 text-slate-400" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onOpenVersion(v.id)}>
                        <FolderOpen className="h-3.5 w-3.5 mr-2" /> Abrir versão
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onOpenVersion(v.id)}>
                        <Eye className="h-3.5 w-3.5 mr-2" /> Ver alterações
                      </DropdownMenuItem>
                      {!v.isCurrent && (
                        <DropdownMenuItem onClick={() => onSetCurrent(v.id)}>
                          <CheckCircle2 className="h-3.5 w-3.5 mr-2" /> Definir como atual
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onClick={() => onCompare(v.id)}>
                        <GitCompare className="h-3.5 w-3.5 mr-2" /> Comparar
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
