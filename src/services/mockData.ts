import type { User, Client, RecurringIssue, WizardProfile } from '@/types'

export const MOCK_USERS: User[] = [
  {
    id: 'usr-1',
    name: 'Usuário Demo',
    email: 'demo@yesodautomation.com',
    company: 'Yesod Automation',
    plan: 'Plano Profissional',
    role: 'Administrador',
  },
  {
    id: 'usr-2',
    name: 'Carla Mendes',
    email: 'carla@yesodautomation.com',
    company: 'Yesod Automation',
    plan: 'Plano Profissional',
    role: 'Designer',
  },
  {
    id: 'usr-3',
    name: 'Rafael Souza',
    email: 'rafael@yesodautomation.com',
    company: 'Yesod Automation',
    plan: 'Plano Profissional',
    role: 'Analista de Pré-impressão',
  },
  {
    id: 'usr-4',
    name: 'Juliana Castro',
    email: 'juliana@yesodautomation.com',
    company: 'Yesod Automation',
    plan: 'Plano Profissional',
    role: 'Coordenadora de Produção',
  },
]

export const MOCK_CLIENTS: Client[] = [
  {
    id: 'cli-1',
    name: 'Moda Express Ltda',
    company: 'Moda Express Ltda',
    email: 'contato@modaexpress.com',
    phone: '(11) 3333-4400',
  },
  {
    id: 'cli-2',
    name: 'NutriBio Alimentos',
    company: 'NutriBio Alimentos',
    email: 'producao@nutribio.com',
    phone: '(11) 4444-5500',
  },
  {
    id: 'cli-3',
    name: 'Coração Literário',
    company: 'Coração Literário',
    email: 'editora@coracaoliterario.com',
    phone: '(21) 5555-6600',
  },
  {
    id: 'cli-4',
    name: 'TechZone Eletrônicos',
    company: 'TechZone Eletrônicos',
    email: 'marketing@techzone.com',
    phone: '(11) 6666-7700',
  },
  {
    id: 'cli-5',
    name: 'Pão Dourado',
    company: 'Pão Dourado',
    email: 'pedidos@paodourado.com',
    phone: '(31) 7777-8800',
  },
  {
    id: 'cli-6',
    name: 'Studio Aurora Design',
    company: 'Studio Aurora Design',
    email: 'contato@studioaurora.com',
    phone: '(11) 8888-9900',
  },
]

export const MOCK_PROFILES: { id: string; name: string }[] = [
  { id: 'pp-1', name: 'Offset 4x4 - Cores' },
  { id: 'pp-2', name: 'Offset 1x1 - Preto e Branco' },
  { id: 'pp-3', name: 'Flexografia' },
  { id: 'pp-4', name: 'Digital Grand Formato' },
  { id: 'pp-5', name: 'Serigrafia' },
  { id: 'pp-6', name: 'Hot Stamping' },
  { id: 'pp-7', name: 'Digital Pequeno Formato' },
]

export const WIZARD_PROFILES: WizardProfile[] = [
  {
    id: 'wp-1',
    name: 'Gráfica offset',
    corEsperada: 'CMYK',
    resolucaoMinima: '300 dpi',
    sangria: '3 mm',
    escala: '1:1',
    layerCorte: 'Não',
  },
  {
    id: 'wp-2',
    name: 'Impressão digital',
    corEsperada: 'CMYK',
    resolucaoMinima: '300 dpi',
    sangria: '3 mm',
    escala: '1:1',
    layerCorte: 'Não',
  },
  {
    id: 'wp-3',
    name: 'Comunicação visual',
    corEsperada: 'CMYK',
    resolucaoMinima: '150 dpi',
    sangria: '5 mm',
    escala: '1:1',
    layerCorte: 'Não',
  },
  {
    id: 'wp-4',
    name: 'Adesivo com recorte',
    corEsperada: 'CMYK',
    resolucaoMinima: '300 dpi',
    sangria: '3 mm',
    escala: '1:1',
    layerCorte: 'Sim',
  },
  {
    id: 'wp-5',
    name: 'Lona',
    corEsperada: 'CMYK',
    resolucaoMinima: '150 dpi',
    sangria: '5 mm',
    escala: '1:1',
    layerCorte: 'Não',
  },
  {
    id: 'wp-6',
    name: 'Backlight',
    corEsperada: 'CMYK',
    resolucaoMinima: '300 dpi',
    sangria: '5 mm',
    escala: '1:1',
    layerCorte: 'Não',
  },
  {
    id: 'wp-7',
    name: 'Embalagem',
    corEsperada: 'CMYK',
    resolucaoMinima: '300 dpi',
    sangria: '3 mm',
    escala: '1:1',
    layerCorte: 'Sim',
  },
  {
    id: 'wp-custom',
    name: 'Perfil personalizado',
    corEsperada: '—',
    resolucaoMinima: '—',
    sangria: '—',
    escala: '—',
    layerCorte: '—',
    isCustom: true,
  },
]

export const RECURRING_ISSUES: RecurringIssue[] = [
  { name: 'Baixa resolução de imagem', count: 8, severity: 'critical' },
  { name: 'Ausência de sangria', count: 6, severity: 'warning' },
  { name: 'Arquivo em RGB', count: 5, severity: 'warning' },
  { name: 'Fontes não convertidas', count: 4, severity: 'warning' },
  { name: 'Layer de corte ausente', count: 3, severity: 'critical' },
  { name: 'Sangria inferior a 3mm', count: 2, severity: 'info' },
]

export const FILE_TYPES = ['PDF', 'AI', 'PSD', 'INDD', 'EPS']

export const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'Todos os status' },
  { value: 'active', label: 'Ativo' },
  { value: 'pending_analysis', label: 'Aguardando Análise' },
  { value: 'pending_approval', label: 'Aguardando Aprovação' },
  { value: 'approved', label: 'Aprovado' },
  { value: 'completed', label: 'Concluído' },
  { value: 'failed', label: 'Falhou' },
  { value: 'paused', label: 'Pausado' },
  { value: 'archived', label: 'Arquivado' },
  { value: 'draft', label: 'Rascunho' },
  { value: 'analyzing', label: 'Analisando' },
  { value: 'needs_review', label: 'Requer Revisão' },
]

export const SEVERITY_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'Toda criticidade' },
  { value: 'critical', label: 'Crítico' },
  { value: 'warning', label: 'Atenção' },
  { value: 'info', label: 'Informativo' },
  { value: 'none', label: 'Sem issues' },
]

export const PERIOD_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'Todos os períodos' },
  { value: '7d', label: 'Últimos 7 dias' },
  { value: '30d', label: 'Últimos 30 dias' },
  { value: '90d', label: 'Últimos 3 meses' },
]

export const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: 'recent', label: 'Mais recente' },
  { value: 'oldest', label: 'Mais antigo' },
  { value: 'deadline', label: 'Prazo' },
  { value: 'name', label: 'Nome (A-Z)' },
  { value: 'severity', label: 'Criticidade' },
]
