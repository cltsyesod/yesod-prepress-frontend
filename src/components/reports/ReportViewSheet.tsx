import { useState, useEffect } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Printer, Download, Share2, Mail } from 'lucide-react'
import { ReportContent } from '@/components/projects/ReportContent'
import { EmailReportDialog } from '@/components/projects/EmailReportDialog'
import { useToast } from '@/hooks/use-toast'
import { projectService } from '@/services/projectService'
import { analysisService } from '@/services/analysisService'
import { versionService } from '@/services/versionService'
import { activityService } from '@/services/activityService'
import { calculateClassification } from '@/services/reportService'
import type { ReportListItem } from '@/services/reportService'
import type { Project, AnalysisProblem, ProjectVersion, ActivityEvent } from '@/types'

interface Props {
  report: ReportListItem | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ReportViewSheet({ report, open, onOpenChange }: Props) {
  const { toast } = useToast()
  const [project, setProject] = useState<Project | null>(null)
  const [problems, setProblems] = useState<AnalysisProblem[]>([])
  const [versions, setVersions] = useState<ProjectVersion[]>([])
  const [activities, setActivities] = useState<ActivityEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [showEmailDialog, setShowEmailDialog] = useState(false)

  useEffect(() => {
    if (!open || !report) return
    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        const p = await projectService.getProject(report.projectId)
        if (!p) {
          setLoading(false)
          return
        }
        setProject(p)
        setProblems(analysisService.getProblems(p))
        setVersions(versionService.getVersions(p.id, p))
        setActivities(activityService.listActivities(p.id, p))
      } catch {
        /* noop */
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [open, report])

  const classification = calculateClassification(problems)
  const currentVersion = versions.find((v) => v.isCurrent) || versions[versions.length - 1]

  const handleDownload = () =>
    toast({ title: 'Download simulado', description: 'O download do relatório é uma simulação.' })
  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      toast({ title: 'Link copiado', description: 'Link do relatório copiado.' })
    } catch {
      toast({ title: 'Não foi possível copiar' })
    }
  }
  const handleEmailSend = () => {
    toast({ title: 'E-mail enviado', description: 'Relatório enviado (simulação).' })
    setShowEmailDialog(false)
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="sm:max-w-[900px] w-full overflow-y-auto bg-[#0F172A] border-[#2A374A]">
          <SheetHeader>
            <SheetTitle className="text-slate-100">
              Relatório Técnico — {report?.projectName}
            </SheetTitle>
          </SheetHeader>
          <div className="flex flex-wrap gap-2 mt-4 mb-4 no-print">
            <Button onClick={() => window.print()} variant="outline" className="text-xs gap-1.5">
              <Printer className="h-3.5 w-3.5" /> Imprimir
            </Button>
            <Button onClick={handleDownload} variant="outline" className="text-xs gap-1.5">
              <Download className="h-3.5 w-3.5" /> Baixar
            </Button>
            <Button onClick={handleShare} variant="outline" className="text-xs gap-1.5">
              <Share2 className="h-3.5 w-3.5" /> Compartilhar
            </Button>
            <Button
              onClick={() => setShowEmailDialog(true)}
              variant="outline"
              className="text-xs gap-1.5"
            >
              <Mail className="h-3.5 w-3.5" /> E-mail
            </Button>
          </div>
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-32 w-full rounded-lg" />
              <Skeleton className="h-48 w-full rounded-lg" />
              <Skeleton className="h-32 w-full rounded-lg" />
            </div>
          ) : project ? (
            <ReportContent
              project={project}
              problems={problems}
              currentVersion={currentVersion}
              activities={activities}
              classification={classification}
            />
          ) : (
            <p className="text-sm text-slate-400">Projeto não encontrado.</p>
          )}
        </SheetContent>
      </Sheet>
      {report && (
        <EmailReportDialog
          open={showEmailDialog}
          onOpenChange={setShowEmailDialog}
          projectName={report.projectName}
          onSend={handleEmailSend}
        />
      )}
    </>
  )
}
