/**
 * Como corrigir cada ocorrência: as saídas reais que o pré-impressor tem, em ordem de
 * preferência. Três tipos:
 *
 * - `fix`: o sistema corrige numa cópia (o arquivo do cliente fica guardado);
 * - `client`: pedir ao cliente, com o texto exato do pedido (vai para a mensagem);
 * - `accept`: seguir assim, com o motivo sugerido (fica registrado como exceção).
 *
 * Só entra aqui o que é tecnicamente correto num fluxo pré-RIP: nada converte cores,
 * redesenha a arte ou troca fontes por conta própria.
 */

import type { AnalysisIssue, IssueFix } from '@/services/analysisJobsService'

export type Solution =
  | { kind: 'fix'; title: string; text: string; fix: IssueFix }
  | { kind: 'client'; title: string; text: string; request: string }
  | { kind: 'accept'; title: string; text: string; reason: string }

/** Primeiro número em mm do texto (ex.: "Ao menos 5 mm em todos os lados" → 5). */
function mmIn(text: string): number | undefined {
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*mm/)
  return match ? Number(match[1].replace(',', '.')) : undefined
}

/** As 14 fontes padrão do PDF: todo RIP tem uma versão com as mesmas medidas. */
const BASE14 = /^(Helvetica|Times|Courier|Symbol|ZapfDingbats)(\b|-|,)/i

const BLEED_FIX = (mm?: number): IssueFix => ({
  id: 'add_bleed',
  target: 'pdf',
  label: mm ? `Gerar ${mm} mm de sangria` : 'Gerar sangria',
  params: mm ? { bleedMm: mm } : {},
})

const SRGB_FIX: IssueFix = { id: 'assign_rgb_profile', target: 'pdf', label: 'Atribuir perfil sRGB' }

function catalogue(issue: AnalysisIssue): Solution[] {
  const font = issue.found_value
  switch (issue.rule_code) {
    case 'PAGE_BLEED_INSUFFICIENT': {
      const mm = mmIn(issue.expected_value)
      const measurable = !/não verificável/i.test(issue.title)
      return [
        ...(measurable
          ? [
              {
                kind: 'fix' as const,
                title: 'Gerar a sangria no sistema',
                text: 'Estende a borda da arte para fora do corte, esticando (fundos e degradês) ou espelhando (fotos). Nada dentro do formato final muda.',
                fix: BLEED_FIX(mm),
              },
            ]
          : []),
        {
          kind: 'client',
          title: 'Pedir a arte com sangria',
          text: 'Quando há texto ou elemento importante encostado na borda.',
          request: `Reenviar o arquivo com ${mm ?? 'a'} ${mm ? 'mm de ' : ''}sangria em cada lado: fundos e imagens devem passar da linha de corte, e textos devem ficar longe dela.`,
        },
        {
          kind: 'accept',
          title: 'Seguir sem sangria',
          text: 'Só se a peça não for refilada rente à arte.',
          reason: 'Peça com margem branca no corte; sangria não é necessária.',
        },
      ]
    }

    case 'COLOR_RGB_CONTENT':
    case 'IMAGE_RGB': {
      const cmykOnly = /exigido/i.test(issue.expected_value)
      if (cmykOnly) {
        return [
          {
            kind: 'client',
            title: 'Pedir o arquivo em CMYK',
            text: 'Este trabalho exige CMYK. A conversão muda as cores e precisa da aprovação de quem criou a arte.',
            request: 'Converter as cores para CMYK com o perfil da gráfica antes de exportar o PDF.',
          },
          {
            kind: 'accept',
            title: 'Deixar o RIP converter',
            text: 'Se o perfil do RIP para RGB foi conferido para este material.',
            reason: 'Conversão RGB → CMYK feita no RIP com o perfil do material.',
          },
        ]
      }
      return [
        {
          kind: 'fix',
          title: 'Atribuir perfil sRGB',
          text: 'Declara o RGB sem perfil como sRGB (o padrão de câmeras, telas e programas). Os valores de cor não mudam; o RIP converte para CMYK sempre do mesmo jeito, em qualquer equipamento.',
          fix: SRGB_FIX,
        },
        {
          kind: 'accept',
          title: 'Deixar como está',
          text: 'O RIP usa o perfil RGB padrão dele, que normalmente já é o sRGB.',
          reason: 'O RIP interpreta RGB sem perfil como sRGB.',
        },
        {
          kind: 'client',
          title: 'Pedir com perfil incorporado',
          text: 'Quando a arte foi feita em outro perfil (ex.: Adobe RGB) e a cor é crítica.',
          request: 'Exportar o PDF incorporando o perfil de cor das imagens e objetos (ex.: Adobe RGB ou sRGB).',
        },
      ]
    }

    case 'FONT_NOT_EMBEDDED': {
      const standard = BASE14.test(font)
      return [
        {
          kind: 'client',
          title: 'Pedir com a fonte incorporada',
          text: 'Única correção segura: sem o arquivo da fonte, o sistema não pode incorporá-la nem convertê-la em curvas.',
          request: `Exportar o PDF com todas as fontes incorporadas, ou com os textos convertidos em curvas (a fonte "${font}" não veio no arquivo).`,
        },
        standard
          ? {
              kind: 'accept',
              title: 'Aceitar a fonte padrão do PDF',
              text: `"${font}" é uma das 14 fontes padrão do PDF: todo RIP tem uma versão com as mesmas medidas. Confira os textos na prova.`,
              reason: `${font} é fonte padrão do PDF; o RIP usa a versão dele, com as mesmas medidas.`,
            }
          : {
              kind: 'accept',
              title: 'Aceitar porque a fonte está no RIP',
              text: 'Só se a mesma fonte estiver instalada no RIP. Senão, o RIP troca por outra e o texto muda.',
              reason: `Fonte ${font} instalada no RIP.`,
            },
      ]
    }

    case 'FONT_PROGRAM_INVALID':
      return [
        {
          kind: 'client',
          title: 'Pedir a fonte reincorporada',
          text: 'A fonte veio danificada no arquivo; o texto pode sair errado.',
          request: `Reexportar o PDF incorporando de novo a fonte "${font}", ou convertendo os textos em curvas.`,
        },
      ]

    case 'IMAGE_LOW_RESOLUTION':
      return [
        {
          kind: 'accept',
          title: 'Aceitar pela distância de visualização',
          text: 'Peças vistas de longe (fachadas, painéis, lonas) toleram resolução menor.',
          reason: `Peça vista de longe; ${issue.found_value} é suficiente.`,
        },
        {
          kind: 'client',
          title: 'Pedir a imagem em maior resolução',
          text: 'Quando a peça é vista de perto.',
          request: `Enviar as imagens com pelo menos ${issue.expected_value || 'a resolução pedida'} no tamanho final.`,
        },
      ]

    case 'PAGE_DIMENSION_MISMATCH':
      return [
        {
          kind: 'client',
          title: 'Pedir o arquivo na medida certa',
          text: 'Se o pedido está certo e o arquivo veio em outra medida.',
          request: `Enviar o arquivo na medida ${issue.expected_value}. Recebemos ${issue.found_value}.`,
        },
        {
          kind: 'accept',
          title: 'Seguir com a medida do arquivo',
          text: 'Se o cliente confirmou que a medida do arquivo é a certa: depois, corrija a ficha.',
          reason: 'Cliente confirmou a medida do arquivo.',
        },
      ]

    case 'FINISHING_CUT_LAYER':
      return [
        {
          kind: 'client',
          title: 'Pedir o arquivo com a faca',
          text: 'Quando o formato do corte não pode ser deduzido da arte.',
          request: 'Enviar o arquivo com a linha de corte em cor especial (ex.: CutContour), em traço, sem preenchimento.',
        },
      ]

    case 'COLOR_INK_COVERAGE':
      return [
        {
          kind: 'accept',
          title: 'Deixar o RIP limitar a carga',
          text: 'O perfil de saída do RIP limita a carga total de tinta na conversão.',
          reason: 'Carga de tinta limitada pelo perfil do RIP.',
        },
        {
          kind: 'client',
          title: 'Pedir a arte com menos carga',
          text: 'Quando o arquivo já vem em CMYK final e não será convertido.',
          request: `Reduzir a carga total de tinta das áreas escuras para no máximo ${issue.expected_value || 'o limite da gráfica'}.`,
        },
      ]

    case 'COLOR_SPOT_DUPLICATE':
      return [
        {
          kind: 'client',
          title: 'Pedir as cores especiais unificadas',
          text: 'Nomes diferentes para a mesma cor viram chapas ou canais diferentes no RIP.',
          request: `Unificar o nome das cores especiais (${issue.found_value}).`,
        },
        {
          kind: 'accept',
          title: 'Unificar no RIP',
          text: 'Se o RIP tem tabela de cores especiais com os dois nomes.',
          reason: 'Cores especiais unificadas na tabela do RIP.',
        },
      ]

    case 'IMAGE_TRANSPARENCY':
      return [
        {
          kind: 'accept',
          title: 'Deixar o RIP achatar',
          text: 'RIPs com motor PDF (APPE) tratam transparência nativamente.',
          reason: 'RIP com tratamento nativo de transparência.',
        },
      ]

    case 'FILE_PDFX_REQUIRED':
      return [
        {
          kind: 'client',
          title: 'Pedir em PDF/X',
          text: 'Este trabalho exige PDF/X.',
          request: 'Exportar o arquivo em PDF/X-4 (ou PDF/X-1a, se a gráfica pedir).',
        },
      ]

    case 'FILE_PDF_SYNTAX':
    case 'FILE_PDFIUM_RENDER':
      return [
        {
          kind: 'client',
          title: 'Pedir o arquivo exportado de novo',
          text: 'O arquivo está danificado; corrigir aqui poderia esconder um erro.',
          request: 'Reexportar o PDF a partir do arquivo original (o enviado está danificado).',
        },
      ]

    default:
      return []
  }
}

/** Opções de correção da ocorrência: a correção do analisador primeiro, depois o catálogo. */
export function solutionsFor(issue: AnalysisIssue): Solution[] {
  const list = catalogue(issue)
  if (!issue.fix) return list
  const own: Solution = {
    kind: 'fix',
    title: issue.fix.label,
    text:
      issue.fix.preview ||
      (issue.fix.target === 'pdf'
        ? 'Gera uma versão corrigida; o arquivo do cliente fica guardado.'
        : 'Atualiza a ficha do trabalho e reanalisa; o PDF não muda.'),
    fix: issue.fix,
  }
  return [own, ...list.filter((s) => !(s.kind === 'fix' && s.fix.id === issue.fix!.id))]
}
