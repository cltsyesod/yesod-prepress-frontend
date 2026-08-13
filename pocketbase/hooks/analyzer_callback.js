routerAdd('POST', '/backend/v1/analyzer/callback', (e) => {
  var body = e.requestInfo().body || {}
  var analysisId = body.analysisId || body.analysis_id || ''

  if (!analysisId) {
    return e.badRequestError('analysisId é obrigatório')
  }

  var record
  try {
    record = $app.findRecordById('analysis_jobs', analysisId)
  } catch (_) {
    return e.notFoundError('Análise não encontrada')
  }

  var newStatus = body.status || ''
  var runningStatuses = [
    'preparing',
    'downloading',
    'validating',
    'extracting',
    'analyzing',
    'generating_preview',
  ]
  var terminalStatuses = ['completed', 'completed_with_warnings', 'failed', 'cancelled']

  if (newStatus) {
    record.set('status', newStatus)

    var isRunning = false
    for (var i = 0; i < runningStatuses.length; i++) {
      if (newStatus === runningStatuses[i]) {
        isRunning = true
        break
      }
    }

    if (isRunning && !record.getString('started_at')) {
      record.set('started_at', new Date().toISOString())
    }

    var isTerminal = false
    for (var j = 0; j < terminalStatuses.length; j++) {
      if (newStatus === terminalStatuses[j]) {
        isTerminal = true
        break
      }
    }

    if (isTerminal) {
      record.set('completed_at', new Date().toISOString())
    }
  }

  if (body.progress !== undefined && body.progress !== null) {
    var progressVal = parseInt(body.progress, 10)
    if (!isNaN(progressVal)) {
      record.set('progress', Math.max(0, Math.min(100, progressVal)))
    }
  }

  if (body.currentStep || body.current_step) {
    record.set('current_step', body.currentStep || body.current_step)
  }

  if (body.externalJobId || body.external_job_id) {
    record.set('external_job_id', body.externalJobId || body.external_job_id)
  }

  if (body.errorCode || body.error_code) {
    record.set('error_code', body.errorCode || body.error_code)
  }

  if (body.errorMessage || body.error_message) {
    record.set('error_message', body.errorMessage || body.error_message)
  }

  $app.save(record)

  if (body.issues && Array.isArray(body.issues) && body.issues.length > 0) {
    var issuesCol = $app.findCollectionByNameOrId('analysis_issues')
    var analysisUserId = record.getString('user')
    var analysisProjectId = record.getString('project')
    var analysisFileId = record.getString('file')

    for (var k = 0; k < body.issues.length; k++) {
      var issue = body.issues[k] || {}
      var issueRecord = new Record(issuesCol)
      issueRecord.set('analysis', analysisId)
      issueRecord.set('project', analysisProjectId)
      issueRecord.set('file', analysisFileId)
      issueRecord.set('user', analysisUserId)
      issueRecord.set('rule_code', issue.ruleCode || issue.rule_code || '')
      issueRecord.set('title', issue.title || '')
      issueRecord.set('category', issue.category || '')
      issueRecord.set('severity', issue.severity || 'informational')
      issueRecord.set('status', issue.status || 'pending')
      issueRecord.set('page', issue.page || 0)
      issueRecord.set('object_id', issue.objectId || issue.object_id || '')

      var coords = issue.coordinates || issue.coords || ''
      if (typeof coords !== 'string') {
        coords = JSON.stringify(coords)
      }
      issueRecord.set('coordinates', coords)

      issueRecord.set('found_value', issue.foundValue || issue.found_value || '')
      issueRecord.set('expected_value', issue.expectedValue || issue.expected_value || '')
      issueRecord.set('description', issue.description || '')
      issueRecord.set('recommendation', issue.recommendation || '')
      issueRecord.set('confidence', issue.confidence || 0)
      issueRecord.set('source', issue.source || 'external_analyzer')
      issueRecord.set('can_auto_correct', issue.canAutoCorrect || issue.can_auto_correct || false)
      $app.save(issueRecord)
    }
  }

  return e.json(200, {
    id: record.id,
    status: record.getString('status'),
    progress: record.getInt('progress'),
    current_step: record.getString('current_step'),
  })
})
