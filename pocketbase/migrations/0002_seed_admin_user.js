migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('_pb_users_auth_')

    try {
      app.findAuthRecordByEmail('_pb_users_auth_', 'camilimag@gmail.com')
      return
    } catch (_) {}

    const record = new Record(users)
    record.setEmail('camilimag@gmail.com')
    record.setPassword('Skip@Pass')
    record.setVerified(true)
    record.set('name', 'Admin')
    app.save(record)
  },
  (app) => {
    try {
      const record = app.findAuthRecordByEmail('_pb_users_auth_', 'camilimag@gmail.com')
      app.delete(record)
    } catch (_) {}
  },
)
