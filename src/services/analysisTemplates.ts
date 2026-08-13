import type { Severity } from '@/types'

export interface ProblemTemplate {
  name: string
  severity: Severity
  category: string
  description: string
  technicalRule: string
  foundValue: string
  recommendedValue: string
  correctionSuggestion: string
  confidence: number
  autoFixable: boolean
}

const TEMPLATES: ProblemTemplate[] = [
  {
    name: 'Espaço de cor RGB detectado',
    severity: 'critical',
    category: 'Espaço de Cor',
    description:
      'Objetos no arquivo estão utilizando espaço de cor RGB em vez de CMYK exigido para a produção.',
    technicalRule:
      'Todos os objetos devem estar no espaço de cor CMYK conforme perfil de produção.',
    foundValue: 'RGB (sRGB IEC61966-2.1)',
    recommendedValue: 'CMYK (Coated FOGRA39)',
    correctionSuggestion: 'Converta todos os objetos para CMYK utilizando o perfil ICC adequado.',
    confidence: 98,
    autoFixable: true,
  },
  {
    name: 'Resolução de imagem abaixo de 300 DPI',
    severity: 'critical',
    category: 'Resolução de Imagem',
    description: 'Imagens no documento estão com resolução inferior ao mínimo recomendado.',
    technicalRule: 'Resolução mínima de 300 DPI para imagens em impressão offset.',
    foundValue: '150 DPI',
    recommendedValue: '300 DPI',
    correctionSuggestion:
      'Substitua as imagens por versões em alta resolução ou reduza o dimensionamento.',
    confidence: 95,
    autoFixable: false,
  },
  {
    name: 'Sangria ausente',
    severity: 'warning',
    category: 'Sangria',
    description: 'O arquivo não possui área de sangria configurada.',
    technicalRule: 'Sangria mínima de 3mm em todos os lados.',
    foundValue: '0mm',
    recommendedValue: '3mm',
    correctionSuggestion: 'Adicione 3mm de sangria em todos os lados do documento.',
    confidence: 92,
    autoFixable: true,
  },
  {
    name: 'Fontes não convertidas em curvas',
    severity: 'warning',
    category: 'Fontes',
    description: 'Existem fontes no arquivo que não foram convertidas em curvas/outlines.',
    technicalRule: 'Todas as fontes devem ser convertidas em curvas antes do envio.',
    foundValue: 'Fontes ativas (OpenType)',
    recommendedValue: 'Curvas (outlines)',
    correctionSuggestion: 'Converta todas as fontes em curvas no aplicativo de origem.',
    confidence: 88,
    autoFixable: true,
  },
  {
    name: 'Layer de corte ausente',
    severity: 'critical',
    category: 'Corte',
    description: 'Não foi encontrado um layer dedicado para linha de corte.',
    technicalRule: 'Um layer separado nomeado "Corte" deve conter as linhas de corte.',
    foundValue: 'Layer de corte não encontrado',
    recommendedValue: 'Layer "Corte" com linhas em 100% Magenta',
    correctionSuggestion: 'Crie um layer nomeado "Corte" e mova todas as linhas de corte para ele.',
    confidence: 90,
    autoFixable: false,
  },
  {
    name: 'Sangria inferior a 3mm',
    severity: 'info',
    category: 'Sangria',
    description: 'A sangria configurada está abaixo do mínimo recomendado.',
    technicalRule: 'Sangria mínima de 3mm para impressão.',
    foundValue: '1.5mm',
    recommendedValue: '3mm',
    correctionSuggestion: 'Aumente a área de sangria para no mínimo 3mm em todos os lados.',
    confidence: 85,
    autoFixable: true,
  },
  {
    name: 'Line screen incompatível',
    severity: 'warning',
    category: 'Flexografia',
    description: 'A resolução de tela (LPI) não corresponde ao especificado.',
    technicalRule: 'Line screen deve ser 175 LPI para flexografia até 6 cores.',
    foundValue: '133 LPI',
    recommendedValue: '175 LPI',
    correctionSuggestion: 'Reconfigure o line screen no RIP para 175 LPI.',
    confidence: 87,
    autoFixable: true,
  },
  {
    name: 'Resolução abaixo de 150 DPI',
    severity: 'critical',
    category: 'Resolução de Imagem',
    description: 'Para grande formato, a resolução está abaixo do mínimo aceitável.',
    technicalRule: 'Resolução mínima de 150 DPI para impressão digital grande formato.',
    foundValue: '72 DPI',
    recommendedValue: '150 DPI',
    correctionSuggestion: 'Substitua por imagem em maior resolução ou reduza o tamanho.',
    confidence: 96,
    autoFixable: false,
  },
  {
    name: 'Overprint ativo em objeto branco',
    severity: 'warning',
    category: 'Overprint',
    description: 'Objetos brancos com overprint ativo podem desaparecer na impressão.',
    technicalRule: 'Overprint deve estar desativado para objetos brancos.',
    foundValue: 'Overprint: Ativo',
    recommendedValue: 'Overprint: Inativo',
    correctionSuggestion: 'Desative o overprint em todos os objetos com preenchimento branco.',
    confidence: 84,
    autoFixable: true,
  },
  {
    name: 'Rich black acima de 300%',
    severity: 'info',
    category: 'Tinta Total',
    description: 'Áreas pretas estão com cobertura de tinta acima do limite.',
    technicalRule: 'Cobertura total de tinta não deve exceder 300% (TAC).',
    foundValue: '340%',
    recommendedValue: '≤ 300%',
    correctionSuggestion: 'Ajuste a fórmula do rich black para C60 M40 Y40 K100.',
    confidence: 82,
    autoFixable: true,
  },
  {
    name: 'Marcas de corte ausentes',
    severity: 'warning',
    category: 'Marcas',
    description: 'O arquivo não possui marcas de corte registradas.',
    technicalRule: 'Marcas de corte devem estar presentes fora da área de sangria.',
    foundValue: 'Marcas ausentes',
    recommendedValue: 'Marcas de corte em todos os cantos',
    correctionSuggestion: 'Adicione marcas de corte ao exportar o PDF.',
    confidence: 91,
    autoFixable: true,
  },
  {
    name: 'Transparência não achatada',
    severity: 'warning',
    category: 'Transparência',
    description: 'Efeitos de transparência não foram achatados (flattened).',
    technicalRule: 'Todas as transparências devem ser achatadas antes do envio.',
    foundValue: 'Transparências ativas',
    recommendedValue: 'Transparências achatadas',
    correctionSuggestion: 'Achue as transparências no aplicativo de origem.',
    confidence: 79,
    autoFixable: true,
  },
]

const PROFILE_MAP: Record<string, number[]> = {
  'Offset 4x4 - Cores': [0, 1, 2, 3, 8, 9],
  'Digital Grand Formato': [0, 1, 2, 7, 10],
  Flexografia: [0, 2, 4, 6, 10],
  'Offset 1x1 - Preto e Branco': [2, 3, 9, 10],
  'Hot Stamping': [0, 1, 4, 10],
  'Digital Pequeno Formato': [0, 1, 2, 3],
  Serigrafia: [0, 2, 4, 6],
}

export function getTemplatesForProfile(profile: string): ProblemTemplate[] {
  const indices = PROFILE_MAP[profile] || [0, 1, 2]
  return indices.map((i) => TEMPLATES[i])
}
