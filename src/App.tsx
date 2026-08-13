import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from '@/components/ui/toaster'
import { Toaster as Sonner } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthProvider } from '@/hooks/use-auth'
import { ThemeProvider } from '@/hooks/use-theme'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import Layout from '@/components/Layout'

import LoginPage from '@/pages/Login'
import DashboardPage from '@/pages/Dashboard'
import ProjectsPage from '@/pages/Projects'
import NewProjectPage from '@/pages/NewProject'
import ProjectDetailPage from '@/pages/ProjectDetail'
import ProjectAnalysisPage from '@/pages/ProjectAnalysis'
import ProjectVersionsPage from '@/pages/ProjectVersions'
import ProjectReportPage from '@/pages/ProjectReport'
import ReportsPage from '@/pages/Reports'
import ProductionProfilesPage from '@/pages/ProductionProfiles'
import SettingsPage from '@/pages/Settings'
import TeamPage from '@/pages/Team'
import NotFoundPage from '@/pages/NotFound'

const App = () => (
  <BrowserRouter>
    <ThemeProvider>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <Routes>
            <Route path="/login" element={<LoginPage />} />

            <Route element={<ProtectedRoute />}>
              <Route element={<Layout />}>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/projects" element={<ProjectsPage />} />
                <Route path="/projects/new" element={<NewProjectPage />} />
                <Route path="/projects/:id" element={<ProjectDetailPage />} />
                <Route path="/projects/:id/analysis" element={<ProjectAnalysisPage />} />
                <Route path="/projects/:id/versions" element={<ProjectVersionsPage />} />
                <Route path="/projects/:id/report" element={<ProjectReportPage />} />
                <Route path="/reports" element={<ReportsPage />} />
                <Route path="/production-profiles" element={<ProductionProfilesPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/team" element={<TeamPage />} />
              </Route>
            </Route>

            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </TooltipProvider>
      </AuthProvider>
    </ThemeProvider>
  </BrowserRouter>
)

export default App
