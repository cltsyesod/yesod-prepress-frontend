import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { signRequest } from '../_shared/analyzer.ts'

// Exporta um painelamento: o frontend salva os painéis em tiling_projects; aqui a arte e a
// imagem de referência ganham URLs assinadas, as saídas ganham URLs de envio e o job vai
// ao analisador.

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

    const { tilingId } = await req.json().catch(() => ({}))
    if (!tilingId) return json(400, { error: 'tilingId é obrigatório' })

    const db = createClient(supabaseUrl, serviceRoleKey)
    const { data: tiling } = await db.from('tiling_projects').select('*').eq('id', tilingId).maybeSingle()
    if (!tiling || tiling.user_id !== user.id) return json(404, { error: 'Painelamento não encontrado' })

    const fail = async (message: string) => {
      await db
        .from('tiling_projects')
        .update({ status: 'failed', error_message: message, completed_at: new Date().toISOString() })
        .eq('id', tilingId)
      return json(502, { error: message })
    }
    if (!analyzerUrl || !inboundSecret) return fail('Analisador não configurado')
    if (!Array.isArray(tiling.tiles) || !tiling.tiles.length) return fail('Nenhum painel para exportar')

    const { data: file } = await db
      .from('project_files')
      .select('id, user_id, storage_path, sha256, size_bytes')
      .eq('id', tiling.file_id)
      .maybeSingle()
    if (!file || file.user_id !== user.id) return fail('Arquivo da arte não encontrado')
    let sourceUrl = ''
    for (const bucket of ['pdfs', 'project-files']) {
      const { data } = await db.storage.from(bucket).createSignedUrl(file.storage_path, 3600)
      if (data?.signedUrl) {
        sourceUrl = data.signedUrl
        break
      }
    }
    if (!sourceUrl) return fail('Não foi possível acessar o PDF da arte')

    // Imagem de referência: só entra no guia, nunca nos painéis.
    const bg = tiling.background
    let background: Record<string, unknown> | undefined
    if (bg?.path && bg.visibleInGuide !== false && Number(bg.widthMm) > 0) {
      const { data } = await db.storage.from('tiling').createSignedUrl(bg.path, 3600)
      if (data?.signedUrl) {
        background = {
          url: data.signedUrl,
          xMm: Number(bg.xMm) || 0,
          yMm: Number(bg.yMm) || 0,
          widthMm: Number(bg.widthMm),
          opacity: Math.min(1, Math.max(0, Number(bg.opacity ?? 0.6))),
        }
      }
    }

    const folder = `${user.id}/paineis/${tilingId}`
    const paths = { pdf: `${folder}/paineis.pdf`, zip: `${folder}/paineis.zip`, guide: `${folder}/guia.pdf` }
    const outputs: Record<string, unknown> = {}
    for (const [key, path] of Object.entries(paths)) {
      const { data } = await db.storage.from('tiling').createSignedUploadUrl(path, { upsert: true })
      if (!data?.signedUrl) return fail('Falha ao preparar o envio dos arquivos')
      outputs[key] = data.signedUrl
    }
    // Cada painel também vai sozinho, para baixar um painel sem o resto.
    const numbers = [...new Set(tiling.tiles.map((t: any) => Number(t?.number)))].filter(
      (n): n is number => Number.isInteger(n) && n > 0,
    )
    const panelUrls: Record<string, string> = {}
    const panelPaths: Record<string, string> = {}
    for (let i = 0; i < numbers.length; i += 20) {
      await Promise.all(
        numbers.slice(i, i + 20).map(async (n) => {
          const path = `${folder}/paineis/${String(n).padStart(3, '0')}.pdf`
          const { data } = await db.storage.from('tiling').createSignedUploadUrl(path, { upsert: true })
          if (data?.signedUrl) {
            panelUrls[n] = data.signedUrl
            panelPaths[n] = path
          }
        }),
      )
    }
    outputs.panels = panelUrls

    const config = tiling.config ?? {}
    const payload = JSON.stringify({
      tilingId,
      callbackUrl: `${supabaseUrl}/functions/v1/analysis_callback`,
      outputs,
      title: String(tiling.name || ''),
      source: {
        url: sourceUrl,
        sha256: /^[0-9a-f]{64}$/i.test(file.sha256 || '') ? file.sha256 : undefined,
        sizeBytes: file.size_bytes || undefined,
      },
      page: Math.max(1, Number(config.page) || 1),
      fileScale: config.project?.poster?.scale || config.fileScale || 1,
      tiles: tiling.tiles,
      seams: Array.isArray(tiling.seams) ? tiling.seams : [],
      background,
      marks: config.marks ?? {},
      // O analisador confere de novo se cada painel cabe no material.
      constraint: config.project?.constraint ?? {},
      config,
    })
    const timestamp = String(Math.floor(Date.now() / 1000))
    const requestId = crypto.randomUUID()
    let res: Response
    try {
      res = await fetch(`${analyzerUrl}/v1/tiling`, {
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
      return fail(`Analisador recusou o painelamento (HTTP ${res.status}): ${detail.slice(0, 500)}`)
    }
    const accepted = await res.json().catch(() => ({}))
    await db
      .from('tiling_projects')
      .update({
        status: 'queued',
        progress: 0,
        current_step: 'Na fila do analisador',
        error_message: '',
        last_sequence: 0,
        external_job_id: String(accepted.external_job_id || ''),
        output: { ...paths, panels: panelPaths },
        result: {},
        completed_at: null,
      })
      .eq('id', tilingId)
    return json(200, { success: true, tilingId })
  } catch (err: any) {
    return json(500, { error: err?.message || 'Internal server error' })
  }
})
