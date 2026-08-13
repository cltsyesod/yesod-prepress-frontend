routerAdd(
  'PATCH',
  '/backend/v1/project-files/{id}/set-primary',
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

    const projectId = record.getString('project')
    const escProject = projectId.replace(/'/g, "''")
    const filterStr =
      "project = '" + escProject + "' && user = '" + userId + "' && status != 'removed'"

    let allFiles = []
    try {
      allFiles = $app.findRecordsByFilter('project_files', filterStr, '', 0, 0)
    } catch (_) {}

    $app.runInTransaction(function (txApp) {
      for (let i = 0; i < allFiles.length; i++) {
        const f = allFiles[i]
        if (f.getBool('is_primary')) {
          f.set('is_primary', false)
          txApp.save(f)
        }
      }
      const target = txApp.findRecordById('project_files', id)
      target.set('is_primary', true)
      txApp.save(target)
    })

    return e.json(200, { id: record.id, is_primary: true })
  },
  $apis.requireAuth(),
)
