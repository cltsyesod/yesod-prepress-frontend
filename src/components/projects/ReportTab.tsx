import { useState, useEffect } from 'react'
import { Printer, Download, Share2, Mail, AlertCircle, RotateCcw, FileSearch } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import { analysisService } from '@/services/analysisService'
import { versionService } from '@/services/versionService'
import { activityService } from '@/services/activityService'
import { calculateClassification } from '@/services/reportService'
import { ReportContent } from './ReportContent'
import { EmailReportDialog } from './EmailReportDialog'
import type { Project, AnalysisProblem, ProjectVersion, ActivityEvent } from '@/types'

interface ReportTabProps {
  project: Project
}

export function ReportTab({ project }: ReportTabProps) {
  const { toast } = useToast()
  const [problems, setProblems] = useState<AnalysisProblem[]>([])
  const [versions, setVersions] = useState<ProjectVersion[]>([])
  const [activities, setActivities] = useState<ActivityEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [showEmailDialog, setShowEmailDialog] = useState(false)

  const hasAnalysis = !['draft', 'pending_analysis'].includes(project.status)

  useEffect(() => {
    if (!hasAnalysis) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(false)
    const timer = setTimeout(() => {
      try {
        setProblems(analysisService.getProblems(project))
        setVersions(versionService.getVersions(project.id, project))
        setActivities(activityService.listActivities(project.id, project))
        setLoading(false)
      } catch {
        setError(true)
        setLoading(false)
      }
    }, 500)
    return () => clearTimeout(timer)
  }, [project.id, project.updatedAt, hasAnalysis, project])

  const classification = calculateClassification(problems)
  const currentVersion = versions.find((v) => v.isCurrent) || versions[versions.length - 1]

  const handlePrint = () => window.print()

  const handleDownload = () => {
    toast({
      title: 'Download simulado',
      description: 'O download do relatório é uma simulação. Nenhum arquivo real foi gerado.',
    })
  }

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      toast({
        title: 'Link copiado',
        description: 'Link do relatório copiado para a área de transferência.',
      })
    } catch {
      toast({
        title: 'Não foi possível copiar',
        description: 'Copie manualmente o link da página.',
      })
    }
  }

  const handleEmailSend = () => {
    toast({
      title: 'E-mail enviado',
      description: 'O relatório foi enviado por e-mail (simulação).',
    })
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full rounded-lg" />
        <Skeleton className="h-32 w-full rounded-lg" />
        <Skeleton className="h-48 w-full rounded-lg" />
        <Skeleton className="h-32 w-full rounded-lg" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4 text-center bg-[#182233] border border-[#2A374A] rounded-lg">
        <div className="p-3 bg-red-500/10 rounded-full mb-3 text-red-400">
          <AlertCircle className="h-8 w-8" />
        </div>
        <h3 className="text-base font-semibold text-slate-200 mb-1">Erro ao carregar relatório</h3>
        <p className="text-sm text-slate-400 max-w-sm mb-4">
          Ocorreu um erro ao gerar o relatório.
        </p>
        <Button
          onClick={() => {
            setLoading(true)
            setError(false)
          }}
          variant="outline"
          className="text-xs gap-1.5"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Tentar novamente
        </Button>
      </div>
    )
  }

  if (!hasAnalysis) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4 text-center bg-[#182233] border border-[#2A374A] rounded-lg">
        <div className="p-3 bg-slate-500/10 rounded-full mb-3 text-slate-400">
          <FileSearch className="h-8 w-8" />
        </div>
        <h3 className="text-base font-semibold text-slate-200 mb-1">
          Nenhuma análise técnica concluída
        </h3>
        <p className="text-sm text-slate-400 max-w-sm">
          O relatório estará disponível após a conclusão da análise técnica.
        </p>
      </div>
    )
  }

  return (
    <>
      <div className="no-print flex flex-wrap gap-2 mb-4">
        <Button onClick={handlePrint} variant="outline" className="text-xs gap-1.5">
          <Printer className="h-3.5 w-3.5" /> Imprimir
        </Button>
        <Button onClick={handleDownload} variant="outline" className="text-xs gap-1.5">
          <Download className="h-3.5 w-3.5" /> Baixar relatório
        </Button>
        <Button onClick={handleShare} variant="outline" className="text-xs gap-1.5">
          <Share2 className="h-3.5 w-3.5" /> Compartilhar
        </Button>
        <Button
          onClick={() => setShowEmailDialog(true)}
          variant="outline"
          className="text-xs gap-1.5"
        >
          <Mail className="h-3.5 w-3.5" /> Enviar por e-mail
        </Button>
      </div>
      <ReportContent
        project={project}
        problems={problems}
        currentVersion={currentVersion}
        activities={activities}
        classification={classification}
      />
      <EmailReportDialog
        open={showEmailDialog}
        onOpenChange={setShowEmailDialog}
        projectName={project.name}
        onSend={handleEmailSend}
      />
    </>
  )
}
