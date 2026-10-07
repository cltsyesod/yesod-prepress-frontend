// Contrato com o yesod-prepress-analyzer (ver yesod-prepress-analyzer/README.md).

const encoder = new TextEncoder()

const toHex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')

/** HMAC-SHA256(secret, timestamp + "." + requestId + "." + body), no formato "sha256=<hex>". */
export async function signRequest(
  secret: string,
  timestamp: string,
  requestId: string,
  body: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`${timestamp}.${requestId}.${body}`),
  )
  return `sha256=${toHex(signature)}`
}

/** Comparação em tempo constante da assinatura recebida no callback. */
export async function verifySignature(
  secret: string,
  timestamp: string | null,
  requestId: string | null,
  signature: string | null,
  body: string,
  toleranceSeconds = 300,
): Promise<boolean> {
  if (!timestamp || !requestId || !signature) return false
  const age = Math.abs(Date.now() / 1000 - Number(timestamp))
  if (!Number.isFinite(age) || age > toleranceSeconds) return false
  const expected = await signRequest(secret, timestamp, requestId, body)
  if (expected.length !== signature.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i)
  return diff === 0
}

type Json = Record<string, unknown>

const positive = (value: unknown): number | undefined => {
  const n = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

const nonNegative = (value: unknown): number | undefined =>
  value === 0 || value === '0' ? 0 : positive(value)

/** Escala para o tamanho final: 5, "5", "1:5" ou "1:5 (painel)" -> 5. */
const scaleFactor = (value: unknown): number | undefined => {
  const match = String(value ?? '').match(/(\d+(?:[.,]\d+)?)\s*:\s*(\d+(?:[.,]\d+)?)/)
  if (match) return positive(Number(match[2].replace(',', '.')) / Number(match[1].replace(',', '.')))
  return positive(value)
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

// Chaves de regra do frontend -> códigos de regra do analyzer.
const RULE_CODES: Record<string, string[]> = {
  color_mode: ['IMAGE_RGB', 'COLOR_RGB_CONTENT'],
  resolution: ['IMAGE_LOW_RESOLUTION'],
  bleed: ['PAGE_BLEED_INSUFFICIENT'],
  fonts: ['FONT_NOT_EMBEDDED', 'FONT_PROGRAM_INVALID'],
  cut_layer: ['FINISHING_CUT_LAYER'],
  dimensions: ['PAGE_DIMENSION_MISMATCH', 'PAGE_SIZE_INCONSISTENT'],
  icc_profile: ['COLOR_OUTPUT_INTENT'],
}

/**
 * Converte o perfil de produção (formato do frontend) + a ficha técnica do trabalho
 * no ProductionProfile do analyzer. A ficha do trabalho tem prioridade sobre o perfil.
 */
export function toAnalyzerProfile(id: string, profile: Json, ticket: Json): Json {
  const cutName = text(profile.cutLayerName)
  const rules = Array.isArray(profile.rules)
    ? (profile.rules as Json[]).flatMap((rule) =>
        (RULE_CODES[String(rule.key)] ?? []).map((code) => ({
          code,
          enabled: rule.enabled !== false,
          severity: ['critical', 'warning', 'info', 'informational'].includes(String(rule.severity))
            ? rule.severity
            : undefined,
        })),
      )
    : []

  return {
    id: id || 'job',
    name: text(profile.name),
    rules,
    colorModeExpected: text(profile.colorMode),
    minimumResolutionDpi: positive(ticket.minResolution ?? profile.minResolution),
    minimumBleedMm: nonNegative(ticket.minBleed ?? profile.minBleed),
    minimumSafetyMarginMm: nonNegative(ticket.safetyMargin ?? profile.safetyMargin),
    requiresCutLayer: Boolean(ticket.cutLayerRequired ?? profile.cutLayerRequired),
    cutLayerNames: cutName ? [cutName, 'CutContour', 'Corte', 'Cut'] : undefined,
    maximumInkCoveragePercent: positive(ticket.inkCoverageLimit ?? profile.inkCoverageLimit),
    rgbPolicy: (ticket.rgbPolicy ?? profile.rgbPolicy) === 'cmyk_only' ? 'cmyk_only' : 'managed',
    fileScale: scaleFactor(ticket.fileScale) ?? scaleFactor(profile.scale),
    finalWidthMm: positive(ticket.finalWidthMm),
    finalHeightMm: positive(ticket.finalHeightMm),
    dimensionToleranceMm: nonNegative(ticket.dimensionToleranceMm),
  }
}
