import { useNavigate } from 'react-router-dom'
import { EmptyState } from '@/components/EmptyState'
import { AlertTriangle } from 'lucide-react'

export default function NotFoundPage() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50">
      <div className="max-w-md w-full">
        <EmptyState
          icon={AlertTriangle}
          title="Página não encontrada"
          description="A página que você está procurando não existe ou foi movida."
          actionLabel="Ir para a Visão Geral"
          onAction={() => navigate('/dashboard')}
        />
      </div>
    </div>
  )
}
