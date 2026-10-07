import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { signRequest, toAnalyzerProfile } from '../_shared/analyzer.ts'

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
        fileId,
        versionId: String(job?.version || file.version || ''),
        productionProfile: toAnalyzerProfile(profileId, profileSettings, project?.job_ticket ?? {}),
        downloadUrl: signedUrl,
        fileSha256: /^[0-9a-f]{64}$/i.test(file.sha256 || '') ? file.sha256 : undefined,
        fileSizeBytes: file.size_bytes || undefined,
        callbackUrl: `${supabaseUrl}/functions/v1/analysis_callback`,
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

      return json(200, { success: true, external_job_id: externalJobId, dispatch: 'external_analyzer' })
    }

    // Sem ANALYZER_URL: verificação simplificada (apenas cores especiais), útil só em desenvolvimento.
    if (!analyzerUrl) {
      await adminDb
        .from('analysis_jobs')
        .update({
          status: 'analyzing',
          current_step: 'Executando inspeção técnica de cores e pré-impressão...',
          started_at: new Date().toISOString(),
        })
        .eq('id', jobId)

      const pdfRes = await fetch(signedUrl)
      if (!pdfRes.ok) {
        await adminDb
          .from('analysis_jobs')
          .update({
            status: 'failed',
            error_code: 'download_failed',
            error_message: 'Falha ao baixar PDF do armazenamento para análise',
            completed_at: new Date().toISOString(),
          })
          .eq('id', jobId)

        return json(500, { error: 'Falha ao baixar o PDF para análise' })
      }

      const pdfBuf = await pdfRes.arrayBuffer()
      const pdfText = new TextDecoder('latin1').decode(pdfBuf)

      if (!pdfText.startsWith('%PDF')) {
        await adminDb
          .from('analysis_jobs')
          .update({
            status: 'failed',
            error_code: 'invalid_pdf',
            error_message: 'O arquivo não possui cabeçalho válido de PDF',
            completed_at: new Date().toISOString(),
          })
          .eq('id', jobId)

        return json(400, { error: 'O arquivo não é um PDF válido' })
      }

      const decodePdfName = (raw: string) =>
        raw.replace(/#([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))

      const spots: string[] = []

      // Extração de Separation Spot Colors
      const sepMatches = [...pdfText.matchAll(/\/Separation\s*\/([^\s\/\[\]<>]+)/g)]
      for (const m of sepMatches) {
        const decoded = decodePdfName(m[1])
        if (!['All', 'None'].includes(decoded) && !spots.includes(decoded)) {
          spots.push(decoded)
        }
      }

      // Extração de DeviceN Spot Colors
      const devnMatches = [...pdfText.matchAll(/\/DeviceN\s*\[([^\]]+)\]/g)]
      for (const dm of devnMatches) {
        const names = [...dm[1].matchAll(/\/([^\s\/\[\]<>]+)/g)]
        for (const n of names) {
          const decoded = decodePdfName(n[1])
          if (!['All', 'None'].includes(decoded) && !spots.includes(decoded)) {
            spots.push(decoded)
          }
        }
      }

      const issues: any[] = []

      for (const spotName of spots) {
        const rawEncoded = spotName.replace(/ /g, '#20')
        const occurrences =
          (pdfText.split(spotName).length - 1) +
          (rawEncoded !== spotName ? (pdfText.split(rawEncoded).length - 1) : 0)

        const hasScn = /\bscn\b|\bSCN\b/.test(pdfText)

        // Regra: spot definido mas não usado
        if (occurrences <= 2 && (!hasScn || occurrences <= 1)) {
          issues.push({
            rule_code: 'spot_color_unused',
            title: `Cor especial definida mas não utilizada: ${spotName}`,
            category: 'Cor',
            severity: 'warning',
            status: 'pending',
            page: 1,
            found_value: `${spotName} (0 ocorrências no conteúdo)`,
            expected_value: 'Utilizada em objetos gráficos ou removida',
            description: `A cor especial '${spotName}' está declarada nos recursos do documento (/Separation), porém nenhum elemento na página utiliza esta tinta. Em processos gráficos comerciais, cores extras não utilizadas podem gerar fotolitos ou chapas desnecessárias.`,
            recommendation: 'Remova a cor especial não utilizada ou atribua a cor aos objetos adequados para evitar custos e chapas extras na produção.',
            confidence: 1.0,
            source: 'color_inspector',
            can_auto_correct: false,
          })
        }

        // Regra: nome genérico de spot
        if (/^spot\s*\d+$/i.test(spotName.trim()) || /^cor\s*\d+$/i.test(spotName.trim())) {
          issues.push({
            rule_code: 'spot_color_generic_name',
            title: `Nome de cor especial genérico: ${spotName}`,
            category: 'Cor',
            severity: 'warning',
            status: 'pending',
            page: 1,
            found_value: spotName,
            expected_value: 'Nome padronizado (PANTONE ou função técnica)',
            description: `O documento utiliza a denominação genérica '${spotName}'. Recomenda-se utilizar nomenclaturas padronizadas (ex: PANTONE Formula Guide) ou funções técnicas (ex: CutContour, White).`,
            recommendation: 'Renomeie a cor especial no software de criação para garantir fidelidade de separação de cores no RIP.',
            confidence: 0.95,
            source: 'color_inspector',
            can_auto_correct: false,
          })
        }
      }

      // Regra: nomes duplicados ou variantes conflitantes
      for (let i = 0; i < spots.length; i++) {
        for (let j = i + 1; j < spots.length; j++) {
          const normA = spots[i].toLowerCase().replace(/[^a-z0-9]/g, '')
          const normB = spots[j].toLowerCase().replace(/[^a-z0-9]/g, '')
          if (normA.includes(normB) || normB.includes(normA)) {
            issues.push({
              rule_code: 'spot_color_duplicate_name',
              title: `Nomes de cores especiais duplicados ou conflitantes: ${spots[i]} / ${spots[j]}`,
              category: 'Cor',
              severity: 'warning',
              status: 'pending',
              page: 1,
              found_value: `${spots[i]} e ${spots[j]}`,
              expected_value: 'Nome único por cor especial',
              description: `Foram encontradas variações conflitantes da mesma cor especial no documento (${spots[i]} e ${spots[j]}). Isso pode ocasionar a geração de chapas duplicadas no RIP.`,
              recommendation: 'Unifique as cores especiais conflitantes para um único canal de separação.',
              confidence: 0.98,
              source: 'color_inspector',
              can_auto_correct: false,
            })
          }
        }
      }

      // Atualizar analysis_jobs
      await adminDb
        .from('analysis_jobs')
        .update({
          status: 'completed',
          progress: 100,
          current_step: 'Análise concluída com sucesso',
          completed_at: new Date().toISOString(),
        })
        .eq('id', jobId)

      // Inserir issues
      if (issues.length > 0) {
        const rows = issues.map((iss) => ({
          analysis: jobId,
          project: file.project,
          file: file.id,
          user_id: user.id,
          rule_code: iss.rule_code,
          title: iss.title,
          category: iss.category,
          severity: iss.severity,
          status: 'pending',
          page: iss.page,
          object_id: iss.object_id || '',
          coordinates: iss.coordinates || '',
          found_value: iss.found_value || '',
          expected_value: iss.expected_value || '',
          description: iss.description || '',
          recommendation: iss.recommendation || '',
          confidence: iss.confidence || 1.0,
          source: iss.source || 'color_inspector',
          can_auto_correct: iss.can_auto_correct || false,
        }))
        await adminDb.from('analysis_issues').insert(rows)
      }

      // Atualizar project
      if (file.project) {
        const { count } = await adminDb
          .from('analysis_issues')
          .select('*', { count: 'exact', head: true })
          .eq('project', file.project)
          .eq('status', 'pending')

        await adminDb
          .from('projects')
          .update({
            issue_count: count ?? issues.length,
            severity: issues.some((i) => i.severity === 'critical')
              ? 'critical'
              : issues.some((i) => i.severity === 'warning')
                ? 'warning'
                : 'none',
            status: issues.length > 0 ? 'needs_review' : 'pending_approval',
          })
          .eq('id', file.project)
      }

      return json(200, {
        success: true,
        jobId,
        issuesCount: issues.length,
        processedBy: 'internal_preflight_engine',
      })
    }
  } catch (err: any) {
    return json(500, { error: err?.message || 'Internal server error' })
  }
})
