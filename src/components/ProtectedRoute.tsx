import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '@/hooks/use-auth'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function ProtectedRoute() {
  const { isAuthenticated, loading, membership, signOut } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!isAuthenticated) return <Navigate to="/login" replace />

  // Conta sem empresa (ou desativada pelo administrador): não vê dados de ninguém.
  if (!membership) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="max-w-sm space-y-3 text-center">
          <h1 className="text-lg font-semibold text-foreground">Conta sem acesso a uma empresa</h1>
          <p className="text-sm text-muted-foreground">
            Peça ao administrador da sua empresa para incluir (ou reativar) a sua conta na equipe.
          </p>
          <Button variant="outline" onClick={() => signOut()}>
            Sair
          </Button>
        </div>
      </div>
    )
  }

  return <Outlet />
}
