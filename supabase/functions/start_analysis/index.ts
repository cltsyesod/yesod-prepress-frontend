import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { signRequest, toAnalyzerProfile } from '../_shared/analyzer.ts'

// Correções que alteram o PDF (as da ficha, como a escala, são tratadas no frontend).
const FIX_IDS = ['set_page_boxes', 'add_contour_cut', 'add_cut_contour', 'add_crop_marks']

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
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const analyzerUrl = (Deno.env.get('ANALYZER_URL') || '').replace(/\/+$/, '')

    if (!supabaseUrl || !serviceRoleKey) {
      return json(500, { error: 'Supabase configuration missing in Edge Function' })
    }

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return json(401, { error: 'Missing Authorization header' })
    }

    // 1. Validar autenticação
    const authClient = createClient(supabaseUrl, supabaseAnonKey || serviceRoleKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser()

    if (authError || !user) {
      return json(401, { error: 'Autenticação necessária ou token inválido' })
    }

    // Parse body
    const body = await req.json().catch(() => ({}))
    let jobId = body.jobId || body.job_id
    const fileId = body.fileId || body.file_id
    const profileId = body.profileId || body.profile_id || ''
    const fixes = Array.isArray(body.fixes)
      ? body.fixes.filter((fix: any) => FIX_IDS.includes(fix?.id))
      : []

    // Numa correção o job é criado aqui, junto com a cópia corrigida.
    if (!fileId || (!jobId && !fixes.length)) {
      return json(400, { error: 'Campos jobId e fileId são obrigatórios' })
    }

    const adminDb = createClient(supabaseUrl, serviceRoleKey)

    // 2. Buscar arquivo em project_files
    const { data: requested, error: fileError } = await adminDb
      .from('project_files')
      .select('*')
      .eq('id', fileId)
      .maybeSingle()

    if (fileError || !requested) {
      return json(404, { error: 'Arquivo não encontrado' })
    }

    // 3. Verificar permissão do usuário
    if (requested.user_id !== user.id) {
      return json(403, { error: 'Sem permissão para acessar este arquivo' })
    }

    // Correção automática: o analisador baixa `source` (o arquivo pedido), aplica as
    // correções, envia a cópia para `file` (status "pending" até a conclusão) e a analisa.
    let file = requested
    const source = requested
    let uploadUrl = ''
    if (fixes.length) {
      if (!analyzerUrl) {
        return json(400, { error: 'Correções automáticas exigem o analisador (ANALYZER_URL)' })
      }
      const base = String(source.original_name || 'arquivo.pdf').replace(/\.pdf$/i, '')
      const name = `${base.replace(/_corrigido$/, '')}_corrigido.pdf`
      const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const { data: copy, error: copyErr } = await adminDb
        .from('project_files')
        .insert({
          project: source.project,
          version: source.version,
          original_name: name,
          safe_name: safeName,
          extension: 'PDF',
          mime_type: 'application/pdf',
          size_bytes: source.size_bytes,
          user_id: user.id,
          storage_path: `${user.id}/${source.project}/${Date.now()}_${safeName}`,
          status: 'pending',
          is_primary: false,
          // Sempre o arquivo do cliente; as correções anteriores seguem no histórico.
          derived_from: source.derived_from || source.id,
          applied_fixes: Array.isArray(source.applied_fixes) ? source.applied_fixes : [],
        })
        .select('*')
        .single()
      if (copyErr || !copy) {
        return json(500, { error: `Falha ao registrar o PDF corrigido: ${copyErr?.message ?? ''}` })
      }
      file = copy

      const { data: newJob, error: jobErr } = await adminDb
        .from('analysis_jobs')
        .insert({
          project: copy.project,
          file: copy.id,
          version: copy.version || '',
          production_profile: profileId || 'default',
          user_id: user.id,
          status: 'queued',
          current_step: 'Preparando correções',
        })
        .select('id')
        .single()
      if (jobErr || !newJob) {
        await adminDb.from('project_files').update({ status: 'removed' }).eq('id', copy.id)
        return json(500, { error: `Falha ao registrar a correção: ${jobErr?.message ?? ''}` })
      }
      jobId = newJob.id

      const { data: upload, error: uploadErr } = await adminDb.storage
        .from('pdfs')
        .createSignedUploadUrl(copy.storage_path, { upsert: true })
      if (uploadErr || !upload?.signedUrl) {
        return json(500, { error: 'Falha ao preparar o envio do PDF corrigido' })
      }
      uploadUrl = upload.signedUrl
    }

    // 4. Gerar URL assinada do PDF no Storage (1 hora)
    const storagePath = source.storage_path || `${user.id}/${source.id}.pdf`
    let signedUrl = ''
    for (const bucket of ['pdfs', 'project-files']) {
      const { data: signed } = await adminDb.storage.from(bucket).createSignedUrl(storagePath, 3600)
      if (signed?.signedUrl) {
        signedUrl = signed.signedUrl
        break
      }
    }
    if (!signedUrl) {
      return json(500, { error: 'Falha ao gerar URL assinada do PDF para análise' })
    }

    // 5. Enviar o job assinado ao analisador Python (POST /v1/jobs)
    if (analyzerUrl) {
      const inboundSecret = Deno.env.get('ANALYZER_INBOUND_SECRET')
      const failJob = async (code: string, message: string) => {
        await adminDb
          .from('analysis_jobs')
          .update({
            status: 'failed',
            error_code: code,
            error_message: message,
            current_step: 'Falha ao enviar para o analisador',
            completed_at: new Date().toISOString(),
          })
          .eq('id', jobId)
        return json(502, { error: message })
      }

      if (!inboundSecret) {
        return failJob('analyzer_not_configured', 'ANALYZER_INBOUND_SECRET não configurado')
      }

      const { data: job } = await adminDb
        .from('analysis_jobs')
        .select('project, version')
        .eq('id', jobId)
        .maybeSingle()
      const projectId = String(job?.project || file.project || '')

      const { data: project } = projectId
        ? await adminDb.from('projects').select('job_ticket').eq('id', projectId).maybeSingle()
        : { data: null }

      // Perfil: enviado pelo frontend ou salvo em production_profiles.
      let profileSettings: Record<string, unknown> =
        body.productionProfile && typeof body.productionProfile === 'object'
          ? body.productionProfile
          : {}
      if (!Object.keys(profileSettings).length && /^[0-9a-f-]{36}$/i.test(profileId)) {
        const { data: stored } = await adminDb
          .from('production_profiles')
          .select('name, settings')
          .eq('id', profileId)
          .maybeSingle()
        if (stored) profileSettings = { ...(stored.settings ?? {}), name: stored.name }
      }

      const payload = JSON.stringify({
        analysisId: jobId,
        projectId: projectId || 'sem-projeto',
        fileId: file.id,
        versionId: String(job?.version || file.version || ''),
        productionProfile: toAnalyzerProfile(profileId, profileSettings, project?.job_ticket ?? {}),
        downloadUrl: signedUrl,
        fileSha256: /^[0-9a-f]{64}$/i.test(source.sha256 || '') ? source.sha256 : undefined,
        fileSizeBytes: source.size_bytes || undefined,
        callbackUrl: `${supabaseUrl}/functions/v1/analysis_callback`,
        ...(fixes.length
          ? {
              fixes: fixes.map((fix: any) => ({ id: fix.id, params: fix.params ?? {} })),
              outputUploadUrl: uploadUrl,
            }
          : {}),
      })
      const timestamp = String(Math.floor(Date.now() / 1000))
      const requestId = crypto.randomUUID()

      let analyzerRes: Response
      try {
        analyzerRes = await fetch(`${analyzerUrl}/v1/jobs`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Yesod-Timestamp': timestamp,
            'X-Yesod-Request-Id': requestId,
            'X-Yesod-Signature': await signRequest(inboundSecret, timestamp, requestId, payload),
          },
          body: payload,
        })
      } catch (fetchErr: any) {
        return failJob('analyzer_unreachable', `Analisador inacessível: ${fetchErr?.message || fetchErr}`)
      }

      if (!analyzerRes.ok) {
        const detail = await analyzerRes.text().catch(() => '')
        return failJob(
          'analyzer_rejected',
          `Analisador recusou o job (HTTP ${analyzerRes.status}): ${detail.slice(0, 500)}`,
        )
      }

      const accepted = await analyzerRes.json().catch(() => ({}))
      const externalJobId = String(accepted.external_job_id || jobId)
      await adminDb
        .from('analysis_jobs')
        .update({
          external_job_id: externalJobId,
          status: 'queued',
          current_step: 'Na fila do analisador',
          started_at: new Date().toISOString(),
        })
        .eq('id', jobId)

      return json(200, { success: true, jobId, external_job_id: externalJobId, dispatch: 'external_analyzer' })
    }

    await adminDb
      .from('analysis_jobs')
      .update({
        status: 'failed',
        error_code: 'analyzer_not_configured',
        error_message: 'ANALYZER_URL não configurado',
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId)
    return json(503, { error: 'Analisador não configurado (ANALYZER_URL)' })
  } catch (err: any) {
    return json(500, { error: err?.message || 'Internal server error' })
  }
})
