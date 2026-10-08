/**
 * Modelo do painelamento (tiling). Tudo em milímetros no tamanho final, com origem no
 * canto inferior esquerdo do formato final da arte (TrimBox do PDF), eixo Y para cima.
 *
 * Cinco níveis que nunca se misturam:
 * ARTE (fonte imutável) → PROJETO (esta configuração) → GEOMETRIA (calculada pelo motor)
 * → ARQUIVO DE IMPRESSÃO (gerado pelo analyzer) → GUIA DE MONTAGEM (documentação derivada).
 */

export type Edge = 'top' | 'right' | 'bottom' | 'left'
export const EDGES: Edge[] = ['top', 'right', 'bottom', 'left']
export type Edges = Record<Edge, number>

export const zeroEdges = (): Edges => ({ top: 0, right: 0, bottom: 0, left: 0 })

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** A composição final: a arte no tamanho final. */
export interface Poster {
  /** Formato final da arte (TrimBox × escala), em mm. */
  width: number
  height: number
  /** Fator do arquivo para o tamanho final (10 para um arquivo em 1:10). */
  scale: number
  /** Conteúdo além do formato final que o arquivo realmente tem (sangria disponível). */
  availableBleed: Edges
}

/**
 * Grade lógica. `xs`/`ys` são as linhas de corte, de 0 até a largura/altura do poster.
 * Linhas (rows) contam de baixo para cima internamente; a identificação L1 é a de cima.
 */
export interface Grid {
  xs: number[]
  ys: number[]
  /** "auto": gerada pelos parâmetros; "custom": o operador editou (não recalcular sem pedir). */
  mode: 'auto' | 'custom'
  /** Colunas/linhas com largura/altura travada (índices). */
  lockedColumns: number[]
  lockedRows: number[]
}

/** Uma emenda tem fresta: faixa da arte que não é impressa (porta, estrutura, perfil). */
export interface GapSetting {
  width: number
  /** "centered": metade de cada painel; "before": sai do painel da esquerda/de baixo; "after": do outro. */
  mode: 'centered' | 'before' | 'after'
}

/** O que o operador mudou num painel (o resto vem do padrão do projeto). */
export interface TileSettings {
  enabled?: boolean
  overlap?: Partial<Edges>
  white?: Partial<Edges>
  name?: string
  zone?: string
  number?: number
}

/** A mídia na impressora: de onde sai a largura imprimível. */
export interface MediaSettings {
  /** Largura nominal da mídia (rolo ou chapa). */
  width: number
  /** Margens que a impressora não imprime, em cada lado da largura. */
  marginLeft: number
  marginRight: number
  /** Faixa reservada para a barra de cor/controle, ao lado dos painéis. */
  colorBar: number
  /** Espaço entre painéis na mídia (para o corte). */
  spacing: number
  /** Preço da mídia por m² (0 = sem custo). */
  pricePerM2: number
}

/** Como o painel entra na mídia: em pé, deitado (girado 90°) ou o que couber melhor. */
export type Direction = 'standing' | 'lying' | 'auto'

export interface PrintConstraint {
  /**
   * Largura imprimível do material. Com `media`, é calculada (largura da mídia menos as
   * margens e a barra de cor); sem ela, é digitada direto.
   */
  printableWidth: number
  /** Comprimento máximo (0 = rolo sem limite). */
  printableLength: number
  /** "standing": largura do painel na largura do material; "lying": altura do painel nela. */
  direction: Direction
  media?: MediaSettings
  /**
   * Flip-flop: painéis alternados saem girados 180°, para que as duas bordas de cada emenda
   * sejam impressas do mesmo lado da cabeça (cor igual na emenda).
   */
  flipFlop?: boolean
}

export interface TilingRules {
  /** Sobreposição padrão por borda: só vale onde há painel vizinho. */
  overlap: Edges
  /** Área branca de colagem/solda padrão por borda: sem tinta, fora da imagem. */
  white: Edges
  /** Sangria pedida em cada borda externa do poster (limitada à disponível no arquivo). */
  bleed: Edges
  /** Menor painel aceito (largura e altura do que ele cobre). */
  minimumTile: number
}

export interface TilingProjectModel {
  version: 2
  poster: Poster
  grid: Grid
  /** Grupos de células ("c,r") juntadas num painel só. */
  merged: string[][]
  /** Configuração por painel; a chave é a célula de origem (canto superior esquerdo). */
  tiles: Record<string, TileSettings>
  /** Frestas por emenda: "v:<índice em xs>" ou "h:<índice em ys>". */
  gaps: Record<string, GapSetting>
  rules: TilingRules
  constraint: PrintConstraint
  /** Modelo do nome do arquivo: {projeto} {cliente} {lin} {col} {n} {nn} {zona}. */
  nameTemplate: string
}

/** Resultado do motor para um painel. */
export interface TileGeometry {
  key: string
  cells: string[]
  /** Identificação determinística: L1C1 = linha de cima, primeira coluna. */
  id: string
  number: number
  row: number
  column: number
  name: string
  zone: string
  enabled: boolean
  /** O que o painel cobre da arte (grade lógica menos frestas). */
  logical: Rect
  /** O que é impresso: lógico + sobreposições + sangria nas bordas externas. */
  print: Rect
  /** O painel físico: impresso + área branca de colagem. */
  physical: Rect
  overlap: Edges
  white: Edges
  bleed: Edges
  neighbours: Partial<Record<Edge, string>>
  /** Giro do painel na mídia (graus, sentido horário): 90 = deitado, +180 no flip-flop. */
  rotation: 0 | 90 | 180 | 270
}

/** Onde cada painel cai na mídia: x na largura (a partir da margem), y no comprimento. */
export interface MediaPlacement {
  tile: string
  x: number
  y: number
  /** Medidas na mídia (já giradas), com a margem técnica das marcas. */
  across: number
  along: number
  rotation: 0 | 90 | 180 | 270
}

export interface MediaLayout {
  /** Largura da mídia (nominal; sem mídia informada, a largura imprimível). */
  width: number
  printableWidth: number
  /** Comprimento de mídia consumido. */
  length: number
  placements: MediaPlacement[]
  /** Área dos painéis físicos, em m². */
  panelArea: number
  /** Área de mídia consumida (largura × comprimento), em m². */
  mediaArea: number
  /** Parte da mídia consumida que não vira painel (0–1). */
  waste: number
  /** Custo da mídia consumida (null sem preço informado). */
  cost: number | null
}

export interface SeamGeometry {
  id: string
  orientation: 'vertical' | 'horizontal'
  position: number
  start: number
  end: number
  gap: GapSetting | null
}

export type Severity = 'error' | 'warning'

export interface Issue {
  severity: Severity
  code: string
  message: string
  tile?: string
}

export interface ProjectGeometry {
  tiles: TileGeometry[]
  seams: SeamGeometry[]
  /** Faixas impressas por dois painéis (sobreposições). */
  overlaps: Rect[]
  issues: Issue[]
  /** Aproveitamento da largura do material pelo painel mais largo (0–1). */
  mediaUsage: number
  /** Painéis distribuídos na mídia (null sem largura imprimível). */
  media: MediaLayout | null
}
