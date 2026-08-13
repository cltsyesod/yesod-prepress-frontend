routerAdd(
  'POST',
  '/backend/v1/analyses/{analysisId}/retry',
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

    var currentStatus = record.getString('status')
    if (currentStatus !== 'failed') {
      return e.badRequestError(
        'Apenas análises com status "failed" podem ser retentadas (status atual: ' +
          currentStatus +
          ')',
      )
    }

    var retryCount = record.getInt('retry_count') + 1
    record.set('status', 'queued')
    record.set('progress', 0)
    record.set('current_step', '')
    record.set('error_code', '')
    record.set('error_message', '')
    record.set('retry_count', retryCount)
    record.set('completed_at', '')
    record.set('started_at', '')
    $app.save(record)

    return e.json(200, {
      id: record.id,
      status: 'queued',
      retry_count: retryCount,
    })
  },
  $apis.requireAuth(),
)
