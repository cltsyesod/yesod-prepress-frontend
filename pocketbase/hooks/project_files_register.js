routerAdd(
  'POST',
  '/backend/v1/project-files/register',
  (e) => {
    const body = e.requestInfo().body || {}
    const userId = e.auth?.id
    if (!userId) return e.unauthorizedError('Autenticação necessária')

    const project = (body.project || '').trim()
    if (!project) return e.badRequestError('project é obrigatório')

    const originalName = (body.original_name || '').trim()
    if (!originalName) return e.badRequestError('original_name é obrigatório')

    const extension = (body.extension || '').trim().toUpperCase()
    if (extension !== 'PDF') {
      return e.badRequestError(
        'Este formato será disponibilizado em uma próxima fase. Para a análise real atual, envie um arquivo PDF.',
      )
    }

    const mimeType = (body.mime_type || '').trim()
    if (mimeType && mimeType !== 'application/pdf') {
      return e.badRequestError('Apenas arquivos PDF são aceitos')
    }

    const sizeBytes = Number(body.size_bytes || 0)
    if (!sizeBytes || sizeBytes <= 0) return e.badRequestError('size_bytes deve ser positivo')
    if (sizeBytes > 104857600) return e.badRequestError('Arquivo muito grande (máx 100MB)')

    const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_')

    const escProject = project.replace(/'/g, "''")
    const escName = originalName.replace(/'/g, "''")
    const dupFilter =
      "project = '" +
      escProject +
      "' && original_name = '" +
      escName +
      "' && user = '" +
      userId +
      "' && status != 'removed'"
    try {
      $app.findFirstRecordByFilter('project_files', dupFilter)
      return e.badRequestError('Um arquivo com este nome já existe neste projeto')
    } catch (_) {}

    const col = $app.findCollectionByNameOrId('project_files')
    const record = new Record(col)
    record.set('project', project)
    record.set('version', body.version || '')
    record.set('original_name', originalName)
    record.set('safe_name', safeName)
    record.set('extension', extension)
    record.set('mime_type', 'application/pdf')
    record.set('size_bytes', sizeBytes)
    record.set('user', userId)
    record.set('status', 'pending')
    record.set('is_primary', false)
    record.set('error', '')
    $app.save(record)

    return e.json(201, { id: record.id, status: 'pending' })
  },
  $apis.requireAuth(),
)
