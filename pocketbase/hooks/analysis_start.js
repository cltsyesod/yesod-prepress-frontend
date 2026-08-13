routerAdd(
  'POST',
  '/backend/v1/files/{fileId}/analyze',
  (e) => {
    const userId = e.auth ? e.auth.id : ''
    if (!userId) return e.unauthorizedError('Autenticação necessária')

    const fileId = e.request.pathValue('fileId')

    var fileRecord
    try {
      fileRecord = $app.findRecordById('project_files', fileId)
    } catch (_) {
      return e.notFoundError('Arquivo não encontrado')
    }

    if (fileRecord.getString('user') !== userId) {
      return e.forbiddenError('Sem permissão para acessar este arquivo')
    }

    var ext = fileRecord.getString('extension').toUpperCase()
    if (ext !== 'PDF') {
      return e.badRequestError('Apenas arquivos PDF podem ser analisados')
    }

    var fileStatus = fileRecord.getString('status')
    if (fileStatus !== 'ready_for_analysis') {
      return e.badRequestError(
        'O arquivo não está pronto para análise (status atual: ' + fileStatus + ')',
      )
    }

    var body = e.requestInfo().body || {}
    var profile = body.productionProfile || body.production_profile || null
    if (!profile) {
      return e.badRequestError('productionProfile é obrigatório')
    }

    var profileId = ''
    if (typeof profile === 'string') {
      profileId = profile
    } else {
      profileId = profile.id || profile.name || ''
    }
    if (!profileId) {
      return e.badRequestError('productionProfile.id é obrigatório')
    }

    var escFileId = fileId.replace(/'/g, "''")
    var escUserId = userId.replace(/'/g, "''")
    var dupFilter =
      "file = '" +
      escFileId +
      "' && user = '" +
      escUserId +
      "' && status != 'completed' && status != 'completed_with_warnings'" +
      " && status != 'failed' && status != 'cancelled'"
    try {
      $app.findFirstRecordByFilter('analysis_jobs', dupFilter)
      return e.badRequestError('Já existe uma análise ativa para este arquivo')
    } catch (_) {}

    var col = $app.findCollectionByNameOrId('analysis_jobs')
    var record = new Record(col)
    record.set('project', fileRecord.getString('project'))
    record.set('file', fileId)
    record.set('version', body.version || fileRecord.getString('version') || '')
    record.set('production_profile', profileId)
    record.set('user', userId)
    record.set('status', 'queued')
    record.set('progress', 0)
    record.set('current_step', '')
    record.set('external_job_id', '')
    record.set('retry_count', 0)
    record.set('error_code', '')
    record.set('error_message', '')
    $app.save(record)

    var pp = typeof profile === 'object' ? profile : {}
    var payload = {
      analysisId: record.id,
      projectId: fileRecord.getString('project'),
      fileId: fileId,
      versionId: body.version || fileRecord.getString('version') || '',
      productionProfile: {
        id: pp.id || profileId,
        rules: pp.rules || [],
        colorModeExpected: pp.colorModeExpected || pp.colorMode || 'CMYK',
        minimumResolutionDpi: pp.minimumResolutionDpi || pp.minResolution || 150,
        minimumBleedMm: pp.minimumBleedMm || pp.minBleed || 3,
        minimumSafetyMarginMm: pp.minimumSafetyMarginMm || pp.safetyMargin || 3,
        requiresCutLayer:
          pp.requiresCutLayer !== undefined ? pp.requiresCutLayer : pp.cutLayerRequired || false,
      },
      callbackUrl: '/backend/v1/analyzer/callback',
    }

    return e.json(201, payload)
  },
  $apis.requireAuth(),
)
