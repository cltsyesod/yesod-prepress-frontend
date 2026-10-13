/**
 * Módulos isolados: gráfica (fila, montagem e perfis gerais) e têxtil (DTF / DTG, em
 * /textil). A mesma tela serve aos dois, filtrada pela tecnologia do perfil do trabalho.
 */

import type { ProductionProfile } from '@/types'

export type Scope = 'print' | 'textile'

export const isTextile = (technology?: string) => technology === 'dtf' || technology === 'dtg'

export const profileInScope = (profile: Pick<ProductionProfile, 'technology'> | undefined, scope: Scope) =>
  scope === 'textile' ? isTextile(profile?.technology) : !isTextile(profile?.technology)

/** Trabalho sem perfil conhecido fica na gráfica. */
export function jobInScope(profileId: string, profiles: ProductionProfile[], scope: Scope) {
  return profileInScope(
    profiles.find((p) => p.id === profileId),
    scope,
  )
}

/** Para onde voltar da tela do trabalho. */
export const homeOf = (technology?: string) => (isTextile(technology) ? '/textil' : '/trabalhos')
