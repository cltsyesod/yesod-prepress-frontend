routerAdd(
  'POST',
  '/backend/v1/project-files/{id}/confirm',
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

    const fileName = record.getString('file')
    if (!fileName) {
      record.set('status', 'failed')
      record.set('error', 'Nenhum arquivo enviado')
      $app.save(record)
      return e.badRequestError('Nenhum arquivo foi enviado')
    }

    if (!fileName.toLowerCase().endsWith('.pdf')) {
      record.set('status', 'failed')
      record.set('error', 'Apenas arquivos PDF são aceitos')
      $app.save(record)
      return e.badRequestError('Apenas arquivos PDF são aceitos')
    }

    var fileExists = false
    const fsys = $app.newFilesystem()
    try {
      const key = record.baseFilesPath() + '/' + fileName
      fileExists = fsys.exists(key)
    } catch (fsErr) {
      fileExists = false
    } finally {
      fsys.close()
    }

    if (!fileExists) {
      record.set('status', 'failed')
      record.set('error', 'Arquivo não encontrado no armazenamento')
      $app.save(record)
      return e.badRequestError('Arquivo não encontrado no armazenamento')
    }

    record.set('status', 'ready_for_analysis')
    record.set('error', '')
    $app.save(record)

    return e.json(200, {
      id: record.id,
      status: 'ready_for_analysis',
      file: fileName,
      original_name: record.getString('original_name'),
      size_bytes: record.getInt('size_bytes'),
    })
  },
  $apis.requireAuth(),
)
