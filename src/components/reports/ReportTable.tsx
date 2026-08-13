import { useNavigate } from 'react-router-dom'
import {
  MoreHorizontal,
  FileText,
  FolderOpen,
  Layers,
  Printer,
  Download,
  Share2,
  Mail,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { StatusBadge } from '@/components/Badges'
import { formatDate } from '@/lib/utils'
import type { ReportListItem, ProjectClassification } from '@/services/reportService'

const CLS_STYLES: Record<ProjectClassification, string> = {
  Aprovado: 'bg-green-500/15 text-green-400 border-green-500/30',
  'Aprovado com ressalvas': 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  'Requer revisão': 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  'Reprovado tecnicamente': 'bg-red-500/15 text-red-400 border-red-500/30',
}

interface Props {
  reports: ReportListItem[]
  onOpenReport: (report: ReportListItem) => void
  onPrint: (report: ReportListItem) => void
  onDownload: (report: ReportListItem) => void
  onShare: (report: ReportListItem) => void
  onEmail: (report: ReportListItem) => void
}

export function ReportTable({
  reports,
  onOpenReport,
  onPrint,
  onDownload,
  onShare,
  onEmail,
}: Props) {
  const navigate = useNavigate()

  return (
    <div className="bg-[#182233] border border-[#2A374A] rounded-lg overflow-x-auto">
      <table className="w-full text-sm min-w-[1100px]">
        <thead>
          <tr className="bg-[#1E293B] border-b border-[#2A374A] text-slate-300">
            <th className="text-left font-medium px-3 py-2.5">Data</th>
            <th className="text-left font-medium px-3 py-2.5">Projeto</th>
            <th className="text-left font-medium px-3 py-2.5">Cliente</th>
            <th className="text-left font-medium px-3 py-2.5">Pedido</th>
            <th className="text-left font-medium px-3 py-2.5">Perfil</th>
            <th className="text-left font-medium px-3 py-2.5">Arquivo</th>
            <th className="text-left font-medium px-3 py-2.5">Versão</th>
            <th className="text-left font-medium px-3 py-2.5">Resp.</th>
            <th className="text-left font-medium px-3 py-2.5">Resultado</th>
            <th className="text-center font-medium px-3 py-2.5">Crít.</th>
            <th className="text-center font-medium px-3 py-2.5">Aten.</th>
            <th className="text-left font-medium px-3 py-2.5">Status</th>
            <th className="px-3 py-2.5"></th>
          </tr>
        </thead>
        <tbody>
          {reports.map((r) => (
            <tr key={r.id} className="border-b border-[#2A374A]/50 hover:bg-white/5">
              <td className="px-3 py-2.5 text-slate-300 whitespace-nowrap">
                {formatDate(r.analysisDate)}
              </td>
              <td className="px-3 py-2.5">
                <button
                  onClick={() => navigate(`/projects/${r.projectId}`)}
                  className="font-medium text-slate-100 hover:text-blue-400 text-left"
                >
                  {r.projectName}
                </button>
              </td>
              <td className="px-3 py-2.5 text-slate-300">{r.clientName}</td>
              <td className="px-3 py-2.5 text-slate-300">{r.orderNumber}</td>
              <td className="px-3 py-2.5 text-slate-300">{r.productionProfile}</td>
              <td className="px-3 py-2.5 text-slate-400 max-w-[100px] truncate">{r.filename}</td>
              <td className="px-3 py-2.5">
                {r.currentVersionNumber ? (
                  <button
                    onClick={() => navigate(`/projects/${r.projectId}/versions`)}
                    className="text-blue-400 hover:underline"
                  >
                    v{r.currentVersionNumber}
                  </button>
                ) : (
                  <span className="text-slate-600">—</span>
                )}
              </td>
              <td className="px-3 py-2.5 text-slate-300">{r.responsibleName}</td>
              <td className="px-3 py-2.5">
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${CLS_STYLES[r.classification]}`}
                >
                  {r.classification}
                </span>
              </td>
              <td className="px-3 py-2.5 text-center">
                {r.criticalCount > 0 ? (
                  <span className="text-red-400 font-medium">{r.criticalCount}</span>
                ) : (
                  <span className="text-slate-500">0</span>
                )}
              </td>
              <td className="px-3 py-2.5 text-center">
                {r.attentionCount > 0 ? (
                  <span className="text-amber-400 font-medium">{r.attentionCount}</span>
                ) : (
                  <span className="text-slate-500">0</span>
                )}
              </td>
              <td className="px-3 py-2.5">
                <StatusBadge status={r.status} />
              </td>
              <td className="px-3 py-2.5">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-slate-400 hover:text-slate-200"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => onOpenReport(r)}>
                      <FileText className="h-3.5 w-3.5 mr-1.5" /> Abrir relatório
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => navigate(`/projects/${r.projectId}`)}>
                      <FolderOpen className="h-3.5 w-3.5 mr-1.5" /> Abrir projeto
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => navigate(`/projects/${r.projectId}/versions`)}>
                      <Layers className="h-3.5 w-3.5 mr-1.5" /> Ver versão analisada
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => onPrint(r)}>
                      <Printer className="h-3.5 w-3.5 mr-1.5" /> Imprimir
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onDownload(r)}>
                      <Download className="h-3.5 w-3.5 mr-1.5" /> Baixar
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onShare(r)}>
                      <Share2 className="h-3.5 w-3.5 mr-1.5" /> Compartilhar
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onEmail(r)}>
                      <Mail className="h-3.5 w-3.5 mr-1.5" /> Enviar por e-mail
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
