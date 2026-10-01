// Edge Function: recebe o callback do analisador externo (porta de pocketbase/hooks/analyzer_callback.js).
// Deploy: supabase functions deploy analyzer-callback --no-verify-jwt
// Segredo:  supabase secrets set ANALYZER_CALLBACK_SECRET=<valor longo>
// O analisador deve enviar o header  x-callback-secret: <valor>.
import { createClient } from 'npm:@supabase/supabase-js@2'

const RUNNING = ['preparing', 'downloading', 'validating', 'extracting', 'analyzing', 'generating_preview']
const TERMINAL = ['completed', 'completed_with_warnings', 'failed', 'cancelled']

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' })
  const secret = Deno.env.get('ANALYZER_CALLBACK_SECRET')
  if (!secret || req.headers.get('x-callback-secret') !== secret) return json(401, { error: 'unauthorized' })

  const body = await req.json().catch(() => ({}))
  const analysisId = body.analysisId || body.analysis_id
  if (!analysisId) return json(400, { error: 'analysisId é obrigatório' })

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: job, error: findErr } = await db.from('analysis_jobs').select('*').eq('id', analysisId).maybeSingle()
  if (findErr || !job) return json(404, { error: 'Análise não encontrada' })

  const patch: Record<string, unknown> = {}
  if (body.status) {
    patch.status = body.status
    if (RUNNING.includes(body.status) && !job.started_at) patch.started_at = new Date().toISOString()
    if (TERMINAL.includes(body.status)) patch.completed_at = new Date().toISOString()
  }
  if (body.progress !== undefined && body.progress !== null) {
    const p = parseInt(body.progress, 10)
    if (!isNaN(p)) patch.progress = Math.max(0, Math.min(100, p))
  }
  const step = body.currentStep || body.current_step
  if (step) patch.current_step = step
  const ext = body.externalJobId || body.external_job_id
  if (ext) patch.external_job_id = ext
  const code = body.errorCode || body.error_code
  if (code) patch.error_code = code
  const msg = body.errorMessage || body.error_message
  if (msg) patch.error_message = msg

  const { data: updated, error: upErr } = await db
    .from('analysis_jobs').update(patch).eq('id', analysisId).select().single()
  if (upErr) return json(400, { error: upErr.message })

  if (Array.isArray(body.issues) && body.issues.length > 0) {
    const rows = body.issues.map((i: any) => ({
      analysis: analysisId,
      project: job.project,
      file: job.file,
      user_id: job.user_id,
      rule_code: i.ruleCode || i.rule_code || '',
      title: i.title || '',
      category: i.category || '',
      severity: i.severity || 'informational',
      status: i.status || 'pending',
      page: i.page || 0,
      object_id: i.objectId || i.object_id || '',
      coordinates: typeof (i.coordinates || i.coords) === 'string' ? (i.coordinates || i.coords) : JSON.stringify(i.coordinates || i.coords || ''),
      found_value: i.foundValue || i.found_value || '',
      expected_value: i.expectedValue || i.expected_value || '',
      description: i.description || '',
      recommendation: i.recommendation || '',
      confidence: i.confidence || 0,
      source: i.source || 'external_analyzer',
      can_auto_correct: i.canAutoCorrect || i.can_auto_correct || false,
    }))
    const { error: issErr } = await db.from('analysis_issues').insert(rows)
    if (issErr) return json(400, { error: issErr.message })
  }

  return json(200, { id: updated.id, status: updated.status, progress: updated.progress, current_step: updated.current_step })
})
