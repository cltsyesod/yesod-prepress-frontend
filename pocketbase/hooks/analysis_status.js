routerAdd(
  'GET',
  '/backend/v1/analyses/{analysisId}/status',
  (e) => {
    const userId = e.auth ? e.auth.id : ''
    if (!userId) return e.unauthorizedError('Autenticação necessária')

    var analysisId = e.request.pathValue('analysisId')
    var record
    try {
      record = $app.findRecordById('analysis_jobs', analysisId)
    } catch (_) {
      return e.notFoundError('Análise não encontrada')
    }

    if (record.getString('user') !== userId) {
      return e.forbiddenError('Sem permissão para acessar esta análise')
    }

    return e.json(200, {
      id: record.id,
      status: record.getString('status'),
      progress: record.getInt('progress'),
      current_step: record.getString('current_step'),
      started_at: record.getString('started_at'),
      completed_at: record.getString('completed_at'),
      error_code: record.getString('error_code'),
      error_message: record.getString('error_message'),
    })
  },
  $apis.requireAuth(),
)
