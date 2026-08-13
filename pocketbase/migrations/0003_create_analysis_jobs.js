migrate(
  (app) => {
    const projectFilesCol = app.findCollectionByNameOrId('project_files')

    const collection = new Collection({
      name: 'analysis_jobs',
      type: 'base',
      listRule: 'user = @request.auth.id',
      viewRule: 'user = @request.auth.id',
      createRule: 'user = @request.auth.id',
      updateRule: 'user = @request.auth.id',
      deleteRule: 'user = @request.auth.id',
      fields: [
        { name: 'project', type: 'text', required: true },
        {
          name: 'file',
          type: 'relation',
          required: true,
          collectionId: projectFilesCol.id,
          cascadeDelete: false,
          maxSelect: 1,
        },
        { name: 'version', type: 'text' },
        { name: 'production_profile', type: 'text' },
        {
          name: 'user',
          type: 'relation',
          required: true,
          collectionId: '_pb_users_auth_',
          cascadeDelete: true,
          maxSelect: 1,
        },
        {
          name: 'status',
          type: 'select',
          required: true,
          values: [
            'queued',
            'preparing',
            'downloading',
            'validating',
            'extracting',
            'analyzing',
            'generating_preview',
            'completed',
            'completed_with_warnings',
            'failed',
            'cancelled',
          ],
          maxSelect: 1,
        },
        { name: 'progress', type: 'number', min: 0, max: 100, onlyInt: true },
        { name: 'current_step', type: 'text' },
        { name: 'external_job_id', type: 'text' },
        { name: 'started_at', type: 'date' },
        { name: 'completed_at', type: 'date' },
        { name: 'error_code', type: 'text' },
        { name: 'error_message', type: 'text' },
        { name: 'retry_count', type: 'number', onlyInt: true },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE INDEX idx_analysis_jobs_status ON analysis_jobs (status)',
        'CREATE INDEX idx_analysis_jobs_file ON analysis_jobs (file)',
        'CREATE INDEX idx_analysis_jobs_project ON analysis_jobs (project)',
        'CREATE INDEX idx_analysis_jobs_user ON analysis_jobs (user)',
      ],
    })
    app.save(collection)
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('analysis_jobs')
    app.delete(collection)
  },
)
