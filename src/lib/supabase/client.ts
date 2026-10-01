import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  console.error('Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY (.env local e variáveis da Vercel).')
}

const supabase = createClient(url ?? 'http://localhost', anonKey ?? 'missing-anon-key')

export default supabase
