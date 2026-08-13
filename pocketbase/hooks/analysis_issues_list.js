routerAdd(
  'GET',
  '/backend/v1/analyses/{analysisId}/issues',
  (e) => {
    const userId = e.auth ? e.auth.id : ''
    if (!userId) return e.unauthorizedError('Autenticação necessária')

    var analysisId = e.request.pathValue('analysisId')
    var analysisRecord
    try {
      analysisRecord = $app.findRecordById('analysis_jobs', analysisId)
    } catch (_) {
      return e.notFoundError('Análise não encontrada')
    }

    if (analysisRecord.getString('user') !== userId) {
      return e.forbiddenError('Sem permissão para acessar esta análise')
    }

    var escAnalysisId = analysisId.replace(/'/g, "''")
    var escUserId = userId.replace(/'/g, "''")
    var filterStr = "analysis = '" + escAnalysisId + "' && user = '" + escUserId + "'"

    var records = []
    try {
      records = $app.findRecordsByFilter('analysis_issues', filterStr, '-created', 0, 0)
    } catch (_) {}

    var result = records.map(function (r) {
      return {
        id: r.id,
        analysis: r.getString('analysis'),
        project: r.getString('project'),
        file: r.getString('file'),
        user: r.getString('user'),
        rule_code: r.getString('rule_code'),
        title: r.getString('title'),
        category: r.getString('category'),
        severity: r.getString('severity'),
        status: r.getString('status'),
        page: r.getInt('page'),
        object_id: r.getString('object_id'),
        coordinates: r.getString('coordinates'),
        found_value: r.getString('found_value'),
        expected_value: r.getString('expected_value'),
        description: r.getString('description'),
        recommendation: r.getString('recommendation'),
        confidence: r.get('confidence'),
        source: r.getString('source'),
        can_auto_correct: r.getBool('can_auto_correct'),
        decision_reason: r.getString('decision_reason'),
        decision_user: r.getString('decision_user'),
        decision_at: r.getString('decision_at'),
        created: r.getString('created'),
        updated: r.getString('updated'),
      }
    })

    return e.json(200, result)
  },
  $apis.requireAuth(),
)
