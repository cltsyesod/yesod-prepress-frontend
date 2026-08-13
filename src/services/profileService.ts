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
      isDefault: true,
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

export const profileService = {
  async listProfiles(): Promise<ProductionProfile[]> {
    await new Promise((r) => setTimeout(r, 150))
    try {
      const data = localStorage.getItem(STORAGE_KEY)
      if (!data) {
        const s = createSeedProfiles()
        saveProfiles(s)
        return s
      }
      const parsed = JSON.parse(data)
      if (!Array.isArray(parsed)) throw new Error('corrupted')
      return parsed
    } catch {
      throw new Error('Erro ao ler perfis do armazenamento local')
    }
  },

  getProfilesSync(): ProductionProfile[] {
    return readProfiles()
  },

  async getProfile(id: string): Promise<ProductionProfile | null> {
    return readProfiles().find((p) => p.id === id) || null
  },

  async createProfile(data: FormData): Promise<ProductionProfile> {
    const profiles = readProfiles()
    const profile: ProductionProfile = {
      ...data,
      id: generateId(),
      createdAt: now(),
      updatedAt: now(),
    }
    profiles.push(profile)
    saveProfiles(profiles)
    return profile
  },

  async updateProfile(id: string, data: FormData): Promise<void> {
    const profiles = readProfiles()
    const idx = profiles.findIndex((p) => p.id === id)
    if (idx === -1) throw new Error('Perfil não encontrado')
    profiles[idx] = { ...profiles[idx], ...data, updatedAt: now() }
    saveProfiles(profiles)
  },

  async deleteProfile(id: string): Promise<void> {
    const profiles = readProfiles().filter((p) => p.id !== id)
    saveProfiles(profiles)
  },

  async duplicateProfile(id: string): Promise<ProductionProfile> {
    const profiles = readProfiles()
    const original = profiles.find((p) => p.id === id)
    if (!original) throw new Error('Perfil não encontrado')
    const copy: ProductionProfile = {
      ...original,
      id: generateId(),
      name: `${original.name} (cópia)`,
      status: 'inactive' as ProfileStatus,
      isDefault: false,
      createdAt: now(),
      updatedAt: now(),
      rules: original.rules.map((r) => ({ ...r })),
    }
    profiles.push(copy)
    saveProfiles(profiles)
    return copy
  },

  async toggleStatus(id: string): Promise<void> {
    const profiles = readProfiles()
    const idx = profiles.findIndex((p) => p.id === id)
    if (idx === -1) throw new Error('Perfil não encontrado')
    profiles[idx].status = profiles[idx].status === 'active' ? 'inactive' : 'active'
    profiles[idx].updatedAt = now()
    saveProfiles(profiles)
  },

  resetProfiles(): void {
    localStorage.removeItem(STORAGE_KEY)
  },
}
