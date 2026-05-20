import { Toaster } from "@/components/ui/toaster"
import { Toaster as SonnerToaster } from "sonner"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';

import AppLayout from './components/layout/AppLayout';
import Dashboard from './pages/Dashboard';
import Analyst from './pages/Analyst';
import Campaigns from './pages/Campaigns';
import Segments from './pages/Segments';
import Profiles from './pages/Profiles';
import EDM from './pages/EDM';
import Integrations from './pages/Integrations';
import PopUp from './pages/PopUp';
import Attributes from './pages/Attributes';
import Settings from './pages/Settings';
import CompanySelect from './pages/CompanySelect';
import Login from './pages/auth/Login';
import Register from './pages/auth/Register';
import ForgotPassword from './pages/auth/ForgotPassword';
import ResetPassword from './pages/auth/ResetPassword';
import Landing from './pages/Landing';
import GetStarted from './pages/GetStarted';

const AuthenticatedApp = () => {
  const { isLoadingAuth, isAuthenticated, authChecked, user, currentCompany } = useAuth();

  if (isLoadingAuth || !authChecked) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-border border-t-foreground rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  // Authenticated but no company - show company selector (landing still accessible)
  if (!currentCompany) {
    return (
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/companies" element={<CompanySelect />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="*" element={<Navigate to="/companies" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<Analyst />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/campaigns" element={<Campaigns />} />
        <Route path="/segments" element={<Segments />} />
        <Route path="/profiles" element={<Profiles />} />
        <Route path="/edm" element={<EDM />} />
        <Route path="/integrations" element={<Integrations />} />
        <Route path="/popup" element={<PopUp />} />
        <Route path="/attributes" element={<Attributes />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/get-started" element={<GetStarted />} />
        <Route path="/companies" element={<CompanySelect />} />
      </Route>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="/register" element={<Navigate to="/" replace />} />
      <Route path="/landing" element={<Landing />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};

function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <AuthenticatedApp />
        </Router>
        <Toaster />
        <SonnerToaster richColors closeButton />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App
