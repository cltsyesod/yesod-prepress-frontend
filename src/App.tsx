import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom'
import { Toaster } from '@/components/ui/toaster'
import { Toaster as Sonner } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthProvider } from '@/hooks/use-auth'
import { ThemeProvider } from '@/hooks/use-theme'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import Layout from '@/components/Layout'

import LoginPage from '@/pages/Login'
import QueuePage from '@/pages/Queue'
import JobWorkspacePage from '@/pages/JobWorkspace'
import NestingPage from '@/pages/Nesting'
import ProductionProfilesPage from '@/pages/ProductionProfiles'
import SettingsPage from '@/pages/Settings'
import NotFoundPage from '@/pages/NotFound'

// Links antigos (/projects/:id e subpáginas) continuam funcionando.
function LegacyProjectRedirect() {
  const { id } = useParams()
  return <Navigate to={`/trabalhos/${id}`} replace />
}

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
                <Route path="/" element={<Navigate to="/trabalhos" replace />} />
                <Route path="/trabalhos" element={<QueuePage />} />
                <Route path="/trabalhos/:id" element={<JobWorkspacePage />} />
                <Route path="/montagem" element={<NestingPage />} />
                <Route path="/perfis" element={<ProductionProfilesPage />} />
                <Route path="/configuracoes" element={<SettingsPage />} />

                <Route path="/dashboard" element={<Navigate to="/trabalhos" replace />} />
                <Route path="/projects" element={<Navigate to="/trabalhos" replace />} />
                <Route path="/projects/new" element={<Navigate to="/trabalhos" replace />} />
                <Route path="/projects/:id/*" element={<LegacyProjectRedirect />} />
                <Route path="/production-profiles" element={<Navigate to="/perfis" replace />} />
                <Route path="/settings" element={<Navigate to="/configuracoes" replace />} />
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
