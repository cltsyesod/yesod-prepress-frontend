import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { Cog, Sun, Moon, Monitor, Check } from 'lucide-react'
import { useTheme } from '@/hooks/use-theme'
import { cn } from '@/lib/utils'

const THEME_OPTIONS = [
  {
    value: 'light' as const,
    label: 'Claro',
    description: 'Tema claro com fundo branco e texto escuro',
    icon: Sun,
  },
  {
    value: 'dark' as const,
    label: 'Escuro',
    description: 'Tema escuro com fundo grafite e texto claro',
    icon: Moon,
  },
  {
    value: 'system' as const,
    label: 'Sistema',
    description: 'Segue a preferência do seu dispositivo',
    icon: Monitor,
  },
]

export default function SettingsPage() {
  const { theme, setTheme } = useTheme()

  return (
    <div>
      <PageHeader
        title="Configurações"
        breadcrumbs={[{ label: 'Fila de trabalho', href: '/trabalhos' }, { label: 'Configurações' }]}
      />

      <div className="space-y-6">
        <section>
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-foreground">Aparência</h2>
            <p className="text-sm text-muted-foreground">
              Escolha o tema da interface. A alteração é aplicada imediatamente.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {THEME_OPTIONS.map((opt) => {
              const Icon = opt.icon
              const isActive = theme === opt.value
              return (
                <button
                  key={opt.value}
                  onClick={() => setTheme(opt.value)}
                  className={cn(
                    'relative p-4 rounded-lg border-2 text-left transition-all',
                    isActive
                      ? 'border-primary bg-card'
                      : 'border-border bg-card hover:border-primary/50',
                  )}
                >
                  {isActive && (
                    <span className="absolute top-3 right-3 h-5 w-5 rounded-full bg-primary flex items-center justify-center">
                      <Check className="h-3 w-3 text-primary-foreground" />
                    </span>
                  )}
                  <div className="flex items-center gap-3 mb-2">
                    <div
                      className={cn(
                        'h-10 w-10 rounded-lg flex items-center justify-center',
                        isActive ? 'bg-primary/10' : 'bg-accent',
                      )}
                    >
                      <Icon
                        className={cn(
                          'h-5 w-5',
                          isActive ? 'text-primary' : 'text-muted-foreground',
                        )}
                      />
                    </div>
                  </div>
                  <h3 className="text-sm font-semibold text-foreground">{opt.label}</h3>
                  <p className="text-xs text-muted-foreground mt-1">{opt.description}</p>
                </button>
              )
            })}
          </div>
        </section>

        <section>
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-foreground">Geral</h2>
            <p className="text-sm text-muted-foreground">
              Configurações gerais da conta e da gráfica.
            </p>
          </div>
          <EmptyState
            icon={Cog}
            title="Configurações em desenvolvimento"
            description="Opções gerais da conta, preferências da gráfica e integrações aparecerão em breve."
          />
        </section>
      </div>
    </div>
  )
}
