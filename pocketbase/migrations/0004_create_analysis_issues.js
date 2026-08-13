migrate(
  (app) => {
    const analysisJobsCol = app.findCollectionByNameOrId('analysis_jobs')
    const projectFilesCol = app.findCollectionByNameOrId('project_files')

    const collection = new Collection({
      name: 'analysis_issues',
      type: 'base',
      listRule: 'user = @request.auth.id',
      viewRule: 'user = @request.auth.id',
      createRule: 'user = @request.auth.id',
      updateRule: 'user = @request.auth.id',
      deleteRule: 'user = @request.auth.id',
      fields: [
        {
          name: 'analysis',
          type: 'relation',
          required: true,
          collectionId: analysisJobsCol.id,
          cascadeDelete: true,
          maxSelect: 1,
        },
        { name: 'project', type: 'text' },
        {
          name: 'file',
          type: 'relation',
          collectionId: projectFilesCol.id,
          cascadeDelete: false,
          maxSelect: 1,
        },
        {
          name: 'user',
          type: 'relation',
          required: true,
          collectionId: '_pb_users_auth_',
          cascadeDelete: true,
          maxSelect: 1,
        },
        { name: 'rule_code', type: 'text' },
        { name: 'title', type: 'text' },
        { name: 'category', type: 'text' },
        {
          name: 'severity',
          type: 'select',
          values: ['critical', 'warning', 'informational'],
          maxSelect: 1,
        },
        {
          name: 'status',
          type: 'select',
          values: ['pending', 'approved', 'rejected', 'ignored', 'corrected'],
          maxSelect: 1,
        },
        { name: 'page', type: 'number', onlyInt: true },
        { name: 'object_id', type: 'text' },
        { name: 'coordinates', type: 'text' },
        { name: 'found_value', type: 'text' },
        { name: 'expected_value', type: 'text' },
        { name: 'description', type: 'text' },
        { name: 'recommendation', type: 'text' },
        { name: 'confidence', type: 'number' },
        { name: 'source', type: 'text' },
        { name: 'can_auto_correct', type: 'bool' },
        { name: 'decision_reason', type: 'text' },
        {
          name: 'decision_user',
          type: 'relation',
          collectionId: '_pb_users_auth_',
          cascadeDelete: false,
          maxSelect: 1,
        },
        { name: 'decision_at', type: 'date' },
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: [
        'CREATE INDEX idx_analysis_issues_analysis ON analysis_issues (analysis)',
        'CREATE INDEX idx_analysis_issues_file ON analysis_issues (file)',
        'CREATE INDEX idx_analysis_issues_project ON analysis_issues (project)',
        'CREATE INDEX idx_analysis_issues_severity ON analysis_issues (severity)',
        'CREATE INDEX idx_analysis_issues_status ON analysis_issues (status)',
      ],
    })
    app.save(collection)
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('analysis_issues')
    app.delete(collection)
  },
)
