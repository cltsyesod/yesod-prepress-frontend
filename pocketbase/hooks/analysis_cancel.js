routerAdd(
  'POST',
  '/backend/v1/analyses/{analysisId}/cancel',
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
    var activeStatuses = [
      'queued',
      'preparing',
      'downloading',
      'validating',
      'extracting',
      'analyzing',
      'generating_preview',
    ]

    var isActive = false
    for (var i = 0; i < activeStatuses.length; i++) {
      if (currentStatus === activeStatuses[i]) {
        isActive = true
        break
      }
    }

    if (!isActive) {
      return e.badRequestError(
        'Apenas análises ativas podem ser canceladas (status atual: ' + currentStatus + ')',
      )
    }

    record.set('status', 'cancelled')
    record.set('completed_at', new Date().toISOString())
    $app.save(record)

    return e.json(200, {
      id: record.id,
      status: 'cancelled',
    })
  },
  $apis.requireAuth(),
)
