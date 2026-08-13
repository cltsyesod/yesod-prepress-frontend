routerAdd(
  'GET',
  '/backend/v1/project-files/{id}',
  (e) => {
    const userId = e.auth?.id
    if (!userId) return e.unauthorizedError('Autenticação necessária')

    const id = e.request.pathValue('id')
    let record
    try {
      record = $app.findRecordById('project_files', id)
    } catch (_) {
      return e.notFoundError('Arquivo não encontrado')
    }

    if (record.getString('user') !== userId) {
      return e.forbiddenError('Sem permissão para acessar este arquivo')
    }

    return e.json(200, {
      id: record.id,
      project: record.getString('project'),
      version: record.getString('version'),
      original_name: record.getString('original_name'),
      safe_name: record.getString('safe_name'),
      extension: record.getString('extension'),
      mime_type: record.getString('mime_type'),
      size_bytes: record.getInt('size_bytes'),
      sha256: record.getString('sha256'),
      user: record.getString('user'),
      status: record.getString('status'),
      error: record.getString('error'),
      is_primary: record.getBool('is_primary'),
      file: record.getString('file'),
      created: record.getString('created'),
      updated: record.getString('updated'),
    })
  },
  $apis.requireAuth(),
)
