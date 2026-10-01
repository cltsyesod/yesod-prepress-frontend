import { useEffect, useRef } from 'react'

import supabase from '@/lib/supabase/client'
import { normalizeRow } from '@/lib/supabase/errors'

export interface RealtimeEvent<TRecord = Record<string, unknown>> {
  action: 'create' | 'update' | 'delete'
  record: TRecord
}

/**
 * Hook para assinar mudanças em tempo real de uma tabela do Supabase.
 * SEMPRE use este hook em vez de assinar diretamente.
 * Cada chamada cria seu próprio canal, então vários componentes podem
 * assinar a mesma tabela sem conflito.
 */
export function useRealtime<TRecord = Record<string, unknown>>(
  table: string,
  callback: (data: RealtimeEvent<TRecord>) => void,
  enabled: boolean = true,
) {
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  useEffect(() => {
    if (!enabled) return

    const channel = supabase
      .channel(`rt-${table}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
        const action =
          payload.eventType === 'INSERT' ? 'create' : payload.eventType === 'DELETE' ? 'delete' : 'update'
        const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Record<string, unknown>
        callbackRef.current({ action, record: normalizeRow<TRecord>(row) })
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [table, enabled])
}

export default useRealtime
