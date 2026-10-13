// Empresa de quem chama: as funções aceitam trabalhos de qualquer colega da mesma empresa.

// deno-lint-ignore no-explicit-any
type Db = any

/** Empresa da conta (membro ativo), ou null para conta sem empresa ou desativada. */
export async function orgOf(db: Db, userId: string): Promise<string | null> {
  const { data } = await db
    .from('memberships')
    .select('org_id')
    .eq('user_id', userId)
    .eq('active', true)
    .maybeSingle()
  return data?.org_id ?? null
}

/** Pasta de quem enviou o arquivo (1º nível do caminho), onde ficam os derivados dele. */
export const ownerFolder = (storagePath: string, fallback: string) =>
  String(storagePath || '').split('/')[0] || fallback
