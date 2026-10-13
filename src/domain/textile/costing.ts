/**
 * Custos de um pedido em DTF e em DTG, só com os números que o usuário informa.
 *
 * Nada é suposto: parâmetro ausente vira "falta", o custo daquela parte não é calculado
 * e o grau de confiança cai. Moeda e unidades: R$, mm, m, ml, segundos. TypeScript puro.
 */

export interface Order {
  quantity: number
  /** Estampas diferentes no pedido. */
  designs: number
  artWidthMm: number
  artHeightMm: number
  /** Parte da área da arte que tem tinta (0–1); vazio = a área toda (premissa). */
  coverage?: number
  darkGarment: boolean
  garmentCost?: number
  salePrice?: number
  laborPerHour?: number
  fabric?: string
}

export interface DtfParams {
  filmWidthMm?: number
  gapMm?: number
  filmCostPerM?: number
  colorInkMlPerM2?: number
  whiteInkMlPerM2?: number
  colorInkCostPerMl?: number
  whiteInkCostPerMl?: number
  powderCostPerM2?: number
  printMinutesPerM?: number
  pressSecondsPerPiece?: number
  setupMinutes?: number
}

export interface DtgParams {
  areaWidthMm?: number
  areaHeightMm?: number
  colorInkMlPerM2?: number
  whiteInkMlPerM2?: number
  colorInkCostPerMl?: number
  whiteInkCostPerMl?: number
  pretreatCostPerPiece?: number
  printSecondsPerPiece?: number
  cureSecondsPerPiece?: number
  setupMinutes?: number
}

export type Confidence = 'alta' | 'média' | 'baixa'

export interface Part {
  label: string
  value: number
}

export interface MethodResult {
  method: 'DTF' | 'DTG'
  /** A arte cabe no filme / na área (null: não deu para conferir). */
  fits: boolean | null
  parts: Part[]
  /** Custo fixo do pedido (preparação). */
  fixed: number | null
  perUnit: number | null
  orderTotal: number | null
  margin: number | null
  breakEven: number | null
  missing: string[]
  confidence: Confidence
  facts: string[]
  notes: string[]
}

const has = (v: number | undefined): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0
const m2 = (wMm: number, hMm: number) => (wMm * hMm) / 1e6
const SETUP = 'Preparação'

export const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/** Peças por linha no filme e comprimento usado, na melhor orientação. */
export function filmLayout(order: Order, widthMm: number, gapMm: number) {
  const options = [
    { w: order.artWidthMm, h: order.artHeightMm, rotated: false },
    { w: order.artHeightMm, h: order.artWidthMm, rotated: true },
  ].flatMap(({ w, h, rotated }) => {
    const perRow = Math.floor((widthMm + gapMm) / (w + gapMm))
    if (perRow < 1) return []
    const rows = Math.ceil(order.quantity / perRow)
    return [{ perRow, rows, lengthMm: rows * h + Math.max(0, rows - 1) * gapMm, rotated }]
  })
  if (!options.length) return null
  const best = options.reduce((a, b) => (b.lengthMm < a.lengthMm ? b : a))
  const used = order.quantity * m2(order.artWidthMm, order.artHeightMm)
  return { ...best, waste: 1 - used / m2(widthMm, best.lengthMm) }
}

class Builder {
  missing: string[] = []
  optional: string[] = []
  parts: Part[] = []
  facts: string[] = []
  notes: string[] = []
  complete = true
  /** Premissas adotadas (ex.: cobertura total): a confiança não passa de média. */
  assumptions = 0
  fixed = 0

  need(values: (number | undefined)[], labels: string[]): boolean {
    let ok = true
    values.forEach((v, i) => {
      if (!has(v)) {
        this.missing.push(labels[i])
        ok = false
      }
    })
    if (!ok) this.complete = false
    return ok
  }

  maybe(values: (number | undefined)[], label: string): boolean {
    const ok = values.every(has)
    if (!ok) this.optional.push(label)
    return ok
  }

  result(method: 'DTF' | 'DTG', order: Order, fits: boolean | null): MethodResult {
    const variable = this.parts.filter((p) => p.label !== SETUP).reduce((s, p) => s + p.value, 0)
    const complete = this.complete && fits !== false
    const orderTotal = complete ? variable + this.fixed : null
    const perUnit = orderTotal !== null ? orderTotal / order.quantity : null
    const margin = perUnit !== null && has(order.salePrice) ? order.salePrice - perUnit : null
    const unitVariable = variable / order.quantity
    const breakEven =
      complete && has(order.salePrice) && order.salePrice > unitVariable
        ? Math.max(1, Math.ceil(this.fixed / (order.salePrice - unitVariable)))
        : null
    return {
      method,
      fits,
      parts: this.parts,
      fixed: this.fixed,
      perUnit,
      orderTotal,
      margin,
      breakEven,
      missing: [...this.missing, ...this.optional.map((m) => `${m} (opcional)`)],
      confidence: this.missing.length ? 'baixa' : this.optional.length || this.assumptions ? 'média' : 'alta',
      facts: this.facts,
      notes: this.notes,
    }
  }
}

function inkArea(order: Order, b: Builder): number {
  if (order.coverage === undefined) {
    b.assumptions++
    b.notes.push('Premissa: tinta em toda a área da arte (cobertura não informada).')
  }
  return m2(order.artWidthMm, order.artHeightMm) * (order.coverage ?? 1) * order.quantity
}

function common(order: Order, b: Builder, setupMinutes: number | undefined) {
  if (b.maybe([order.garmentCost], 'custo da peça')) b.parts.push({ label: 'Peças', value: order.quantity * order.garmentCost! })
  if (b.maybe([setupMinutes, order.laborPerHour], 'tempo de preparação do pedido e custo da hora')) {
    b.fixed = (setupMinutes! / 60) * order.laborPerHour!
    b.parts.push({ label: SETUP, value: b.fixed })
  }
}

export function costDtf(order: Order, p: DtfParams): MethodResult {
  const b = new Builder()
  let fits: boolean | null = null
  const area = inkArea(order, b)

  if (b.need([p.filmWidthMm, p.gapMm], ['largura útil do filme', 'espaçamento entre artes'])) {
    const layout = filmLayout(order, p.filmWidthMm!, p.gapMm!)
    fits = !!layout
    if (!layout) {
      b.complete = false
      b.facts.push('A arte não cabe na largura do filme em nenhuma posição.')
    } else {
      const meters = layout.lengthMm / 1000
      b.facts.push(
        `${layout.perRow} por linha${layout.rotated ? ' (girada)' : ''}, ${layout.rows} linha(s): ` +
          `${meters.toFixed(2).replace('.', ',')} m de filme, desperdício de ${Math.round(layout.waste * 100)}%.`,
      )
      if (b.need([p.filmCostPerM], ['custo do filme por metro'])) b.parts.push({ label: 'Filme', value: meters * p.filmCostPerM! })
      if (b.maybe([p.powderCostPerM2], 'custo do pó por m²'))
        b.parts.push({ label: 'Pó', value: m2(p.filmWidthMm!, layout.lengthMm) * p.powderCostPerM2! })
      if (b.maybe([p.printMinutesPerM, order.laborPerHour], 'tempo de impressão por metro e custo da hora'))
        b.parts.push({ label: 'Impressão (tempo)', value: ((meters * p.printMinutesPerM!) / 60) * order.laborPerHour! })
    }
  }
  if (b.need([p.colorInkMlPerM2, p.colorInkCostPerMl], ['consumo de tinta colorida (ml/m²)', 'custo da tinta colorida (ml)']))
    b.parts.push({ label: 'Tinta colorida', value: area * p.colorInkMlPerM2! * p.colorInkCostPerMl! })
  // DTF leva base branca em qualquer cor de peça.
  if (b.need([p.whiteInkMlPerM2, p.whiteInkCostPerMl], ['consumo de tinta branca (ml/m²)', 'custo da tinta branca (ml)']))
    b.parts.push({ label: 'Tinta branca', value: area * p.whiteInkMlPerM2! * p.whiteInkCostPerMl! })
  if (b.maybe([p.pressSecondsPerPiece, order.laborPerHour], 'tempo de prensa por peça e custo da hora'))
    b.parts.push({ label: 'Prensagem', value: (order.quantity * p.pressSecondsPerPiece! * order.laborPerHour!) / 3600 })
  common(order, b, p.setupMinutes)
  if (order.designs > 1) b.facts.push(`${order.designs} estampas diferentes podem dividir a mesma folha (montagem).`)
  return b.result('DTF', order, fits)
}

export function costDtg(order: Order, p: DtgParams): MethodResult {
  const b = new Builder()
  let fits: boolean | null = null
  if (b.need([p.areaWidthMm, p.areaHeightMm], ['largura da área imprimível', 'altura da área imprimível'])) {
    fits = order.artWidthMm <= p.areaWidthMm! && order.artHeightMm <= p.areaHeightMm!
    if (!fits) b.facts.push('A arte não cabe na área imprimível do gabarito.')
  }
  const area = inkArea(order, b)
  if (b.need([p.colorInkMlPerM2, p.colorInkCostPerMl], ['consumo de tinta colorida (ml/m²)', 'custo da tinta colorida (ml)']))
    b.parts.push({ label: 'Tinta colorida', value: area * p.colorInkMlPerM2! * p.colorInkCostPerMl! })
  if (order.darkGarment) {
    if (b.need([p.whiteInkMlPerM2, p.whiteInkCostPerMl], ['consumo de tinta branca (ml/m²)', 'custo da tinta branca (ml)']))
      b.parts.push({ label: 'Tinta branca', value: area * p.whiteInkMlPerM2! * p.whiteInkCostPerMl! })
    if (b.need([p.pretreatCostPerPiece], ['custo do pré-tratamento por peça']))
      b.parts.push({ label: 'Pré-tratamento', value: order.quantity * p.pretreatCostPerPiece! })
  } else {
    b.facts.push('Peça clara: confirme no perfil se este equipamento dispensa branco e pré-tratamento.')
  }
  if (b.maybe([p.printSecondsPerPiece, order.laborPerHour], 'tempo de impressão por peça e custo da hora')) {
    const seconds = p.printSecondsPerPiece! + (has(p.cureSecondsPerPiece) ? p.cureSecondsPerPiece : 0)
    b.parts.push({ label: 'Impressão e cura (tempo)', value: (order.quantity * seconds * order.laborPerHour!) / 3600 })
    b.facts.push(`Tempo de máquina: ${Math.round((order.quantity * seconds) / 60)} min.`)
  }
  common(order, b, p.setupMinutes)
  if (order.fabric && !/algod/i.test(order.fabric))
    b.notes.push(`Tecido "${order.fabric}": confirme com o fabricante a tinta e o pré-tratamento para DTG.`)
  return b.result('DTG', order, fits)
}

/** Comparação para o mesmo pedido: só com os dois custos calculados; nunca uma regra geral. */
export function compare(dtf: MethodResult, dtg: MethodResult): { verdict: 'DTF' | 'DTG' | null; text: string; confidence: Confidence } {
  const lacking = [dtf, dtg].filter((r) => r.perUnit === null)
  if (lacking.length) {
    return {
      verdict: null,
      text: `Sem comparação: faltam dados em ${lacking.map((r) => r.method).join(' e ')}.`,
      confidence: 'baixa',
    }
  }
  const cheaper = dtf.perUnit! <= dtg.perUnit! ? dtf : dtg
  const other = cheaper === dtf ? dtg : dtf
  return {
    verdict: cheaper.method,
    text:
      `Para este pedido, ${cheaper.method} sai ${brl(other.perUnit! - cheaper.perUnit!)} mais barato por peça ` +
      `(${brl(cheaper.perUnit!)} × ${brl(other.perUnit!)}). Vale só para estas quantidades e custos; ` +
      'outro pedido pode inverter o resultado.',
    confidence: dtf.confidence === 'alta' && dtg.confidence === 'alta' ? 'alta' : 'média',
  }
}
