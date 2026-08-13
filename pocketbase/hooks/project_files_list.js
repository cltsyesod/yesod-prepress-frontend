routerAdd(
  'GET',
  '/backend/v1/project-files/by-project/{projectId}',
  (e) => {
    const userId = e.auth?.id
    if (!userId) return e.unauthorizedError('Autenticação necessária')

    const projectId = e.request.pathValue('projectId')
    const escProject = projectId.replace(/'/g, "''")
    const filterStr =
      "project = '" + escProject + "' && user = '" + userId + "' && status != 'removed'"

    let records = []
    try {
      records = $app.findRecordsByFilter('project_files', filterStr, '-created', 0, 0)
    } catch (_) {}

    const result = records.map(function (r) {
      return {
        id: r.id,
        project: r.getString('project'),
        version: r.getString('version'),
        original_name: r.getString('original_name'),
        safe_name: r.getString('safe_name'),
        extension: r.getString('extension'),
        mime_type: r.getString('mime_type'),
        size_bytes: r.getInt('size_bytes'),
        sha256: r.getString('sha256'),
        user: r.getString('user'),
        status: r.getString('status'),
        error: r.getString('error'),
        is_primary: r.getBool('is_primary'),
        file: r.getString('file'),
        created: r.getString('created'),
        updated: r.getString('updated'),
      }
    })

    return e.json(200, result)
  },
  $apis.requireAuth(),
)
