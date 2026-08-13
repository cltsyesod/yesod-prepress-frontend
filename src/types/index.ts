import type { ComponentType } from 'react'

export type ProjectStatus =
  | 'active'
  | 'completed'
  | 'paused'
  | 'archived'
  | 'pending_analysis'
  | 'pending_approval'
  | 'approved'
  | 'failed'
  | 'draft'
  | 'analyzing'
  | 'needs_review'

export type Severity = 'critical' | 'warning' | 'info' | 'none'

export type ProfileStatus = 'active' | 'inactive'

export interface TechnicalRule {
  key: string
  label: string
  enabled: boolean
  severity: Severity
}

export interface User {
  id: string
  name: string
  email: string
  avatarUrl?: string
  company: string
  plan: string
  role: string
}

export interface Client {
  id: string
  name: string
  company: string
  email: string
  phone?: string
}

export interface Project {
  id: string
  name: string
  clientId: string
  clientName: string
  status: ProjectStatus
  severity: Severity
  issueCount: number
  createdAt: string
  updatedAt: string
  deadline: string
  description: string
  filename: string
  fileType: string
  fileSize: number
  productionProfile: string
  profileId?: string
  productionType: string
  responsibleId: string
  responsibleName: string
  orderNumber: string
  observations?: string
  tags?: string[]
  files?: string[]
}

export interface WizardProfile {
  id: string
  name: string
  corEsperada: string
  resolucaoMinima: string
  sangria: string
  escala: string
  layerCorte: string
  isCustom?: boolean
}

export interface UploadedFile {
  id: string
  name: string
  extension: string
  size: number
  status: 'waiting' | 'uploading' | 'completed' | 'error' | 'unsupported' | 'too_large' | 'selected'
  progress: number
  rawFile?: File
}

export type ProjectFileStatus =
  | 'pending'
  | 'uploading'
  | 'uploaded'
  | 'validating'
  | 'ready_for_analysis'
  | 'failed'
  | 'removed'

export interface ProjectFile {
  id: string
  project: string
  version: string
  original_name: string
  safe_name: string
  extension: string
  mime_type: string
  size_bytes: number
  sha256: string
  user: string
  storage_path: string
  status: ProjectFileStatus
  error: string
  is_primary: boolean
  file: string
  created: string
  updated: string
}

export interface WizardData {
  name: string
  clientId: string
  orderNumber: string
  responsibleId: string
  deadline: string
  description: string
  observations: string
  tags: string[]
  productionProfileId: string
  customProfileName: string
  files: UploadedFile[]
}

export interface ProductionProfile {
  id: string
  name: string
  description: string
  status: ProfileStatus
  category: string
  allowedFormats: string[]
  colorMode: string
  iccProfile: string
  minResolution: number
  blackConfig: string
  inkCoverageLimit: number
  minBleed: number
  safetyMargin: number
  scale: string
  cropMarks: boolean
  cutLayerRequired: boolean
  cutLayerName: string
  cutLayerColor: string
  specialFinishes: string
  rules: TechnicalRule[]
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

export interface DashboardMetrics {
  total: number
  pendingAnalysis: number
  requiresAttention: number
  pendingApproval: number
  approved: number
  filesProcessed: number
}

export interface RecurringIssue {
  name: string
  count: number
  severity: Severity
}

export interface MetricConfig {
  key: keyof DashboardMetrics
  title: string
  context: string
  icon: ComponentType<{ className?: string }>
  link: string
  linkLabel: string
}

export interface QuickAction {
  label: string
  icon: ComponentType<{ className?: string }>
  to: string
}

export interface AnalysisIssue {
  id: string
  severity: Severity
  category: string
  message: string
  page?: number
  element?: string
}

export interface AnalysisResult {
  id: string
  projectId: string
  fileId: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  issues: AnalysisIssue[]
  summary: string
  createdAt: string
}

export type VersionStatus =
  | 'em_analise'
  | 'requer_revisao'
  | 'aguardando_aprovacao'
  | 'aprovada'
  | 'substituida'

export type VersionOrigin = 'cliente' | 'interno' | 'revisao'

export interface VersionHistoryEntry {
  id: string
  status: VersionStatus
  note: string
  timestamp: string
  userId: string
}

export interface VersionProblemSummary {
  critical: number
  warning: number
  info: number
  approved: number
  pending: number
}

export interface ProjectVersion {
  id: string
  projectId: string
  versionNumber: number
  fileName: string
  format: string
  size: number
  createdAt: string
  responsibleId: string
  responsibleName: string
  origin: VersionOrigin
  comment: string
  status: VersionStatus
  isCurrent: boolean
  problemSummary: VersionProblemSummary
  history: VersionHistoryEntry[]
  changes: string[]
}

export interface AddVersionData {
  fileName: string
  format: string
  size: number
  comment: string
  responsibleId: string
  responsibleName: string
}

export interface ActivityEvent {
  id: string
  type: 'upload' | 'analysis' | 'comment' | 'status_change'
  projectId: string
  userId: string
  message: string
  timestamp: string
}

export interface FilterState {
  search: string
  status: string
  client: string
  responsible: string
  severity: string
  profile: string
  period: string
  fileType: string
}

export type ProblemStatus = 'pending' | 'approved' | 'rejected' | 'ignored' | 'corrected'

export interface AnalysisProblem {
  id: string
  name: string
  severity: Severity
  category: string
  page: number
  location: string
  status: ProblemStatus
  description: string
  technicalRule: string
  foundValue: string
  recommendedValue: string
  correctionSuggestion: string
  confidence: number
  justification?: string
  autoFixable: boolean
  marking: { x: number; y: number; w: number; h: number }
}

export type SortOption = 'recent' | 'oldest' | 'deadline' | 'name' | 'severity'
