import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { Users } from 'lucide-react'

export default function TeamPage() {
  return (
    <div>
      <PageHeader
        title="Equipe"
        breadcrumbs={[{ label: 'Home', href: '/dashboard' }, { label: 'Equipe' }]}
      />
      <EmptyState
        icon={Users}
        title="Equipe em desenvolvimento"
        description="Gestão de operadores, pré-pressistas e permissões de acesso em desenvolvimento."
      />
    </div>
  )
}
