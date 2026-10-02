import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

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

    if (!supabaseUrl || !serviceRoleKey) {
      return json(500, { error: 'Supabase configuration missing in Edge Function' })
    }

    const body = await req.json().catch(() => ({}))
    const jobId = body.job_id || body.jobId || body.analysisId || body.analysis_id
    const incomingStatus = body.status

    if (!jobId || !incomingStatus) {
      return json(400, { error: 'job_id e status são obrigatórios' })
    }

    const db = createClient(supabaseUrl, serviceRoleKey)

    // 1. Buscar job
    const { data: job, error: findErr } = await db
      .from('analysis_jobs')
      .select('*')
      .eq('id', jobId)
      .maybeSingle()

    if (findErr || !job) {
      return json(404, { error: 'Análise não encontrada' })
    }

    const hasError = Boolean(body.error_code || body.errorMessage || body.error_message)
    const isCompleted = incomingStatus === 'completed' && !hasError
    const finalStatus = isCompleted ? 'completed' : incomingStatus === 'completed' ? 'failed' : incomingStatus

    const patch: Record<string, unknown> = {
      status: finalStatus,
      progress: body.progress !== undefined ? Math.max(0, Math.min(100, Number(body.progress))) : (isCompleted ? 100 : job.progress),
      error_code: body.error_code || body.errorCode || '',
      error_message: body.error_message || body.errorMessage || '',
      current_step: isCompleted
        ? 'Análise concluída com sucesso'
        : hasError
          ? (body.error_message || 'Falha no processamento')
          : (body.current_step || body.currentStep || 'Processando análise'),
    }

    if (['completed', 'completed_with_warnings', 'failed', 'cancelled'].includes(finalStatus)) {
      patch.completed_at = new Date().toISOString()
    }

    const { error: upErr } = await db.from('analysis_jobs').update(patch).eq('id', jobId)
    if (upErr) {
      return json(500, { error: upErr.message })
    }

    // 2. Se status="completed" e sem erro, inserir issues
    if (isCompleted && Array.isArray(body.issues) && body.issues.length > 0) {
      const rows = body.issues.map((i: any) => {
        let rawSev = String(i.severity || 'informational').toLowerCase()
        if (rawSev === 'info') rawSev = 'informational'
        if (!['critical', 'warning', 'informational'].includes(rawSev)) {
          rawSev = 'informational'
        }

        return {
          analysis: jobId,
          project: job.project,
          file: job.file,
          user_id: job.user_id,
          rule_code: i.rule_code || i.ruleCode || '',
          title: i.title || '',
          category: i.category || '',
          severity: rawSev,
          status: i.status || 'pending',
          page: typeof i.page === 'number' ? i.page : 1,
          object_id: i.object_id || i.objectId || '',
          coordinates:
            typeof (i.coordinates || i.coords) === 'string'
              ? (i.coordinates || i.coords)
              : JSON.stringify(i.coordinates || i.coords || ''),
          found_value: i.found_value || i.foundValue || '',
          expected_value: i.expected_value || i.expectedValue || '',
          description: i.description || '',
          recommendation: i.recommendation || '',
          confidence: typeof i.confidence === 'number' ? i.confidence : 1.0,
          source: i.source || 'color_inspector',
          can_auto_correct: Boolean(i.can_auto_correct || i.canAutoCorrect),
        }
      })

      const { error: issErr } = await db.from('analysis_issues').insert(rows)
      if (issErr) {
        console.error('Erro ao inserir issues:', issErr)
      }
    }

    // 3. Contar issues pendentes do projeto e atualizar projects table
    if (job.project) {
      try {
        const { count } = await db
          .from('analysis_issues')
          .select('*', { count: 'exact', head: true })
          .eq('project', job.project)
          .eq('status', 'pending')

        await db
          .from('projects')
          .update({
            issue_count: count ?? 0,
            status: 'needs_review',
          })
          .eq('id', job.project)
      } catch (projErr) {
        console.warn('Atualização de projects ignorada ou tabela ausente:', projErr)
      }
    }

    return json(200, { success: true })
  } catch (err: any) {
    return json(500, { error: err?.message || 'Internal server error' })
  }
})
