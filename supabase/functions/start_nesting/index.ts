import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { signRequest } from '../_shared/analyzer.ts'

// Dispara uma montagem (nesting): o frontend cria a linha em nesting_runs com os
// parâmetros do operador; aqui os PDFs ganham URLs assinadas e o job vai ao analisador.

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const analyzerUrl = (Deno.env.get('ANALYZER_URL') || '').replace(/\/+$/, '')
    const inboundSecret = Deno.env.get('ANALYZER_INBOUND_SECRET')
    if (!supabaseUrl || !serviceRoleKey) return json(500, { error: 'Supabase não configurado' })

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json(401, { error: 'Missing Authorization header' })
    const authClient = createClient(supabaseUrl, anonKey || serviceRoleKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const {
      data: { user },
    } = await authClient.auth.getUser()
    if (!user) return json(401, { error: 'Autenticação necessária' })

    const { nestingId } = await req.json().catch(() => ({}))
    if (!nestingId) return json(400, { error: 'nestingId é obrigatório' })

    const db = createClient(supabaseUrl, serviceRoleKey)
    const { data: run } = await db.from('nesting_runs').select('*').eq('id', nestingId).maybeSingle()
    if (!run || run.user_id !== user.id) return json(404, { error: 'Montagem não encontrada' })

    const fail = async (message: string) => {
      await db
        .from('nesting_runs')
        .update({ status: 'failed', error_message: message, completed_at: new Date().toISOString() })
        .eq('id', nestingId)
      return json(502, { error: message })
    }
    if (!analyzerUrl || !inboundSecret) return fail('Analisador não configurado')

    // Cada trabalho: URL assinada do arquivo principal + parâmetros vindos da ficha.
    const items = []
    for (const item of Array.isArray(run.items) ? run.items : []) {
      const { data: file } = await db
        .from('project_files')
        .select('id, user_id, storage_path, sha256, size_bytes')
        .eq('id', item.fileId)
        .maybeSingle()
      if (!file || file.user_id !== user.id) return fail(`Arquivo de "${item.label}" não encontrado`)
      let url = ''
      for (const bucket of ['pdfs', 'project-files']) {
        const { data } = await db.storage.from(bucket).createSignedUrl(file.storage_path, 3600)
        if (data?.signedUrl) {
          url = data.signedUrl
          break
        }
      }
      if (!url) return fail(`Não foi possível acessar o PDF de "${item.label}"`)
      items.push({
        key: String(item.fileId),
        label: String(item.label || ''),
        file: {
          url,
          sha256: /^[0-9a-f]{64}$/i.test(file.sha256 || '') ? file.sha256 : undefined,
          sizeBytes: file.size_bytes || undefined,
        },
        quantity: Math.max(1, Number(item.quantity) || 1),
        // Sem lista de páginas, o analisador usa todas as páginas do arquivo.
        pages: Array.isArray(item.pages) ? item.pages : [],
        fileScale: item.fileScale || 1,
        bleedMm: Number(item.bleedMm) || 0,
        cutNames: Array.isArray(item.cutNames) && item.cutNames.length ? item.cutNames : undefined,
        useDieLine: item.useDieLine !== false,
      })
    }
    if (!items.length) return fail('Nenhum trabalho selecionado')

    const outputPath = `${user.id}/montagens/${nestingId}.pdf`
    const { data: upload } = await db.storage.from('pdfs').createSignedUploadUrl(outputPath, { upsert: true })
    if (!upload?.signedUrl) return fail('Falha ao preparar o envio do PDF montado')

    const params = run.params ?? {}
    const payload = JSON.stringify({
      nestingId,
      callbackUrl: `${supabaseUrl}/functions/v1/analysis_callback`,
      outputUploadUrl: upload.signedUrl,
      material: params.material ?? {},
      rotation: params.rotation ?? {},
      cutLines: params.cutLines ?? {},
      marks: params.marks ?? {},
      items,
    })
    const timestamp = String(Math.floor(Date.now() / 1000))
    const requestId = crypto.randomUUID()
    let res: Response
    try {
      res = await fetch(`${analyzerUrl}/v1/nesting`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Yesod-Timestamp': timestamp,
          'X-Yesod-Request-Id': requestId,
          'X-Yesod-Signature': await signRequest(inboundSecret, timestamp, requestId, payload),
        },
        body: payload,
      })
    } catch (err: any) {
      return fail(`Analisador inacessível: ${err?.message || err}`)
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      return fail(`Analisador recusou a montagem (HTTP ${res.status}): ${detail.slice(0, 500)}`)
    }
    const accepted = await res.json().catch(() => ({}))
    await db
      .from('nesting_runs')
      .update({
        status: 'queued',
        current_step: 'Na fila do analisador',
        external_job_id: String(accepted.external_job_id || ''),
        output_path: outputPath,
      })
      .eq('id', nestingId)
    return json(200, { success: true, nestingId })
  } catch (err: any) {
    return json(500, { error: err?.message || 'Internal server error' })
  }
})
