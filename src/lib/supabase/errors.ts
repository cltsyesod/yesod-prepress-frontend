export function getErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message) return message
  }
  return 'An unexpected error occurred.'
}

/** Lança o erro do Supabase (se houver) e devolve os dados. */
export function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw result.error
  return result.data as T
}

/** Converte linha do banco para o formato usado pela UI: user_id -> user, null -> ''. */
export function normalizeRow<T = Record<string, unknown>>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) out[key] = value === null ? '' : value
  if ('user_id' in out) out.user = out.user_id
  return out as T
}
