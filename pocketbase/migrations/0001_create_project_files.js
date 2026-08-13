migrate(
  (app) => {
    const collection = new Collection({
      name: 'project_files',
      type: 'base',
      listRule: 'user = @request.auth.id',
      viewRule: 'user = @request.auth.id',
      createRule: 'user = @request.auth.id',
      updateRule: 'user = @request.auth.id',
      deleteRule: 'user = @request.auth.id',
      fields: [
        { name: 'project', type: 'text', required: true },
        { name: 'version', type: 'text' },
        { name: 'original_name', type: 'text', required: true },
        { name: 'safe_name', type: 'text' },
        { name: 'extension', type: 'text', required: true },
        { name: 'mime_type', type: 'text' },
        { name: 'size_bytes', type: 'number', required: true, onlyInt: true },
        { name: 'sha256', type: 'text' },
        {
          name: 'user',
          type: 'relation',
          required: true,
          collectionId: '_pb_users_auth_',
          cascadeDelete: false,
          maxSelect: 1,
        },
        { name: 'storage_path', type: 'text' },
        {
          name: 'status',
          type: 'select',
          required: true,
          values: [
            'pending',
            'uploading',
            'uploaded',
            'validating',
            'ready_for_analysis',
            'failed',
            'removed',
          ],
          maxSelect: 1,
        },
        { name: 'error', type: 'text' },
        { name: 'is_primary', type: 'bool' },
        {
          name: 'file',
          type: 'file',
          maxSelect: 1,
          maxSize: 104857600,
          mimeTypes: ['application/pdf'],
          protected: true,
        },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE INDEX idx_project_files_project ON project_files (project)',
        'CREATE INDEX idx_project_files_status ON project_files (status)',
        'CREATE INDEX idx_project_files_user ON project_files (user)',
      ],
    })
    app.save(collection)
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('project_files')
    app.delete(collection)
  },
)
