import { useState, useEffect } from 'react'
import { ArrowLeft, GitCompare, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatDate } from '@/lib/utils'
import { VersionStatusBadge } from './versionStatus'
import type { ProjectVersion } from '@/types'

interface VersionComparePanelProps {
  versions: ProjectVersion[]
  initialA?: string | null
  initialB?: string | null
  onBack: () => void
}

export function VersionComparePanel({
  versions,
  initialA,
  initialB,
  onBack,
}: VersionComparePanelProps) {
  const [selA, setSelA] = useState<string>('')
  const [selB, setSelB] = useState<string>('')

  useEffect(() => {
    setSelA(initialA || '')
    setSelB(initialB || '')
  }, [initialA, initialB])

  const verA = versions.find((v) => v.id === selA)
  const verB = versions.find((v) => v.id === selB)
  const noSelection = !selA || !selB
  const sameVersion = selA && selB && selA === selB

  const rows: { label: string; valA: string; valB: string }[] =
    verA && verB
      ? [
          { label: 'Arquivo', valA: verA.fileName, valB: verB.fileName },
          { label: 'Data', valA: formatDate(verA.createdAt), valB: formatDate(verB.createdAt) },
          { label: 'Responsável', valA: verA.responsibleName, valB: verB.responsibleName },
          {
            label: 'Críticos',
            valA: String(verA.problemSummary.critical),
            valB: String(verB.problemSummary.critical),
          },
          {
            label: 'Atenção',
            valA: String(verA.problemSummary.warning),
            valB: String(verB.problemSummary.warning),
          },
          {
            label: 'Informativos',
            valA: String(verA.problemSummary.info),
            valB: String(verB.problemSummary.info),
          },
          {
            label: 'Aprovados',
            valA: String(verA.problemSummary.approved),
            valB: String(verB.problemSummary.approved),
          },
          {
            label: 'Pendentes',
            valA: String(verA.problemSummary.pending),
            valB: String(verB.problemSummary.pending),
          },
        ]
      : []

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="text-xs gap-1.5 h-8 text-slate-600"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Voltar
        </Button>
      </div>
      <div className="bg-white border border-slate-200 rounded-lg p-4 mb-3">
        <div className="flex items-center gap-2 mb-3">
          <GitCompare className="h-4 w-4 text-slate-400" />
          <h3 className="text-sm font-semibold text-slate-800">Comparar versões</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] text-slate-400 uppercase mb-1 block">Versão A</label>
            <Select value={selA} onValueChange={setSelA}>
              <SelectTrigger className="text-xs h-8">
                <SelectValue placeholder="Selecionar versão A" />
              </SelectTrigger>
              <SelectContent>
                {versions.map((v) => (
                  <SelectItem key={v.id} value={v.id} className="text-xs">
                    Versão #{v.versionNumber}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-[10px] text-slate-400 uppercase mb-1 block">Versão B</label>
            <Select value={selB} onValueChange={setSelB}>
              <SelectTrigger className="text-xs h-8">
                <SelectValue placeholder="Selecionar versão B" />
              </SelectTrigger>
              <SelectContent>
                {versions.map((v) => (
                  <SelectItem key={v.id} value={v.id} className="text-xs">
                    Versão #{v.versionNumber}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
      {noSelection ? (
        <div className="flex flex-col items-center justify-center py-12 bg-white border border-slate-200 rounded-lg">
          <GitCompare className="h-8 w-8 text-slate-300 mb-2" />
          <p className="text-sm text-slate-400">Nenhuma versão selecionada para comparação</p>
          <p className="text-xs text-slate-300 mt-1">Selecione duas versões acima para comparar.</p>
        </div>
      ) : sameVersion ? (
        <div className="flex flex-col items-center justify-center py-12 bg-white border border-slate-200 rounded-lg">
          <AlertCircle className="h-8 w-8 text-amber-400 mb-2" />
          <p className="text-sm text-slate-400">Comparação inválida</p>
          <p className="text-xs text-slate-300 mt-1">Selecione duas versões diferentes.</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/50">
                <th className="text-left font-medium text-slate-500 px-3 py-2.5">Campo</th>
                <th className="text-left font-medium text-slate-500 px-3 py-2.5">
                  <div className="flex items-center gap-1.5">
                    <span>Versão #{verA?.versionNumber}</span>
                    {verA?.isCurrent && <span className="text-blue-500">★</span>}
                  </div>
                </th>
                <th className="text-left font-medium text-slate-500 px-3 py-2.5">
                  <div className="flex items-center gap-1.5">
                    <span>Versão #{verB?.versionNumber}</span>
                    {verB?.isCurrent && <span className="text-blue-500">★</span>}
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const diff = r.valA !== r.valB
                return (
                  <tr key={r.label} className="border-b border-slate-100">
                    <td className="px-3 py-2 text-slate-500">{r.label}</td>
                    <td
                      className={`px-3 py-2 ${diff ? 'bg-amber-50/50 text-slate-800 font-medium' : 'text-slate-600'}`}
                    >
                      {r.valA}
                    </td>
                    <td
                      className={`px-3 py-2 ${diff ? 'bg-amber-50/50 text-slate-800 font-medium' : 'text-slate-600'}`}
                    >
                      {r.valB}
                    </td>
                  </tr>
                )
              })}
              <tr className="border-b border-slate-100">
                <td className="px-3 py-2 text-slate-500">Status</td>
                <td className="px-3 py-2">{verA && <VersionStatusBadge status={verA.status} />}</td>
                <td className="px-3 py-2">{verB && <VersionStatusBadge status={verB.status} />}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
