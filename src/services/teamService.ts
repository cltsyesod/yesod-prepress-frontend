export interface TeamMember {
  id: string
  name: string
  email: string
  role: 'admin' | 'operator' | 'viewer'
  status: 'active' | 'pending'
}

export const teamService = {
  async listTeamMembers(): Promise<TeamMember[]> {
    await new Promise((resolve) => setTimeout(resolve, 150))
    return [
      {
        id: 'tm-1',
        name: 'João Silva',
        email: 'demo@yesodautomation.com',
        role: 'admin',
        status: 'active',
      },
      {
        id: 'tm-2',
        name: 'Ana Oliveira',
        email: 'ana@yesodautomation.com',
        role: 'operator',
        status: 'active',
      },
    ]
  },
}
