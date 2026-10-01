import supabase from '@/lib/supabase/client'

const FIXTURE_STEPS = [
  { status: 'preparing', progress: 10, current_step: 'Preparando análise' },
  { status: 'downloading', progress: 20, current_step: 'Baixando arquivo' },
  { status: 'validating', progress: 35, current_step: 'Validando PDF' },
  { status: 'extracting', progress: 55, current_step: 'Extraindo informações' },
  { status: 'analyzing', progress: 75, current_step: 'Analisando conteúdo' },
  { status: 'generating_preview', progress: 90, current_step: 'Gerando preview' },
] as const

const FIXTURE_ISSUES = [
  {
    rule_code: 'RESOLUTION_CHECK',
    title: 'Resolução de imagem abaixo do esperado',
    category: 'Resolução',
    severity: 'critical',
    status: 'pending',
    page: 1,
    coordinates: JSON.stringify({ x: 10, y: 15, w: 30, h: 20 }),
    found_value: '150 DPI',
    expected_value: '300 DPI',
    description:
      'A imagem na página 1 possui resolução de 150 DPI, abaixo do mínimo recomendado de 300 DPI para impressão offset.',
    recommendation: 'Substituir a imagem por uma versão com resolução mínima de 300 DPI.',
    confidence: 95,
    source: 'development_fixture',
    can_auto_correct: false,
  },
  {
    rule_code: 'COLOR_MODE_CHECK',
    title: 'Objeto em RGB detectado',
    category: 'Espaço de Cor',
    severity: 'warning',
    status: 'pending',
    page: 2,
    coordinates: JSON.stringify({ x: 40, y: 30, w: 25, h: 15 }),
    found_value: 'RGB',
    expected_value: 'CMYK',
    description: 'Objetos no espaço de cor RGB foram identificados na página 2.',
    recommendation: 'Converter todos os objetos para CMYK antes da impressão.',
    confidence: 88,
    source: 'development_fixture',
    can_auto_correct: true,
  },
  {
    rule_code: 'BLEED_CHECK',
    title: 'Sangria insuficiente',
    category: 'Sangria',
    severity: 'critical',
    status: 'pending',
    page: 1,
    coordinates: JSON.stringify({ x: 0, y: 0, w: 100, h: 5 }),
    found_value: '1 mm',
    expected_value: '3 mm',
    description: 'A sangria do documento é de 1 mm, abaixo do mínimo recomendado de 3 mm.',
    recommendation: 'Ajustar a sangria para no mínimo 3 mm em todas as bordas.',
    confidence: 92,
    source: 'development_fixture',
    can_auto_correct: false,
  },
  {
    rule_code: 'FONT_EMBED_CHECK',
    title: 'Fonte não incorporada',
    category: 'Fontes',
    severity: 'warning',
    status: 'pending',
    page: 3,
    coordinates: JSON.stringify({ x: 20, y: 60, w: 40, h: 10 }),
    found_value: 'Helvetica (não incorporada)',
    expected_value: 'Fonte incorporada',
    description: 'A fonte Helvetica não está incorporada no PDF.',
    recommendation: 'Incorporar todas as fontes no PDF ou convertê-las em outlines.',
    confidence: 85,
    source: 'development_fixture',
    can_auto_correct: true,
  },
  {
    rule_code: 'INK_COVERAGE_INFO',
    title: 'Cobertura de tinta dentro do limite',
    category: 'Cobertura de Tinta',
    severity: 'informational',
    status: 'pending',
    page: 2,
    coordinates: JSON.stringify({ x: 50, y: 50, w: 15, h: 15 }),
    found_value: '280%',
    expected_value: '≤ 320%',
    description:
      'A cobertura máxima de tinta identificada é de 280%, dentro do limite recomendado.',
    recommendation: 'Nenhuma ação necessária. A cobertura está dentro dos limites.',
    confidence: 99,
    source: 'development_fixture',
    can_auto_correct: false,
  },
] as const

function checkDevAccess(): void {
  if (!import.meta.env.DEV) {
    throw new Error('Dev fixture só pode ser executado em modo de desenvolvimento')
  }
  if (import.meta.env.VITE_ENABLE_ANALYZER_DEV_FIXTURE !== 'true') {
    throw new Error(
      'Fixture desativado. Defina VITE_ENABLE_ANALYZER_DEV_FIXTURE=true no .env local',
    )
  }
}

const RUNNING = ['preparing', 'downloading', 'validating', 'extracting', 'analyzing', 'generating_preview']
const TERMINAL = ['completed', 'completed_with_warnings', 'failed', 'cancelled']

// Em dev, simula o callback do analisador escrevendo direto nas tabelas (RLS: o usuário é dono).
// Em produção, quem faz isso é a Edge Function `analyzer-callback`.
async function sendCallback(payload: Record<string, any>): Promise<void> {
  const analysisId = payload.analysisId as string
  const patch: Record<string, unknown> = {}
  if (payload.status) {
    patch.status = payload.status
    if (RUNNING.includes(payload.status)) patch.started_at = new Date().toISOString()
    if (TERMINAL.includes(payload.status)) patch.completed_at = new Date().toISOString()
  }
  if (payload.progress !== undefined) patch.progress = payload.progress
  if (payload.currentStep) patch.current_step = payload.currentStep
  if (payload.errorCode) patch.error_code = payload.errorCode
  if (payload.errorMessage) patch.error_message = payload.errorMessage

  const { data: job, error } = await supabase
    .from('analysis_jobs')
    .update(patch)
    .eq('id', analysisId)
    .select()
    .single()
  if (error) throw error

  if (Array.isArray(payload.issues) && payload.issues.length > 0) {
    const rows = payload.issues.map((i: any) => ({
      analysis: analysisId,
      project: job.project,
      file: job.file,
      user_id: job.user_id,
      rule_code: i.ruleCode || '',
      title: i.title || '',
      category: i.category || '',
      severity: i.severity || 'informational',
      status: i.status || 'pending',
      page: i.page || 0,
      object_id: i.objectId || '',
      coordinates: typeof i.coordinates === 'string' ? i.coordinates : JSON.stringify(i.coordinates ?? ''),
      found_value: i.foundValue || '',
      expected_value: i.expectedValue || '',
      description: i.description || '',
      recommendation: i.recommendation || '',
      confidence: i.confidence || 0,
      source: i.source || 'external_analyzer',
      can_auto_correct: i.canAutoCorrect || false,
    }))
    const { error: issueErr } = await supabase.from('analysis_issues').insert(rows)
    if (issueErr) throw issueErr
  }
}

export async function runDevFixture(
  analysisId: string,
  options: { stepDelay?: number } = {},
): Promise<void> {
  checkDevAccess()
  const delay = options.stepDelay ?? 1500

  for (const step of FIXTURE_STEPS) {
    await sendCallback({
      analysisId,
      status: step.status,
      progress: step.progress,
      currentStep: step.current_step,
    })
    await new Promise((r) => setTimeout(r, delay))
  }

  await sendCallback({
    analysisId,
    issues: FIXTURE_ISSUES,
  })
  await new Promise((r) => setTimeout(r, delay))

  await sendCallback({
    analysisId,
    status: 'completed_with_warnings',
    progress: 100,
    currentStep: 'Análise concluída com alertas',
  })
}

export async function runDevFixtureNoIssues(
  analysisId: string,
  options: { stepDelay?: number } = {},
): Promise<void> {
  checkDevAccess()
  const delay = options.stepDelay ?? 1500

  for (const step of FIXTURE_STEPS) {
    await sendCallback({
      analysisId,
      status: step.status,
      progress: step.progress,
      currentStep: step.current_step,
    })
    await new Promise((r) => setTimeout(r, delay))
  }

  await sendCallback({
    analysisId,
    status: 'completed',
    progress: 100,
    currentStep: 'Análise concluída sem problemas',
  })
}

export async function runDevFixtureFailure(
  analysisId: string,
  options: { stepDelay?: number } = {},
): Promise<void> {
  checkDevAccess()
  const delay = options.stepDelay ?? 1500

  for (const step of FIXTURE_STEPS.slice(0, 3)) {
    await sendCallback({
      analysisId,
      status: step.status,
      progress: step.progress,
      currentStep: step.current_step,
    })
    await new Promise((r) => setTimeout(r, delay))
  }

  await sendCallback({
    analysisId,
    status: 'failed',
    progress: 35,
    currentStep: 'Falha na análise',
    errorCode: 'ANALYZER_TIMEOUT',
    errorMessage:
      'O analisador externo não respondeu no tempo esperado (fixture de desenvolvimento)',
  })
}

export async function findLatestJobId(fileId: string): Promise<string | null> {
  const { data } = await supabase
    .from('analysis_jobs')
    .select('id')
    .eq('file', fileId)
    .order('created', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data?.id ?? null
}

if (import.meta.env.DEV) {
  const fixture = {
    run: runDevFixture,
    runNoIssues: runDevFixtureNoIssues,
    runFailure: runDevFixtureFailure,
    findJobId: findLatestJobId,
  }
  ;(window as unknown as Record<string, unknown>).__yesodDevFixture = fixture
}
