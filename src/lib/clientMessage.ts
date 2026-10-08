import type { AnalysisIssue } from '@/services/analysisJobsService'

/**
 * Mensagem para o cliente com os ajustes que dependem dele: tudo que foi marcado
 * como "Devolver ao cliente" ou, se nada foi marcado, os bloqueantes ainda pendentes.
 */
export function buildClientMessage(jobName: string, clientName: string, issues: AnalysisIssue[]) {
  const returned = issues.filter((i) => i.status === 'rejected')
  const items = returned.length
    ? returned
    : issues.filter((i) => i.status === 'pending' && i.severity === 'critical')

  const greeting = clientName ? `Olá, ${clientName}!` : 'Olá!'
  if (!items.length) {
    return `${greeting}\n\nAnalisamos o arquivo "${jobName}" e ele está pronto para produção. Obrigado!`
  }

  const lines = items.map((issue, index) => {
    const where = issue.page > 0 ? ` (página ${issue.page})` : ''
    const found = issue.found_value ? ` Encontramos: ${issue.found_value}.` : ''
    const expected = issue.expected_value ? ` Precisamos de: ${issue.expected_value}.` : ''
    return `${index + 1}. ${issue.title}${where}.${found}${expected}`
  })

  return [
    greeting,
    '',
    `Analisamos o arquivo "${jobName}" para produção e precisamos dos ajustes abaixo:`,
    '',
    ...lines,
    '',
    'Assim que recebermos o arquivo corrigido, seguimos com a produção. Qualquer dúvida, estamos à disposição.',
  ].join('\n')
}
