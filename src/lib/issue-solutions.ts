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

const client = (title: string, text: string, request: string): Solution => ({ kind: 'client', title, text, request })
const accept = (title: string, text: string, reason: string): Solution => ({ kind: 'accept', title, text, reason })

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

    case 'OBJECT_WHITE_OVERPRINT':
      return [
        client('Pedir o branco sem sobreimpressão', 'O objeto branco some na impressão.', 'Há elementos brancos marcados com sobreimpressão (overprint) no arquivo: na impressão eles somem. Pode desmarcar a sobreimpressão desses objetos e reenviar?'),
      ]
    case 'OBJECT_REGISTRATION_IN_ART':
      return [
        client('Pedir a troca da cor de registro', 'Registro imprime todas as tintas juntas e borra.', 'Alguns elementos da arte estão na cor de registro ("All"), que imprime com todas as tintas ao mesmo tempo e borra. Pode trocá-los por preto ou pela cor certa?'),
      ]
    case 'TEXT_RICH_BLACK':
      return [
        client('Pedir texto pequeno em 100% K', 'Preto de quatro cores borra nas letras pequenas.', 'Os textos pequenos estão em preto de quatro cores e podem sair borrados. Pode deixá-los em preto puro (100% K)?'),
        accept('Seguir assim', 'O RIP preserva o preto puro ou o texto aguenta.', 'Texto pequeno em preto composto aceito'),
      ]
    case 'TEXT_TOO_SMALL':
      return [
        client('Pedir texto maior', 'Abaixo do mínimo fica ilegível.', `Há textos menores que o mínimo para esta impressão (${issue.expected_value}). Pode aumentá-los?`),
        accept('Aceitar o risco', 'O cliente sabe que o texto pode ficar ilegível.', 'Texto abaixo do mínimo aceito pelo cliente'),
      ]
    case 'STROKE_TOO_THIN':
      return [
        client('Pedir linhas mais grossas', 'Linhas finas demais falham ou somem.', `Há linhas finas demais (ou sem espessura definida) na arte. Pode engrossá-las (${issue.expected_value})?`),
        accept('Aceitar o risco', 'O cliente sabe que as linhas finas podem falhar.', 'Linhas finas aceitas pelo cliente'),
      ]
    case 'COLOR_MIXED_SPACES':
      return [
        accept('Seguir e conferir na prova', 'As cores que se repetem casam na prova.', 'RGB e CMYK misturados conferidos na prova'),
        client('Pedir a arte toda em RGB', 'Uma só fonte de cor evita dois tons da mesma cor.', 'A arte mistura elementos em RGB e em CMYK, o que pode deixar a mesma cor em dois tons. Pode enviar tudo em RGB?'),
      ]
    case 'ART_FLATTENED':
      return [
        client('Pedir o arquivo com vetores', 'Texto e logo achatados em imagem saem serrilhados.', 'O arquivo veio com a arte inteira em imagem (textos e logos não estão em vetor). Pode enviar o PDF original, com os textos e logos em vetor?'),
        accept('Seguir assim', 'A resolução da imagem é suficiente para o tamanho.', 'Arte em imagem aceita (resolução suficiente)'),
      ]
    case 'CUT_IN_IMAGE':
      return [
        client('Pedir a faca em vetor', 'Faca em imagem não é cortada.', 'A linha de corte veio como imagem e o plotter não consegue cortá-la. Pode enviar a faca em vetor?'),
      ]
    case 'TEXT_IN_SAFETY_MARGIN':
      return [
        client('Pedir os textos afastados do corte', 'Texto colado no corte pode ser cortado.', `Há textos muito perto do corte (${issue.expected_value}). Pode afastá-los um pouco?`),
        accept('Aceitar o risco', 'O texto pode ficar rente ao corte.', 'Texto na margem de segurança aceito'),
      ]
    case 'LAYERS_HIDDEN':
      return [
        client('Pedir o arquivo sem camadas ocultas', 'Camadas ocultas podem ser impressas pelo RIP.', 'O arquivo tem camadas ocultas que podem sair na impressão. Pode enviar só com o que deve ser impresso?'),
        accept('Seguir assim', 'As camadas ocultas podem sair; conferido.', 'Camadas ocultas conferidas'),
      ]
    case 'COLOR_OUT_OF_GAMUT':
      return [
        {
          kind: 'client',
          title: 'Avisar o cliente e combinar a cor',
          text: 'A impressão não alcança essas cores; vale combinar antes de imprimir.',
          request:
            'Algumas cores da arte (tons muito vivos de RGB) não são alcançadas pela impressão e vão sair mais fechadas. Se alguma for cor de marca, podemos usar uma referência alcançável (ou Pantone, se o equipamento tiver). Podemos seguir assim?',
        },
        {
          kind: 'accept',
          title: 'Seguir com a cor mais próxima',
          text: 'O cliente aceita a diferença prevista pela verificação de gamut.',
          reason: 'Cores fora do gamut aceitas pelo cliente',
        },
      ]
    case 'COLOR_OUTPUT_CONDITION_MISMATCH':
      return [
        {
          kind: 'client',
          title: 'Confirmar a condição de impressão',
          text: 'O CMYK da arte foi feito para outra máquina/papel.',
          request:
            'O arquivo foi preparado para outra condição de impressão (perfil de saída diferente do nosso). Pode enviar a versão para a nossa condição, ou o arquivo em RGB/com perfil para fazermos a preparação?',
        },
        {
          kind: 'accept',
          title: 'Imprimir tratando o CMYK pelo perfil da arte',
          text: 'Configure o RIP para usar o perfil de origem do arquivo, evitando conversão dupla.',
          reason: 'CMYK de outra condição; RIP configurado com o perfil da arte',
        },
      ]
    case 'TEXTILE_SEMI_TRANSPARENT':
      return [
        {
          kind: 'client',
          title: 'Pedir a arte com cores sólidas',
          text: 'Sombras, brilhos e degradês para o transparente ficam com a base branca cheia ou cortada.',
          request:
            'A arte tem áreas semitransparentes (sombras, brilhos ou degradês até o transparente). Na estampa elas saem com manchas ou contorno duro na base branca. Pode enviar a versão com cores sólidas, ou confirmar que deseja manter o efeito?',
        },
        {
          kind: 'accept',
          title: 'Manter o efeito',
          text: 'O cliente aceita o resultado da transparência sobre o branco.',
          reason: 'Transparência mantida com o aceite do cliente',
        },
      ]
    case 'TEXTILE_SOLID_BACKGROUND':
      return [
        {
          kind: 'client',
          title: 'Pedir a arte sem fundo',
          text: 'Com o fundo, a estampa sai como um retângulo cheio.',
          request:
            'A arte veio com um fundo cobrindo a página inteira, e ele seria impresso como um retângulo na peça. Pode enviar a arte com o fundo transparente (PNG com transparência ou PDF sem o retângulo de fundo)?',
        },
        {
          kind: 'accept',
          title: 'O retângulo faz parte da estampa',
          text: 'O fundo deve mesmo ser impresso.',
          reason: 'Fundo intencional, confirmado',
        },
      ]
    case 'TEXTILE_THIN_DETAILS':
      return [
        {
          kind: 'client',
          title: 'Pedir traços mais grossos',
          text: 'Traços abaixo do mínimo do perfil tendem a falhar ou soltar.',
          request: `Alguns traços e textos da arte estão mais finos que o mínimo para esta impressão (${issue.expected_value}). Pode engrossá-los?`,
        },
        {
          kind: 'accept',
          title: 'Aceitar o risco',
          text: 'Segue assim; o cliente foi avisado de que detalhes finos podem falhar.',
          reason: 'Detalhes finos aceitos com o risco informado',
        },
      ]
    case 'TEXTILE_PRINT_AREA':
      return [
        {
          kind: 'client',
          title: 'Confirmar um tamanho menor',
          text: 'O sistema não reduz a arte sozinho. Com o novo tamanho na ficha, a análise refaz a conta.',
          request: `A arte (${issue.found_value.replace(/^Arte /, '')}) é maior que a área de impressão (${issue.expected_value}). Podemos reduzi-la para caber, ou prefere dividir em partes?`,
        },
      ]
    default:
      // Regras GWG 2022: pedir ao cliente o que a regra diz, ou aceitar com o motivo.
      if (issue.rule_code.startsWith('GWG_')) {
        const rule = issue.title.split(' · ')[0]
        return [
          client(
            'Pedir a correção ao cliente',
            issue.recommendation,
            `O arquivo não atende à regra ${rule} do padrão de preflight GWG 2022: ${issue.title.split(' · ')[1] ?? issue.title} (${issue.found_value}). ${issue.recommendation}`,
          ),
          accept('Aceitar fora do padrão', 'Segue assim, registrado como exceção à GWG.', `Exceção à ${rule} aceita`),
        ]
      }
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
