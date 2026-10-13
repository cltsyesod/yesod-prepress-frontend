import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

// Equipe da empresa: o dono inclui operadores (conta com senha provisória, já
// confirmada), desativa e reativa o acesso e renomeia a empresa. Contas nunca são
// apagadas: as tabelas apagam em cascata o que a conta criou.

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const FOREVER = '876000h' // ~100 anos: acesso bloqueado até reativar

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !serviceRoleKey) return json(500, { error: 'Supabase não configurado' })

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json(401, { error: 'Missing Authorization header' })
    const authClient = createClient(supabaseUrl, anonKey || serviceRoleKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const {
      data: { user },
    } = await authClient.auth.getUser()
    if (!user) return json(401, { error: 'Autenticação necessária' })

    const db = createClient(supabaseUrl, serviceRoleKey)
    const { data: me } = await db
      .from('memberships')
      .select('org_id, role')
      .eq('user_id', user.id)
      .eq('active', true)
      .maybeSingle()
    if (!me) return json(403, { error: 'Sua conta não está vinculada a uma empresa.' })
    if (me.role !== 'owner') return json(403, { error: 'Só o dono da empresa gerencia a equipe.' })

    const body = await req.json().catch(() => ({}))
    const action = String(body.action || '')

    if (action === 'add') {
      const name = String(body.name || '').trim()
      const email = String(body.email || '').trim().toLowerCase()
      const password = String(body.password || '')
      if (!name) return json(400, { error: 'Informe o nome.' })
      if (!EMAIL.test(email)) return json(400, { error: 'E-mail inválido.' })
      if (password.length < 8) return json(400, { error: 'A senha provisória precisa de ao menos 8 caracteres.' })

      const { data: created, error } = await db.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name },
      })
      if (error || !created?.user) {
        const exists = /already|registered|exists/i.test(error?.message ?? '')
        return json(400, {
          error: exists ? 'Este e-mail já tem uma conta no sistema.' : `Não foi possível criar a conta: ${error?.message ?? ''}`,
        })
      }
      const { error: memberError } = await db.from('memberships').insert({
        org_id: me.org_id,
        user_id: created.user.id,
        role: 'operator',
        name,
        email,
      })
      if (memberError) return json(500, { error: `Conta criada, mas sem vínculo à empresa: ${memberError.message}` })
      return json(200, { success: true, userId: created.user.id })
    }

    if (action === 'deactivate' || action === 'reactivate') {
      const userId = String(body.userId || '')
      if (!userId) return json(400, { error: 'userId é obrigatório' })
      if (userId === user.id) return json(400, { error: 'Você não pode desativar a própria conta.' })
      const { data: member } = await db
        .from('memberships')
        .select('user_id')
        .eq('org_id', me.org_id)
        .eq('user_id', userId)
        .maybeSingle()
      if (!member) return json(404, { error: 'Pessoa não encontrada na equipe.' })
      const active = action === 'reactivate'
      const { error } = await db.from('memberships').update({ active }).eq('org_id', me.org_id).eq('user_id', userId)
      if (error) return json(500, { error: error.message })
      // Também bloqueia o login, para a sessão não continuar valendo.
      await db.auth.admin.updateUserById(userId, { ban_duration: active ? 'none' : FOREVER })
      return json(200, { success: true })
    }

    if (action === 'rename') {
      const name = String(body.name || '').trim()
      if (!name) return json(400, { error: 'Informe o nome da empresa.' })
      const { error } = await db.from('organizations').update({ name }).eq('id', me.org_id)
      if (error) return json(500, { error: error.message })
      return json(200, { success: true })
    }

    return json(400, { error: 'Ação desconhecida' })
  } catch (err: any) {
    return json(500, { error: err?.message || 'Internal server error' })
  }
})
