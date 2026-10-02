import type { Project, WizardData, Client } from '@/types'
import { MOCK_USERS, WIZARD_PROFILES } from '@/services/mockData'

export const ACCEPTED_EXTENSIONS = ['pdf']
export const MAX_FILE_SIZE = 100 * 1024 * 1024

export const initialWizardData: WizardData = {
  name: '',
  clientId: '',
  orderNumber: '',
  responsibleId: '',
  deadline: '',
  description: '',
  observations: '',
  tags: [],
  productionProfileId: '',
  customProfileName: '',
  files: [],
}

export function buildProject(
  data: WizardData,
  clients: Client[],
  status: 'draft' | 'analyzing',
): Partial<Project> {
  const client = clients.find((c) => c.id === data.clientId)
  const user = MOCK_USERS.find((u) => u.id === data.responsibleId)
  const profile = WIZARD_PROFILES.find((p) => p.id === data.productionProfileId)
  const completedFiles = data.files.filter((f) => f.status === 'completed' || f.status === 'selected')
  const firstFile = completedFiles[0]
  const profileName = profile?.isCustom ? data.customProfileName : profile?.name

  return {
    name: data.name || 'Novo Projeto',
    clientId: data.clientId || 'cli-default',
    clientName: client?.name || client?.company || 'Cliente',
    status,
    severity: 'none',
    issueCount: 0,
    orderNumber: data.orderNumber || `PED-2026-${String(Math.floor(Math.random() * 9000) + 1000)}`,
    filename: firstFile?.name || 'arquivo.pdf',
    fileType: firstFile?.extension || 'PDF',
    fileSize: completedFiles.reduce((sum, f) => sum + f.size, 0),
    productionProfile: profileName || 'Personalizado',
    productionType: profileName || 'Personalizado',
    responsibleId: data.responsibleId || 'usr-1',
    responsibleName: user?.name || 'Usuário',
    deadline: data.deadline
      ? new Date(data.deadline + 'T18:00:00').toISOString()
      : new Date(Date.now() + 14 * 86400000).toISOString(),
    description: data.description || '',
    observations: data.observations || '',
    tags: data.tags || [],
    files: completedFiles.map((f) => f.name),
  }
}
