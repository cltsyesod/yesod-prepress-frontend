/**
 * Instalação: áreas (nomes livres, em qualquer superfície) e a ordem em que os painéis são
 * instalados. A sugestão vem das sobreposições: o painel que imprime por cima do vizinho é
 * instalado depois dele. O operador pode reordenar à mão.
 */

import { EDGES, type AreaGeometry, type Issue, type TileGeometry, type TilingProjectModel } from './model'

const EPS = 0.01

/** Nomes das áreas na ordem de instalação: as definidas e, depois, as usadas fora da lista. */
export function areaNames(project: TilingProjectModel): string[] {
  const names = [...(project.areas ?? [])]
  for (const key of Object.keys(project.tiles).sort()) {
    const zone = project.tiles[key]?.zone?.trim()
    if (zone && !names.includes(zone)) names.push(zone)
  }
  return names
}

/** Para cada painel, os vizinhos que ele cobre (precisam ser instalados antes dele). */
export function coverMap(tiles: TileGeometry[]): Map<string, Set<string>> {
  const byId = new Map(tiles.map((t) => [t.id, t]))
  const covers = new Map<string, Set<string>>()
  for (const t of tiles) covers.set(t.id, new Set())
  for (const t of tiles) {
    for (const edge of EDGES) {
      const other = t.neighbours[edge] ? byId.get(t.neighbours[edge]!) : undefined
      if (!other || t.overlap[edge] <= EPS) continue
      const back = EDGES.find((e) => other.neighbours[e] === t.id)
      // Sobreposição dos dois lados (metade de cada): nenhum fica por cima, não há ordem.
      if (back && other.overlap[back] > EPS) continue
      covers.get(t.id)!.add(other.id)
    }
  }
  return covers
}

/** Ordem sugerida dentro de um grupo: primeiro os que ficam por baixo; empate, ordem de leitura. */
function suggested(group: TileGeometry[], covers: Map<string, Set<string>>): TileGeometry[] {
  const inGroup = new Set(group.map((t) => t.id))
  const rank = new Map(group.map((t, i) => [t.id, i]))
  const pending = new Map(group.map((t) => [t.id, [...covers.get(t.id)!].filter((id) => inGroup.has(id))]))
  const done = new Set<string>()
  const result: TileGeometry[] = []
  while (result.length < group.length) {
    const ready = group.filter((t) => !done.has(t.id) && pending.get(t.id)!.every((id) => done.has(id)))
    // Ciclo (não deveria acontecer): segue a ordem de leitura.
    const next = (ready.length ? ready : group.filter((t) => !done.has(t.id))).sort(
      (a, b) => rank.get(a.id)! - rank.get(b.id)!,
    )[0]
    done.add(next.id)
    result.push(next)
  }
  return result
}

/**
 * Ordem de instalação: área por área (na ordem das áreas; painéis sem área por último) e,
 * dentro de cada área, a ordem manual se houver, senão a sugerida.
 * `tiles` vem em ordem de leitura e só com os painéis impressos.
 */
export function installOrder(project: TilingProjectModel, tiles: TileGeometry[]): AreaGeometry[] {
  const covers = coverMap(tiles)
  const names = areaNames(project)
  const groups = new Map<string, TileGeometry[]>()
  for (const name of [...names, '']) groups.set(name, [])
  for (const t of tiles) groups.get(names.includes(t.zone) ? t.zone : '')!.push(t)

  const manual = project.sequence ? new Map(project.sequence.map((key, i) => [key, i])) : null
  const areas: AreaGeometry[] = []
  for (const [name, group] of groups) {
    if (!group.length) continue
    let ordered = suggested(group, covers)
    if (manual) {
      // Os que estão na ordem manual ficam nela; os novos entram na posição sugerida, no fim.
      const known = ordered.filter((t) => manual.has(t.key)).sort((a, b) => manual.get(a.key)! - manual.get(b.key)!)
      ordered = [...known, ...ordered.filter((t) => !manual.has(t.key))]
    }
    areas.push({ name, tiles: ordered.map((t) => t.id) })
  }
  return areas
}

/** Avisos: painel instalado antes do vizinho que ele cobre. */
export function installIssues(tiles: TileGeometry[], areas: AreaGeometry[]): Issue[] {
  const position = new Map<string, number>()
  areas.flatMap((a) => a.tiles).forEach((id, i) => position.set(id, i))
  const issues: Issue[] = []
  for (const [id, under] of coverMap(tiles)) {
    for (const other of under) {
      if ((position.get(id) ?? 0) < (position.get(other) ?? 0)) {
        issues.push({
          severity: 'warning',
          code: 'INSTALL_ORDER',
          tile: id,
          message: `Painel ${id} é instalado antes de ${other}, mas fica por cima dele.`,
        })
      }
    }
  }
  return issues
}
