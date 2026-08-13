import { useEffect, useState, useCallback } from 'react'
import { Layers, AlertCircle, RotateCcw, Inbox, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import { versionService } from '@/services/versionService'
import { activityService } from '@/services/activityService'
import { VersionList } from '@/components/projects/versions/VersionList'
import { AddVersionDialog } from '@/components/projects/versions/AddVersionDialog'
import { VersionDetailPanel } from '@/components/projects/versions/VersionDetailPanel'
import { VersionComparePanel } from '@/components/projects/versions/VersionComparePanel'
import type { Project, ProjectVersion, ActivityEvent } from '@/types'

interface VersionsTabProps {
  project: Project
}

type View = 'list' | 'detail' | 'compare'

export function VersionsTab({ project }: VersionsTabProps) {
  const [versions, setVersions] = useState<ProjectVersion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [view, setView] = useState<View>('list')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [compareA, setCompareA] = useState<string | null>(null)
  const [compareB, setCompareB] = useState<string | null>(null)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const { toast } = useToast()

  const loadVersions = useCallback(() => {
    setLoading(true)
    setError(false)
    const timer = setTimeout(() => {
      try {
        const v = versionService.getVersions(project.id, project)
        setVersions(v)
        setLoading(false)
      } catch {
        setError(true)
        setLoading(false)
      }
    }, 400)
    return () => clearTimeout(timer)
  }, [project.id, project])

  useEffect(() => {
    return loadVersions()
  }, [loadVersions])

  const handleAddVersion = (data: import('@/types').AddVersionData) => {
    const newVer = versionService.addVersion(project.id, data, project)
    const updated = versionService.getVersions(project.id, project)
    setVersions(updated)
    const event: ActivityEvent = {
      id: `act-${project.id}-${Date.now()}`,
      type: 'upload',
      projectId: project.id,
      userId: data.responsibleId,
      message: `Versão #${newVer.versionNumber} adicionada: ${data.fileName}`,
      timestamp: new Date().toISOString(),
    }
    activityService.addActivity(project.id, event)
    toast({
      title: 'Versão adicionada',
      description: `Versão #${newVer.versionNumber} criada com sucesso.`,
    })
  }

  const handleSetCurrent = (versionId: string) => {
    const updated = versionService.setCurrentVersion(project.id, versionId)
    setVersions(updated)
    const v = updated.find((x) => x.id === versionId)
    const event: ActivityEvent = {
      id: `act-${project.id}-${Date.now()}`,
      type: 'status_change',
      projectId: project.id,
      userId: project.responsibleId,
      message: `Versão #${v?.versionNumber} definida como versão atual`,
      timestamp: new Date().toISOString(),
    }
    activityService.addActivity(project.id, event)
    toast({
      title: 'Versão atual atualizada',
      description: `Versão #${v?.versionNumber} é agora a versão atual.`,
    })
  }

  const handleOpenVersion = (id: string) => {
    setSelectedId(id)
    setView('detail')
  }

  const handleCompare = (id?: string) => {
    if (id) {
      setCompareA(id)
      setCompareB(null)
    }
    setView('compare')
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="flex justify-between">
          <Skeleton className="h-6 w-32 rounded" />
          <Skeleton className="h-8 w-32 rounded" />
        </div>
        <Skeleton className="h-10 w-full rounded-lg" />
        <Skeleton className="h-32 w-full rounded-lg" />
        <Skeleton className="h-32 w-full rounded-lg" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4 text-center bg-white border border-slate-200 rounded-lg">
        <div className="p-3 bg-red-50 rounded-full mb-3 text-red-500">
          <AlertCircle className="h-8 w-8" />
        </div>
        <h3 className="text-base font-semibold text-slate-800 mb-1">Erro ao carregar versões</h3>
        <p className="text-sm text-slate-500 max-w-sm mb-4">
          Ocorreu um erro ao carregar as versões do projeto.
        </p>
        <Button onClick={() => loadVersions()} variant="outline" className="text-xs gap-1.5">
          <RotateCcw className="h-3.5 w-3.5" /> Tentar novamente
        </Button>
      </div>
    )
  }

  const selectedVersion = versions.find((v) => v.id === selectedId)

  if (view === 'detail') {
    if (!selectedVersion) {
      return (
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center bg-white border border-slate-200 rounded-lg">
          <div className="p-3 bg-slate-100 rounded-full mb-3 text-slate-500">
            <Layers className="h-8 w-8" />
          </div>
          <h3 className="text-base font-semibold text-slate-800 mb-1">Versão não encontrada</h3>
          <Button onClick={() => setView('list')} variant="outline" className="text-xs mt-3">
            Voltar para lista
          </Button>
        </div>
      )
    }
    return (
      <VersionDetailPanel
        version={selectedVersion}
        hasPrevious={selectedVersion.versionNumber > 1}
        onBack={() => setView('list')}
        onSetCurrent={() => {
          handleSetCurrent(selectedVersion.id)
          setView('list')
        }}
      />
    )
  }

  if (view === 'compare') {
    return (
      <VersionComparePanel
        versions={versions}
        initialA={compareA}
        initialB={compareB}
        onBack={() => setView('list')}
      />
    )
  }

  if (versions.length === 0) {
    return (
      <>
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center bg-white border border-slate-200 rounded-lg">
          <div className="p-3 bg-slate-100 rounded-full mb-3 text-slate-500">
            <Inbox className="h-8 w-8" />
          </div>
          <h3 className="text-base font-semibold text-slate-800 mb-1">Nenhuma versão encontrada</h3>
          <p className="text-sm text-slate-500 max-w-sm mb-4">
            Este projeto ainda não possui versões de arquivo.
          </p>
          <Button
            onClick={() => setShowAddDialog(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white text-xs gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" /> Adicionar primeira versão
          </Button>
        </div>
        <AddVersionDialog
          open={showAddDialog}
          onOpenChange={setShowAddDialog}
          nextVersionNumber={1}
          defaultResponsibleId={project.responsibleId}
          defaultResponsibleName={project.responsibleName}
          defaultFileName={project.filename}
          onAdd={handleAddVersion}
        />
      </>
    )
  }

  const nextNumber = Math.max(...versions.map((v) => v.versionNumber)) + 1

  return (
    <>
      <VersionList
        versions={versions}
        onOpenVersion={handleOpenVersion}
        onSetCurrent={handleSetCurrent}
        onCompare={(id) => handleCompare(id)}
        onAddVersion={() => setShowAddDialog(true)}
      />
      <AddVersionDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        nextVersionNumber={nextNumber}
        defaultResponsibleId={project.responsibleId}
        defaultResponsibleName={project.responsibleName}
        defaultFileName={project.filename}
        onAdd={handleAddVersion}
      />
    </>
  )
}
