import supabase from '@/lib/supabase/client'
import { parseIcc } from '@/domain/color/icc'

/** Perfil ICC da biblioteca da empresa (migration 0016). */
export interface IccProfile {
  id: string
  name: string
  storage_path: string
  profile_class: string
  color_space: string
  pcs: string
  version: string
  description: string
  size_bytes: number
  created_at: string
}

const BUCKET = 'pdfs'
const MAX_ICC_BYTES = 20 * 1024 * 1024

export const iccService = {
  async list(): Promise<IccProfile[]> {
    const { data, error } = await supabase.from('icc_profiles').select('*').order('name')
    if (error) throw error
    return (data ?? []) as IccProfile[]
  },

  /** Lê o cabeçalho (recusa o que não é ICC), guarda o arquivo e registra na biblioteca. */
  async upload(file: File): Promise<IccProfile> {
    if (file.size > MAX_ICC_BYTES) throw new Error('Perfil ICC maior que 20 MB.')
    const info = parseIcc(await file.arrayBuffer())
    const { data: auth } = await supabase.auth.getUser()
    if (!auth.user) throw new Error('Faça login novamente.')
    const path = `${auth.user.id}/icc/${crypto.randomUUID()}.icc`
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { contentType: 'application/vnd.iccprofile', upsert: false })
    if (upErr) throw new Error(`Não foi possível enviar o perfil: ${upErr.message}`)
    const { data, error } = await supabase
      .from('icc_profiles')
      .insert({
        name: info.description || file.name.replace(/\.(icc|icm)$/i, ''),
        storage_path: path,
        profile_class: info.profileClass,
        color_space: info.colorSpace,
        pcs: info.pcs,
        version: info.version,
        description: info.description,
        size_bytes: file.size,
        md5: info.md5,
      })
      .select('*')
      .single()
    if (error) {
      await supabase.storage.from(BUCKET).remove([path]).catch(() => null)
      throw new Error(`Não foi possível registrar o perfil: ${error.message}`)
    }
    return data as IccProfile
  },

  async rename(id: string, name: string): Promise<void> {
    const { error } = await supabase.from('icc_profiles').update({ name }).eq('id', id)
    if (error) throw error
  },

  async remove(profile: IccProfile): Promise<void> {
    const { error } = await supabase.from('icc_profiles').delete().eq('id', profile.id)
    if (error) throw error
    await supabase.storage.from(BUCKET).remove([profile.storage_path]).catch(() => null)
  },
}
