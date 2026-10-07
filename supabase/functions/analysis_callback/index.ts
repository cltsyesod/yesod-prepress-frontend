import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { verifySignature } from '../_shared/analyzer.ts'

// Recebe os eventos do yesod-prepress-analyzer: progress, issues, completed, failed, cancelled.
// Deploy com --no-verify-jwt: a autenticação é a assinatura HMAC (ANALYZER_CALLBACK_SECRET).

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

const JOB_STATUSES = [
  'queued',
  'preparing',
  'downloading',
  'validating',
  'extracting',
  'analyzing',
  'generating_preview',
  'completed',
  'completed_with_warnings',
  'failed',
  'cancelled',
]
const FINAL_STATUSES = ['completed', 'completed_with_warnings', 'failed', 'cancelled']
const SEVERITIES = ['critical', 'warning', 'informational']

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return json(405, { error: 'Method not allowed' })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const callbackSecret = Deno.env.get('ANALYZER_CALLBACK_SECRET')

    if (!supabaseUrl || !serviceRoleKey || !callbackSecret) {
      return json(500, { error: 'Callback do analisador não configurado' })
    }

    // A assinatura cobre o corpo exatamente como recebido.
    const raw = await req.text()
    const valid = await verifySignature(
      callbackSecret,
      req.headers.get('X-Yesod-Timestamp'),
      req.headers.get('X-Yesod-Request-Id'),
      req.headers.get('X-Yesod-Signature'),
      raw,
    )
    if (!valid) {
      return json(401, { error: 'Assinatura inválida' })
    }

    const body = JSON.parse(raw)
    if (body.kind === 'nesting') {
      return await handleNesting(createClient(supabaseUrl, serviceRoleKey), body)
    }
    const jobId = body.analysisId
    const event = String(body.event || '')
    const sequence = Number(body.sequence) || 0
    if (!jobId || !body.event_id || !event) {
      return json(400, { error: 'analysisId, event_id e event são obrigatórios' })
    }

    const db = createClient(supabaseUrl, serviceRoleKey)

    const { data: job, error: findErr } = await db
      .from('analysis_jobs')
      .select('*')
      .eq('id', jobId)
      .maybeSingle()
    if (findErr || !job) {
      // 4xx diferente de 409/429 faz o analisador desistir em vez de repetir.
      return json(404, { error: 'Análise não encontrada' })
    }

    // Idempotência: o analisador repete o mesmo event_id em caso de falha de rede.
    const { error: dupErr } = await db
      .from('analysis_callback_events')
      .insert({ event_id: body.event_id, analysis: jobId, event, sequence })
    if (dupErr) {
      if (dupErr.code === '23505') return json(409, { duplicate: true })
      return json(500, { error: dupErr.message })
    }

    // Ocorrências chegam em lotes no evento "issues".
    if (event === 'issues' && Array.isArray(body.issues) && body.issues.length > 0) {
      const rows = body.issues.map((i: any) => ({
        analysis: jobId,
        project: job.project,
        file: job.file,
        user_id: job.user_id,
        rule_code: String(i.rule_code || ''),
        title: String(i.title || ''),
        category: String(i.category || ''),
        severity: SEVERITIES.includes(i.severity) ? i.severity : 'informational',
        status: 'pending',
        page: Number.isInteger(i.page) ? i.page : 0,
        object_id: String(i.object_id || ''),
        coordinates: typeof i.coordinates === 'string' ? i.coordinates : JSON.stringify(i.coordinates ?? ''),
        found_value: String(i.found_value || ''),
        expected_value: String(i.expected_value || ''),
        description: String(i.description || ''),
        recommendation: String(i.recommendation || ''),
        confidence: typeof i.confidence === 'number' ? i.confidence : 100,
        source: String(i.source || 'external_analyzer'),
        can_auto_correct: Boolean(i.can_auto_correct),
        fix: i.fix && typeof i.fix === 'object' ? i.fix : null,
      }))
      const { error: issErr } = await db.from('analysis_issues').insert(rows)
      if (issErr) {
        // Libera o event_id para que a nova tentativa do analisador seja aceita.
        await db.from('analysis_callback_events').delete().eq('event_id', body.event_id)
        return json(500, { error: issErr.message })
      }
    }

    // Status: só avança; eventos antigos não sobrescrevem um estado mais novo.
    if (sequence > (job.last_sequence ?? 0) && !FINAL_STATUSES.includes(job.status)) {
      const status = JOB_STATUSES.includes(body.status) ? body.status : job.status
      const patch: Record<string, unknown> = {
        status,
        last_sequence: sequence,
        progress: Math.max(0, Math.min(100, Number(body.progress ?? job.progress) || 0)),
        current_step: String(body.currentStep || job.current_step || ''),
        error_code: String(body.errorCode || ''),
        error_message: String(body.errorMessage || ''),
      }
      if (FINAL_STATUSES.includes(status)) patch.completed_at = new Date().toISOString()

      // Arquivos e resumo antes do status: a tela recarrega quando o job chega ao fim.
      await settleCorrectedFile(db, job, event, body.summary?.correctedFile)
      if (event === 'completed' && job.project) {
        await updateProjectSummary(db, job.project, jobId)
      }

      const { error: upErr } = await db.from('analysis_jobs').update(patch).eq('id', jobId)
      if (upErr) return json(500, { error: upErr.message })
    }

    return json(200, { success: true })
  } catch (err: any) {
    return json(500, { error: err?.message || 'Internal server error' })
  }
})

// Montagem (nesting): progresso, resultado (aproveitamento, comprimento) ou falha.
const NESTING_STATUSES = ['queued', 'running', 'completed', 'failed', 'cancelled']
async function handleNesting(db: any, body: any) {
  if (!body.nestingId || !body.event_id) {
    return json(400, { error: 'nestingId e event_id são obrigatórios' })
  }
  const { data: run } = await db
    .from('nesting_runs')
    .select('id, status, last_sequence')
    .eq('id', body.nestingId)
    .maybeSingle()
  if (!run) return json(404, { error: 'Montagem não encontrada' })

  const sequence = Number(body.sequence) || 0
  // Eventos repetidos ou antigos não voltam o estado; montagem encerrada não muda.
  if (sequence <= (run.last_sequence ?? 0) || ['completed', 'failed', 'cancelled'].includes(run.status)) {
    return json(200, { ignored: true })
  }
  const status = NESTING_STATUSES.includes(body.status) ? body.status : run.status
  const patch: Record<string, unknown> = {
    status,
    last_sequence: sequence,
    progress: Math.max(0, Math.min(100, Number(body.progress) || 0)),
    current_step: String(body.currentStep || ''),
    updated: new Date().toISOString(),
  }
  if (body.event === 'completed') {
    patch.result = body.summary && typeof body.summary === 'object' ? body.summary : {}
    patch.completed_at = new Date().toISOString()
  }
  if (body.event === 'failed') {
    patch.error_message = String(body.errorMessage || 'Falha na montagem')
    patch.completed_at = new Date().toISOString()
  }
  const { error } = await db.from('nesting_runs').update(patch).eq('id', run.id)
  if (error) return json(500, { error: error.message })
  return json(200, { success: true })
}

// Correção automática: a análise roda sobre a cópia corrigida (status "pending" até aqui).
// Concluída, a cópia vira o arquivo principal; falhou, ela é descartada e o original segue.
async function settleCorrectedFile(db: any, job: any, event: string, corrected: any) {
  if (!['completed', 'failed', 'cancelled'].includes(event) || !job.file) return
  const { data: file } = await db
    .from('project_files')
    .select('id, project, status, derived_from, applied_fixes')
    .eq('id', job.file)
    .maybeSingle()
  if (!file || file.status !== 'pending' || !file.derived_from) return

  if (event !== 'completed' || !corrected) {
    await db.from('project_files').update({ status: 'removed', is_primary: false }).eq('id', file.id)
    return
  }
  await db.from('project_files').update({ is_primary: false }).eq('project', file.project).neq('id', file.id)
  await db
    .from('project_files')
    .update({
      status: 'ready_for_analysis',
      is_primary: true,
      sha256: String(corrected.sha256 || ''),
      size_bytes: Number(corrected.sizeBytes) || 0,
      // Histórico desde o arquivo do cliente: o que veio da versão anterior + o desta correção.
      applied_fixes: [
        ...(Array.isArray(file.applied_fixes) ? file.applied_fixes : []),
        ...(Array.isArray(corrected.appliedFixes) ? corrected.appliedFixes : []),
      ],
    })
    .eq('id', file.id)
}

// Resumo da fila: só as ocorrências desta análise (as anteriores ficam no histórico).
async function updateProjectSummary(db: any, projectId: string, analysisId: string) {
  try {
    const { data: pending } = await db
      .from('analysis_issues')
      .select('severity')
      .eq('analysis', analysisId)
      .eq('status', 'pending')
    const severities = (pending ?? []).map((row: any) => row.severity)
    const actionable = severities.filter((s: string) => s !== 'informational')
    await db
      .from('projects')
      .update({
        issue_count: actionable.length,
        severity: severities.includes('critical')
          ? 'critical'
          : severities.includes('warning')
            ? 'warning'
            : 'none',
        status: actionable.length > 0 ? 'needs_review' : 'pending_approval',
      })
      .eq('id', projectId)
  } catch (projErr) {
    console.warn('Resumo do projeto não atualizado:', projErr)
  }
}
