import { useEffect, useState } from 'react'
import { teamService, type Member } from '@/services/teamService'

// A equipe muda pouco: uma leitura por sessão, compartilhada por todas as telas.
let cache: Promise<Member[]> | null = null

export function reloadTeam() {
  cache = teamService.list()
  return cache
}

/** Pessoas da empresa (para escolher o responsável e mostrar nomes). */
export function useTeam() {
  const [members, setMembers] = useState<Member[]>([])
  useEffect(() => {
    let alive = true
    ;(cache ?? reloadTeam())
      .then((list) => alive && setMembers(list))
      .catch(() => {
        cache = null
      })
    return () => {
      alive = false
    }
  }, [])
  const nameOf = (userId?: string | null) =>
    (userId && members.find((m) => m.userId === userId)?.name) || ''
  return { members, nameOf }
}
