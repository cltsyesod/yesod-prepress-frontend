import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  FolderKanban,
  PlusCircle,
  FileText,
  Settings2,
  Cog,
  Users,
  LogOut,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'

interface AppSidebarProps {
  collapsed: boolean
  onToggleCollapse: () => void
  onNavigateMobile?: () => void
}

const NAV_ITEMS = [
  { label: 'Visão Geral', icon: LayoutDashboard, to: '/dashboard' },
  { label: 'Projetos', icon: FolderKanban, to: '/projects' },
  { label: 'Novo Projeto', icon: PlusCircle, to: '/projects/new' },
  { label: 'Relatórios', icon: FileText, to: '/reports' },
  { label: 'Perfis de Produção', icon: Settings2, to: '/production-profiles' },
  { label: 'Configurações', icon: Cog, to: '/settings' },
  { label: 'Equipe', icon: Users, to: '/team' },
]

export function AppSidebar({ collapsed, onToggleCollapse, onNavigateMobile }: AppSidebarProps) {
  const { user, signOut } = useAuth()

  const getInitials = (name?: string) => {
    if (!name) return 'YS'
    return name
      .split(' ')
      .map((n) => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase()
  }

  return (
    <aside
      className={cn(
        'navy-gradient fixed top-0 left-0 z-30 h-screen border-r border-white/5 transition-all duration-300 ease-in-out flex flex-col justify-between',
        collapsed ? 'w-[64px]' : 'w-[240px]',
      )}
    >
      <div>
        <div
          className={cn(
            'h-[56px] px-4 flex items-center border-b border-white/5',
            collapsed ? 'justify-center' : 'justify-end',
          )}
        >
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleCollapse}
            className="h-8 w-8 text-slate-400 hover:bg-white/5 hover:text-slate-200 hidden md:flex shrink-0"
            title={collapsed ? 'Expandir' : 'Recolher'}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </Button>
        </div>

        <nav className="p-2 space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon
            return (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={onNavigateMobile}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-white/10 text-blue-300'
                      : 'text-slate-300 hover:bg-white/5 hover:text-slate-100',
                    collapsed && 'justify-center px-0',
                  )
                }
                title={collapsed ? item.label : undefined}
              >
                <Icon className="h-5 w-5 shrink-0" />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </NavLink>
            )
          })}
        </nav>
      </div>

      <div className="p-3 border-t border-white/5 bg-black/20">
        <div className={cn('flex items-center gap-3', collapsed && 'justify-center')}>
          <div className="h-9 w-9 rounded-full bg-blue-600 text-white flex items-center justify-center font-medium text-xs shrink-0">
            {getInitials(user?.name)}
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-100 truncate">
                {user?.name || 'Usuário'}
              </p>
              <p className="text-xs text-slate-300 truncate">
                {user?.company || 'Gráfica Exemplo'}
              </p>
              <p className="text-xs text-blue-400 font-medium truncate mt-0.5">
                {user?.plan || 'Plano Profissional'}
              </p>
            </div>
          )}
        </div>
        <Button
          variant="ghost"
          onClick={() => signOut()}
          className={cn(
            'w-full mt-2 text-sm text-slate-300 hover:text-red-400 hover:bg-red-500/10 flex items-center gap-2 justify-start h-9 px-2',
            collapsed && 'justify-center px-0',
          )}
          title="Sair"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {!collapsed && <span>Sair</span>}
        </Button>
      </div>
    </aside>
  )
}
