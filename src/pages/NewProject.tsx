import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Loader2, ArrowLeft, ArrowRight, Save, FileCheck, X } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { projectService } from '@/services/projectService'
import { profileService } from '@/services/profileService'
import { MOCK_CLIENTS } from '@/services/mockData'
import { WizardStepper } from '@/components/projects/WizardStepper'
import { StepInformacoes } from '@/components/projects/StepInformacoes'
import { StepProducao } from '@/components/projects/StepProducao'
import { StepArquivos } from '@/components/projects/StepArquivos'
import { StepRevisao } from '@/components/projects/StepRevisao'
import { NewClientModal } from '@/components/projects/NewClientModal'
import { initialWizardData, buildProject } from '@/lib/wizard'
import type { WizardData, UploadedFile, Client } from '@/types'

export default function NewProjectPage() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const [step, setStep] = useState(1)
  const [data, setData] = useState<WizardData>(initialWizardData)
  const [clients, setClients] = useState<Client[]>(MOCK_CLIENTS)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [showCancel, setShowCancel] = useState(false)
  const [showNewClient, setShowNewClient] = useState(false)
  const [processing, setProcessing] = useState(false)

  const updateData = (updates: Partial<WizardData>) => setData((prev) => ({ ...prev, ...updates }))
  const updateFiles = (updater: (prev: UploadedFile[]) => UploadedFile[]) =>
    setData((prev) => ({ ...prev, files: updater(prev.files) }))

  const validateStep = (): boolean => {
    const e: Record<string, string> = {}
    if (step === 1) {
      if (!data.name.trim()) e.name = 'Campo obrigatório'
      if (!data.clientId) e.clientId = 'Campo obrigatório'
      if (!data.responsibleId) e.responsibleId = 'Campo obrigatório'
      if (!data.deadline) e.deadline = 'Campo obrigatório'
      else if (new Date(data.deadline) <= new Date(new Date().toDateString()))
        e.deadline = 'A data deve ser no futuro'
    }
    if (step === 2) {
      if (!data.productionProfileId) e.productionProfileId = 'Selecione um perfil'
      if (data.productionProfileId === 'wp-custom' && !data.customProfileName.trim())
        e.customProfileName = 'Campo obrigatório'
    }
    if (step === 3) {
      if (!data.files.some((f) => f.status === 'completed'))
        e.files = 'Envie pelo menos um arquivo válido'
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleNext = () => {
    if (validateStep() && step < 4) setStep(step + 1)
  }
  const handleBack = () => {
    if (step > 1) {
      setStep(step - 1)
      setErrors({})
    }
  }

  const handleSaveDraft = async () => {
    const project = buildProject(data, clients, 'draft')
    const profiles = profileService.getProfilesSync()
    const prof = profiles.find((p) => p.id === data.productionProfileId)
    if (prof) {
      project.productionProfile = prof.name
      project.productionType = prof.category
      project.profileId = prof.id
    }
    await projectService.createProject(project)
    toast({ title: 'Rascunho salvo', description: 'O projeto foi salvo como rascunho.' })
    navigate('/projects')
  }

  const handleCreate = async () => {
    const project = buildProject(data, clients, 'analyzing')
    const profiles = profileService.getProfilesSync()
    const prof = profiles.find((p) => p.id === data.productionProfileId)
    if (prof) {
      project.productionProfile = prof.name
      project.productionType = prof.category
      project.profileId = prof.id
    }
    const created = await projectService.createProject(project)
    setProcessing(true)
    setTimeout(async () => {
      await projectService.updateProject(created.id, { status: 'needs_review' })
      setProcessing(false)
      navigate(`/projects/${created.id}`)
    }, 3000)
  }

  const addClient = (client: Client) => {
    setClients((prev) => [...prev, client])
    updateData({ clientId: client.id })
  }

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Novo Projeto"
        breadcrumbs={[
          { label: 'Home', href: '/dashboard' },
          { label: 'Projetos', href: '/projects' },
          { label: 'Novo' },
        ]}
      />

      <WizardStepper currentStep={step} />

      <div className="mb-4">
        {step === 1 && (
          <StepInformacoes
            data={data}
            updateData={updateData}
            clients={clients}
            onNewClient={() => setShowNewClient(true)}
            errors={errors}
          />
        )}
        {step === 2 && <StepProducao data={data} updateData={updateData} errors={errors} />}
        {step === 3 && <StepArquivos data={data} updateFiles={updateFiles} errors={errors} />}
        {step === 4 && (
          <StepRevisao
            data={data}
            clients={clients}
            onEdit={(s) => {
              setStep(s)
              setErrors({})
            }}
          />
        )}
      </div>

      <div className="flex items-center justify-between gap-2 pt-4 border-t border-slate-200">
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowCancel(true)} className="text-xs gap-1.5">
            <X className="h-3.5 w-3.5" /> Cancelar
          </Button>
          <Button variant="outline" onClick={handleSaveDraft} className="text-xs gap-1.5">
            <Save className="h-3.5 w-3.5" /> Salvar como rascunho
          </Button>
        </div>
        <div className="flex gap-2">
          {step > 1 && (
            <Button variant="outline" onClick={handleBack} className="text-xs gap-1.5">
              <ArrowLeft className="h-3.5 w-3.5" /> Voltar
            </Button>
          )}
          {step < 4 && (
            <Button
              onClick={handleNext}
              className="bg-blue-600 hover:bg-blue-700 text-white text-xs gap-1.5"
            >
              Avançar <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          )}
          {step === 4 && (
            <Button
              onClick={handleCreate}
              className="bg-blue-600 hover:bg-blue-700 text-white text-xs gap-1.5"
            >
              <FileCheck className="h-3.5 w-3.5" /> Criar projeto e iniciar análise
            </Button>
          )}
        </div>
      </div>

      <Dialog open={showCancel} onOpenChange={setShowCancel}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancelar criação</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-600">
            Tem certeza que deseja cancelar? Os dados preenchidos serão perdidos.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCancel(false)} className="text-xs">
              Continuar
            </Button>
            <Button variant="destructive" onClick={() => navigate('/projects')} className="text-xs">
              Sim, cancelar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <NewClientModal open={showNewClient} onOpenChange={setShowNewClient} onAdd={addClient} />

      {processing && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-white rounded-lg p-8 flex flex-col items-center gap-4">
            <Loader2 className="h-12 w-12 animate-spin text-blue-600" />
            <p className="text-sm font-medium text-slate-700">Analisando arquivos...</p>
          </div>
        </div>
      )}
    </div>
  )
}
