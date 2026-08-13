import { useParams } from 'react-router-dom'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { Layers } from 'lucide-react'

export default function ProjectVersionsPage() {
  const { id } = useParams()

  return (
    <div>
      <PageHeader
        title="Versões do Arquivo"
        breadcrumbs={[
          { label: 'Home', href: '/dashboard' },
          { label: 'Projetos', href: '/projects' },
          { label: id || 'Projeto', href: `/projects/${id}` },
          { label: 'Versões' },
        ]}
      />
      <EmptyState
        icon={Layers}
        title="Versões em desenvolvimento"
        description="O controle de revisões e histórico de envios será exibido nesta seção."
      />
    </div>
  )
}
