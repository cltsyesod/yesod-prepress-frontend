import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Inbox, AlertCircle, RotateCcw, FileText } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { ReportIndicators } from '@/components/reports/ReportIndicators'
import { ReportFilters } from '@/components/reports/ReportFilters'
import { ReportTable } from '@/components/reports/ReportTable'
import { ReportViewSheet } from '@/components/reports/ReportViewSheet'
import { useToast } from '@/hooks/use-toast'
import { reportService, DEFAULT_REPORT_FILTERS } from '@/services/reportService'
import type { ReportListItem, ReportFilters as Filters } from '@/services/reportService'

export default function ReportsPage() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const [reports, setReports] = useState<ReportListItem[]>([])
  const [filtered, setFiltered] = useState<ReportListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [filters, setFilters] = useState<Filters>(DEFAULT_REPORT_FILTERS)
  const [selectedReport, setSelectedReport] = useState<ReportListItem | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError(false)
      try {
        const data = await reportService.listReports()
        setReports(data)
      } catch {
        setError(true)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  useEffect(() => {
    setFiltered(reportService.filterReports(reports, filters))
  }, [reports, filters])

  const handleFilterChange = useCallback((key: keyof Filters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }))
  }, [])

  const handleClear = useCallback(() => setFilters(DEFAULT_REPORT_FILTERS), [])

  const handleIndicatorClick = useCallback((result: string) => {
    setFilters((prev) => ({ ...prev, result }))
  }, [])

  const handleOpenReport = useCallback((r: ReportListItem) => {
    setSelectedReport(r)
    setSheetOpen(true)
  }, [])

  const handlePrint = useCallback(
    (r: ReportListItem) => {
      navigate(`/projects/${r.projectId}/report`)
    },
    [navigate],
  )

  const handleDownload = useCallback(
    (_r: ReportListItem) => {
      toast({
        title: 'Download simulado',
        description: 'O download do relatório é uma simulação. Nenhum arquivo real foi gerado.',
      })
    },
    [toast],
  )

  const handleShare = useCallback(
    async (_r: ReportListItem) => {
      try {
        await navigator.clipboard.writeText(window.location.href)
        toast({ title: 'Link copiado', description: 'Link do relatório copiado.' })
      } catch {
        toast({
          title: 'Não foi possível copiar',
          description: 'Copie manualmente o link da página.',
        })
      }
    },
    [toast],
  )

  const handleEmail = useCallback(
    (r: ReportListItem) => {
      toast({
        title: 'E-mail enviado',
        description: `Relatório de "${r.projectName}" enviado (simulação).`,
      })
    },
    [toast],
  )

  const indicators = reportService.getIndicators(filtered)

  return (
    <div>
      <PageHeader
        title="Central de Relatórios"
        breadcrumbs={[{ label: 'Home', href: '/dashboard' }, { label: 'Relatórios' }]}
      />

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center bg-[#182233] border border-[#2A374A] rounded-lg">
          <AlertCircle className="h-8 w-8 text-red-400 mb-3" />
          <h3 className="text-base font-semibold text-slate-200 mb-1">
            Erro ao carregar relatórios
          </h3>
          <p className="text-sm text-slate-400 max-w-sm mb-4">
            Ocorreu um erro ao carregar os relatórios técnicos.
          </p>
          <Button
            onClick={() => window.location.reload()}
            variant="outline"
            className="text-xs gap-1.5"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Tentar novamente
          </Button>
        </div>
      ) : reports.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center bg-[#182233] border border-[#2A374A] rounded-lg">
          <div className="p-3 bg-slate-500/10 rounded-full mb-3 text-slate-400">
            <FileText className="h-8 w-8" />
          </div>
          <h3 className="text-base font-semibold text-slate-200 mb-1">
            Nenhum relatório disponível
          </h3>
          <p className="text-sm text-slate-400 max-w-sm">
            Relatórios técnicos aparecerão aqui após a conclusão de análises de pré-impressão.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <ReportIndicators
            indicators={indicators}
            onIndicatorClick={handleIndicatorClick}
            activeFilter={filters.result}
          />
          <ReportFilters
            filters={filters}
            onFilterChange={handleFilterChange}
            onClear={handleClear}
          />
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center bg-[#182233] border border-[#2A374A] rounded-lg">
              <Inbox className="h-6 w-6 text-slate-500 mb-2" />
              <p className="text-sm text-slate-400">
                Nenhum relatório encontrado com os filtros selecionados.
              </p>
              <Button
                onClick={handleClear}
                variant="ghost"
                size="sm"
                className="text-xs mt-3 text-slate-400 hover:text-slate-200"
              >
                Limpar filtros
              </Button>
            </div>
          ) : (
            <ReportTable
              reports={filtered}
              onOpenReport={handleOpenReport}
              onPrint={handlePrint}
              onDownload={handleDownload}
              onShare={handleShare}
              onEmail={handleEmail}
            />
          )}
        </div>
      )}

      <ReportViewSheet report={selectedReport} open={sheetOpen} onOpenChange={setSheetOpen} />
    </div>
  )
}
