/**
 * Ghent Workgroup GWG 2022 (base PDF/X-4): as variantes que o Yesod oferece e os valores
 * oficiais (perfis de preflight publicados em gwg.org), para mostrar ao escolher o padrão.
 * A conferência roda no analisador (app/standards/gwg2022.py); os valores precisam bater.
 */

export type GwgVariant = 'wide_format' | 'digital' | 'sheet' | 'packaging_offset'

export interface GwgSummary {
  key: GwgVariant
  label: string
  binding: string
  values: [string, string][]
}

export const GWG_2022: GwgSummary[] = [
  {
    key: 'wide_format',
    label: 'Comunicação visual (GWG 2022 Wide Format Print)',
    binding: 'RGB aceito: o RIP converte (late binding)',
    values: [
      ['Texto 100% preto em sobreimpressão', 'abaixo de 12 pt'],
      ['Texto pequeno branco / com mais de uma tinta', 'abaixo de 5 pt'],
      ['Linha fina branca / com mais de uma tinta', 'abaixo de 0,15 pt'],
      ['Resolução de imagem (erro / aviso)', 'até 239 / abaixo de 299 ppi'],
      ['Imagem de traço 1 bit (erro / aviso)', 'até 549 / abaixo de 799 ppi'],
      ['Página feita de uma só imagem', '239 / 300 ppi'],
    ],
  },
  {
    key: 'digital',
    label: 'Impressão digital (GWG 2022 Digital Print)',
    binding: 'RGB com perfil aceito (intermediate binding)',
    values: [
      ['Texto em preto rico', 'K ≥ 85% com tinta total acima de 280%'],
      ['Texto pequeno branco / com mais de uma tinta', 'abaixo de 5 pt'],
      ['Linha fina branca / com mais de uma tinta', 'abaixo de 0,25 pt'],
      ['Resolução de imagem (erro / aviso)', 'até 95 / abaixo de 149 ppi'],
      ['Imagem de traço 1 bit (erro / aviso)', 'até 349 / abaixo de 599 ppi'],
      ['Página feita de uma só imagem', '95 / 150 ppi'],
    ],
  },
  {
    key: 'sheet',
    label: 'Gráfica em folha (GWG 2022 SheetCmyk CMYK + RGB)',
    binding: 'RGB com perfil aceito (intermediate binding)',
    values: [
      ['Texto 100% preto em sobreimpressão', 'abaixo de 12 pt'],
      ['Texto em preto rico', 'K ≥ 85% com tinta total acima de 280%'],
      ['Texto pequeno branco / com mais de uma tinta', 'abaixo de 8 pt'],
      ['Linha fina branca / com mais de uma tinta', 'abaixo de 0,25 pt'],
      ['Resolução de imagem (erro / aviso)', 'até 149 / abaixo de 224 ppi'],
      ['Imagem de traço 1 bit (erro / aviso)', 'até 549 / abaixo de 799 ppi'],
      ['Página feita de uma só imagem', '149 / 225 ppi'],
      ['Fonte Courier', 'apontada'],
    ],
  },
  {
    key: 'packaging_offset',
    label: 'Embalagem offset (GWG 2022 Packaging Offset)',
    binding: 'Cores já convertidas: só CMYK e especiais (early binding)',
    values: [
      ['Texto 100% preto em sobreimpressão', 'abaixo de 12 pt'],
      ['Texto em preto rico', 'K ≥ 85% com tinta total acima de 280%'],
      ['Texto pequeno branco / com mais de uma tinta', 'abaixo de 5 / 8 pt'],
      ['Linha fina branca / com mais de uma tinta', 'abaixo de 0,15 / 0,3 pt'],
      ['Resolução de imagem (erro / aviso)', 'até 239 / abaixo de 299 ppi'],
      ['Imagem de traço 1 bit (erro / aviso)', 'até 549 / abaixo de 799 ppi'],
      ['Página feita de uma só imagem', '449 / 1200 ppi'],
      ['Camadas e fonte Courier', 'apontadas'],
    ],
  },
]

/** Valem para todas as variantes. */
export const GWG_COMMON = [
  'Branco com sobreimpressão (texto e vetor) é erro',
  'CropBox igual à página',
  'Base PDF/X-4: perfil de saída, fontes incorporadas, caixas',
]
