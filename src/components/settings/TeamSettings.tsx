import { useCallback, useEffect, useState } from 'react'
import { Loader2, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/hooks/use-auth'
import { reloadTeam } from '@/hooks/use-team'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/supabase/errors'
import { cn } from '@/lib/utils'
import { ROLE_LABEL, teamService, type Member } from '@/services/teamService'

/**
 * Empresa e equipe. Todos veem quem faz parte; só o administrador inclui operadores,
 * desativa ou reativa o acesso e renomeia a empresa. Desativar não apaga nada: os
 * trabalhos da pessoa continuam na empresa.
 */
export function TeamSettings() {
  const { user, membership, refreshMembership } = useAuth()
  const owner = membership?.role === 'owner'
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [orgName, setOrgName] = useState(membership?.orgName ?? '')
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    try {
      setMembers(await reloadTeam())
    } catch (err) {
      toast({ title: 'Não foi possível carregar a equipe', description: getErrorMessage(err), variant: 'destructive' })
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])
  useEffect(() => setOrgName(membership?.orgName ?? ''), [membership?.orgName])

  const run = async (key: string, action: () => Promise<unknown>, done: string) => {
    setBusy(key)
    try {
      await action()
      toast({ title: done })
      await load()
    } catch (err) {
      toast({ title: 'Não foi possível concluir', description: getErrorMessage(err), variant: 'destructive' })
    }
    setBusy('')
  }

  const add = () =>
    run(
      'add',
      async () => {
        await teamService.add(form)
        setForm({ name: '', email: '', password: '' })
        setAdding(false)
      },
      'Operador incluído. Passe o e-mail e a senha provisória para a pessoa.',
    )

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Empresa e equipe</h2>
        <p className="text-sm text-muted-foreground">
          Todos da equipe trabalham nos mesmos trabalhos, arquivos, montagens e painéis.
        </p>
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="org-name">Nome da empresa</Label>
          <Input id="org-name" value={orgName} disabled={!owner} onChange={(e) => setOrgName(e.target.value)} />
        </div>
        {owner && (
          <Button
            variant="outline"
            disabled={!orgName.trim() || orgName.trim() === membership?.orgName || busy === 'rename'}
            onClick={() =>
              run(
                'rename',
                async () => {
                  await teamService.rename(orgName.trim())
                  await refreshMembership()
                },
                'Nome da empresa salvo',
              )
            }
          >
            Salvar nome
          </Button>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="text-sm font-semibold text-foreground">Pessoas ({members.filter((m) => m.active).length})</p>
          {owner && !adding && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <UserPlus className="h-4 w-4" />
              Incluir operador
            </Button>
          )}
        </div>

        {adding && (
          <div className="space-y-3 border-b border-border bg-muted/30 p-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="member-name">Nome</Label>
                <Input id="member-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="member-email">E-mail</Label>
                <Input
                  id="member-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="member-password">Senha provisória</Label>
                <Input
                  id="member-password"
                  type="text"
                  autoComplete="off"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="mínimo 8 caracteres"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              A conta já fica ativa. Entregue o e-mail e a senha à pessoa; ela pode trocar a senha depois.
            </p>
            <div className="flex gap-2">
              <Button
                disabled={!form.name.trim() || !form.email.trim() || form.password.length < 8 || busy === 'add'}
                onClick={add}
              >
                {busy === 'add' && <Loader2 className="h-4 w-4 animate-spin" />}
                Incluir
              </Button>
              <Button variant="ghost" onClick={() => setAdding(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        )}

        {loading ? (
          <Loader2 className="m-6 mx-auto h-5 w-5 animate-spin text-muted-foreground" />
        ) : (
          <ul className="divide-y divide-border">
            {members.map((m) => (
              <li key={m.userId} className={cn('flex items-center gap-3 px-4 py-3', !m.active && 'opacity-60')}>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                  {initials(m.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {m.name}
                    {m.userId === user?.id && <span className="font-normal text-muted-foreground"> (você)</span>}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">{m.email}</span>
                </span>
                <span className="text-xs text-muted-foreground">{m.active ? ROLE_LABEL[m.role] : 'Desativado'}</span>
                {owner && m.userId !== user?.id && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy === m.userId}
                    onClick={() =>
                      run(
                        m.userId,
                        () => teamService.setActive(m.userId, !m.active),
                        m.active ? `${m.name} não tem mais acesso` : `${m.name} voltou a ter acesso`,
                      )
                    }
                  >
                    {m.active ? 'Desativar' : 'Reativar'}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
