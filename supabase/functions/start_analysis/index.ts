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
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const analyzerUrl = (Deno.env.get('ANALYZER_URL') || 'http://localhost:8000').replace(/\/+$/, '')

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
    const jobId = body.jobId || body.job_id
    const fileId = body.fileId || body.file_id
    const profileId = body.profileId || body.profile_id || ''

    if (!jobId || !fileId) {
      return json(400, { error: 'Campos jobId e fileId são obrigatórios' })
    }

    const adminDb = createClient(supabaseUrl, serviceRoleKey)

    // 2. Buscar arquivo em project_files
    const { data: file, error: fileError } = await adminDb
      .from('project_files')
      .select('*')
      .eq('id', fileId)
      .maybeSingle()

    if (fileError || !file) {
      return json(404, { error: 'Arquivo não encontrado' })
    }

    // 3. Verificar permissão do usuário
    if (file.user_id !== user.id) {
      return json(403, { error: 'Sem permissão para acessar este arquivo' })
    }

    // 4. Gerar URL assinada do PDF no Storage (1 hora)
    let storagePath = file.storage_path
    if (!storagePath) {
      storagePath = `${user.id}/${file.id}.pdf`
    }

    let signedUrl = ''
    // Tenta primeiro em project-files, depois em pdfs
    const { data: signedData1 } = await adminDb.storage
      .from('project-files')
      .createSignedUrl(storagePath, 3600)

    if (signedData1?.signedUrl) {
      signedUrl = signedData1.signedUrl
    } else {
      const { data: signedData2 } = await adminDb.storage
        .from('pdfs')
        .createSignedUrl(storagePath, 3600)
      if (signedData2?.signedUrl) {
        signedUrl = signedData2.signedUrl
      }
    }

    if (!signedUrl) {
      // Fallback para URL assinada gerada diretamente
      const { data: signedFallback, error: signErr } = await adminDb.storage
        .from('project-files')
        .createSignedUrl(storagePath, 3600)
      if (signErr || !signedFallback?.signedUrl) {
        return json(500, { error: 'Falha ao gerar URL assinada do PDF para análise' })
      }
      signedUrl = signedFallback.signedUrl
    }

    // 5. Fazer POST para o analisador Python
    const callbackUrl = `${supabaseUrl}/functions/v1/analysis_callback`
    const analyzerPayload = {
      job_id: jobId,
      pdf_url: signedUrl,
      callback_url: callbackUrl,
      production_profile_id: profileId,
    }

    let externalJobId = jobId
    try {
      const analyzerRes = await fetch(`${analyzerUrl}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(analyzerPayload),
      })

      if (!analyzerRes.ok) {
        const text = await analyzerRes.text()
        return json(500, { error: `Analisador retornou erro HTTP ${analyzerRes.status}: ${text}` })
      }

      const analyzerData = await analyzerRes.json().catch(() => ({}))
      if (analyzerData.external_job_id) {
        externalJobId = analyzerData.external_job_id
      }
    } catch (fetchErr: any) {
      return json(500, {
        error: `Analisador offline ou inacessível em ${analyzerUrl}: ${fetchErr?.message || fetchErr}`,
      })
    }

    // 7. Atualizar analysis_jobs
    await adminDb
      .from('analysis_jobs')
      .update({
        external_job_id: externalJobId,
        status: 'downloading',
        current_step: 'Downloading PDF',
        started_at: new Date().toISOString(),
      })
      .eq('id', jobId)

    // 8. Retornar 200
    return json(200, {
      success: true,
      external_job_id: externalJobId,
    })
  } catch (err: any) {
    return json(500, { error: err?.message || 'Internal server error' })
  }
})
