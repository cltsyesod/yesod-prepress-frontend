import { NavLink, Outlet } from 'react-router-dom'
import { cn } from '@/lib/utils'

const TABS = [
  { to: '/textil', label: 'Trabalhos', end: true },
  { to: '/textil/folha', label: 'Folha DTF' },
  { to: '/textil/perfis', label: 'Perfis DTF / DTG' },
]

/**
 * Módulo DTF / DTG, isolado da gráfica: trabalhos com perfil têxtil (preflight, base
 * branca, posição na peça e relatório na tela do trabalho), a folha de DTF e os perfis
 * têxteis. Reaproveita as mesmas telas da gráfica, filtradas pela tecnologia do perfil.
 */
export default function TextileModulePage() {
  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">DTF / DTG</h1>
          <p className="text-sm text-muted-foreground">
            Pré-impressão têxtil: preflight da arte, base branca, folha de DTF, posição na peça e relatório técnico.
          </p>
        </div>
        <nav className="flex gap-1 border-b border-border" aria-label="Seções do módulo DTF / DTG">
          {TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                cn(
                  '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>
      </div>
      <Outlet />
    </div>
  )
}
