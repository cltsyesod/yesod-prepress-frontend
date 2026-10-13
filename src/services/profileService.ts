import supabase from '@/lib/supabase/client'
import type { ProductionProfile, TechnicalRule, Severity, ProfileStatus } from '@/types'

const STORAGE_KEY = 'productionProfiles'

const RULE_DEFINITIONS: {
  key: string
  label: string
  defaultSeverity: Severity
  defaultEnabled: boolean
}[] = [
  { key: 'color_mode', label: 'Modo de cor', defaultSeverity: 'critical', defaultEnabled: true },
  { key: 'resolution', label: 'Resolução', defaultSeverity: 'critical', defaultEnabled: true },
  { key: 'bleed', label: 'Sangria', defaultSeverity: 'warning', defaultEnabled: true },
  { key: 'margins', label: 'Margens', defaultSeverity: 'warning', defaultEnabled: true },
  { key: 'fonts', label: 'Fontes', defaultSeverity: 'warning', defaultEnabled: true },
  {
    key: 'embedded_images',
    label: 'Imagens incorporadas',
    defaultSeverity: 'critical',
    defaultEnabled: true,
  },
  { key: 'black', label: 'Preto', defaultSeverity: 'info', defaultEnabled: true },
  { key: 'overprint', label: 'Overprint', defaultSeverity: 'info', defaultEnabled: false },
  { key: 'cut_layer', label: 'Layer de corte', defaultSeverity: 'warning', defaultEnabled: false },
  { key: 'dimensions', label: 'Dimensões', defaultSeverity: 'warning', defaultEnabled: true },
  { key: 'scale', label: 'Escala', defaultSeverity: 'info', defaultEnabled: true },
  { key: 'icc_profile', label: 'Perfil de cor', defaultSeverity: 'info', defaultEnabled: true },
]

export function createDefaultRules(): TechnicalRule[] {
  return RULE_DEFINITIONS.map((r) => ({
    key: r.key,
    label: r.label,
    enabled: r.defaultEnabled,
    severity: r.defaultSeverity,
  }))
}

const now = () => new Date().toISOString()

function make(
  id: string,
  name: string,
  desc: string,
  cat: string,
  overrides: Partial<ProductionProfile> = {},
): ProductionProfile {
  return {
    id,
    name,
    description: desc,
    status: 'active',
    category: cat,
    allowedFormats: ['PDF', 'AI', 'EPS'],
    colorMode: 'CMYK',
    iccProfile: '',
    minResolution: 300,
    blackConfig: 'Standard',
    inkCoverageLimit: 320,
    minBleed: 3,
    safetyMargin: 3,
    scale: '1:1',
    cropMarks: true,
    cutLayerRequired: false,
    cutLayerName: '',
    cutLayerColor: '',
    specialFinishes: '',
    rules: createDefaultRules(),
    isDefault: false,
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  }
}

function withCutLayer(profile: ProductionProfile): ProductionProfile {
  return {
    ...profile,
    rules: profile.rules.map((r) =>
      r.key === 'cut_layer' ? { ...r, enabled: true, severity: 'critical' as Severity } : r,
    ),
  }
}

function createSeedProfiles(): ProductionProfile[] {
  return [
    make('wp-1', 'Gráfica offset', 'Perfil para impressão offset padrão', 'Offset', {
      iccProfile: 'ISO Coated v2 (ECI)',
    }),
    make('wp-2', 'Impressão digital', 'Perfil para impressão digital', 'Digital', {
      iccProfile: 'sRGB IEC61966-2.1',
    }),
    make('wp-3', 'Comunicação visual', 'Perfil para comunicação visual', 'Comunicação Visual', {
      minResolution: 150,
      minBleed: 5,
      safetyMargin: 5,
      iccProfile: 'sRGB IEC61966-2.1',
    }),
    withCutLayer(
      make('wp-4', 'Adesivo com recorte', 'Perfil para adesivos com recorte', 'Adesivo', {
        cutLayerRequired: true,
        cutLayerName: 'Corte',
        cutLayerColor: 'Magenta',
      }),
    ),
    make('wp-5', 'Lona', 'Perfil para impressão em lona', 'Lona', {
      minResolution: 150,
      minBleed: 5,
      safetyMargin: 5,
    }),
    make('wp-6', 'Backlight', 'Perfil para impressão backlight', 'Backlight', {
      minResolution: 300,
      minBleed: 5,
      safetyMargin: 5,
    }),
    withCutLayer(
      make('wp-7', 'Embalagem', 'Perfil para embalagens', 'Embalagem', {
        cutLayerRequired: true,
        cutLayerName: 'Corte',
        cutLayerColor: 'Magenta',
        inkCoverageLimit: 280,
      }),
    ),
    make(
      'wp-custom',
      'Perfil personalizado',
      'Perfil personalizável para casos especiais',
      'Personalizado',
    ),
  ]
}

function saveProfiles(profiles: ProductionProfile[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles))
}

function readProfiles(): ProductionProfile[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY)
    if (!data) {
      const seeds = createSeedProfiles()
      saveProfiles(seeds)
      return seeds
    }
    const parsed = JSON.parse(data)
    if (!Array.isArray(parsed)) throw new Error('invalid')
    return parsed
  } catch {
    const seeds = createSeedProfiles()
    saveProfiles(seeds)
    return seeds
  }
}

function generateId(): string {
  return `prof-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

type FormData = Omit<ProductionProfile, 'id' | 'createdAt' | 'updatedAt'>

/** Perfil guardado: a linha em production_profiles (empresa inteira) vira `dbId`. */
type Stored = ProductionProfile & { dbId?: string }

const toRow = (p: Stored) => {
  const { dbId: _db, ...settings } = p
  return { name: p.name, is_default: !!p.isDefault, settings }
}

/** Grava no banco da empresa; a cópia local continua para leitura imediata. */
async function persist(profile: Stored): Promise<Stored> {
  if (profile.dbId) {
    const { error } = await supabase
      .from('production_profiles')
      .update(toRow(profile))
      .eq('id', profile.dbId)
    if (error) throw new Error(`Não foi possível salvar o perfil: ${error.message}`)
    return profile
  }
  const { data, error } = await supabase
    .from('production_profiles')
    .insert(toRow(profile))
    .select('id')
    .single()
  if (error) throw new Error(`Não foi possível salvar o perfil: ${error.message}`)
  return { ...profile, dbId: data.id as string }
}

function replaceLocal(profile: Stored): void {
  const profiles = readProfiles() as Stored[]
  const idx = profiles.findIndex((p) => p.id === profile.id)
  if (idx === -1) profiles.push(profile)
  else profiles[idx] = profile
  saveProfiles(profiles)
}

let syncing: Promise<ProductionProfile[]> | null = null

export const profileService = {
  /**
   * Lê os perfis da empresa. Na primeira vez, se o banco estiver vazio, envia os perfis
   * deste navegador (mantendo os ids, que os trabalhos já usam).
   */
  async syncFromServer(): Promise<ProductionProfile[]> {
    syncing ??= (async () => {
      try {
        const { data, error } = await supabase
          .from('production_profiles')
          .select('id, name, is_default, settings')
          .order('created_at')
        if (error) throw error
        if (!data.length) {
          const uploaded: Stored[] = []
          for (const local of readProfiles() as Stored[]) {
            uploaded.push(await persist({ ...local, dbId: undefined }))
          }
          saveProfiles(uploaded)
          return uploaded
        }
        const profiles: Stored[] = data.map((row) => ({
          ...(row.settings as ProductionProfile),
          id: (row.settings as ProductionProfile)?.id || (row.id as string),
          name: row.name as string,
          isDefault: !!row.is_default,
          rules: (row.settings as ProductionProfile)?.rules ?? createDefaultRules(),
          dbId: row.id as string,
        }))
        saveProfiles(profiles)
        return profiles
      } finally {
        syncing = null
      }
    })()
    return syncing
  },

  async listProfiles(): Promise<ProductionProfile[]> {
    try {
      return await this.syncFromServer()
    } catch {
      return readProfiles()
    }
  },

  getProfilesSync(): ProductionProfile[] {
    return readProfiles()
  },

  async getProfile(id: string): Promise<ProductionProfile | null> {
    return readProfiles().find((p) => p.id === id) || null
  },

  async createProfile(data: FormData): Promise<ProductionProfile> {
    const profile = await persist({ ...data, id: generateId(), createdAt: now(), updatedAt: now() })
    replaceLocal(profile)
    return profile
  },

  async updateProfile(id: string, data: FormData): Promise<void> {
    const current = (readProfiles() as Stored[]).find((p) => p.id === id)
    if (!current) throw new Error('Perfil não encontrado')
    replaceLocal(await persist({ ...current, ...data, id, dbId: current.dbId, updatedAt: now() }))
  },

  async deleteProfile(id: string): Promise<void> {
    const current = (readProfiles() as Stored[]).find((p) => p.id === id)
    if (current?.dbId) {
      const { error } = await supabase.from('production_profiles').delete().eq('id', current.dbId)
      if (error) throw new Error(`Não foi possível excluir o perfil: ${error.message}`)
    }
    saveProfiles(readProfiles().filter((p) => p.id !== id))
  },

  async duplicateProfile(id: string): Promise<ProductionProfile> {
    const original = (readProfiles() as Stored[]).find((p) => p.id === id)
    if (!original) throw new Error('Perfil não encontrado')
    const copy = await persist({
      ...original,
      dbId: undefined,
      id: generateId(),
      name: `${original.name} (cópia)`,
      status: 'inactive' as ProfileStatus,
      isDefault: false,
      createdAt: now(),
      updatedAt: now(),
      rules: original.rules.map((r) => ({ ...r })),
    })
    replaceLocal(copy)
    return copy
  },

  async toggleStatus(id: string): Promise<void> {
    const current = (readProfiles() as Stored[]).find((p) => p.id === id)
    if (!current) throw new Error('Perfil não encontrado')
    const status: ProfileStatus = current.status === 'active' ? 'inactive' : 'active'
    replaceLocal(await persist({ ...current, status, updatedAt: now() }))
  },

  /** Só limpa a cópia deste navegador; os perfis da empresa ficam no banco. */
  resetProfiles(): void {
    localStorage.removeItem(STORAGE_KEY)
  },
}
