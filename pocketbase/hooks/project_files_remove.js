routerAdd(
  'DELETE',
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

    record.set('status', 'removed')
    $app.save(record)

    return e.json(200, { id: record.id, status: 'removed' })
  },
  $apis.requireAuth(),
)
