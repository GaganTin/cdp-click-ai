import { Toaster } from "@/components/ui/toaster"
import { Toaster as SonnerToaster } from "sonner"
import { Check, X, AlertTriangle, Info } from "lucide-react"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import { PreferencesProvider } from '@/lib/PreferencesContext';

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
import Studio from './pages/Studio';
import CompanySelect from './pages/CompanySelect';
import AccountClosedBanner from './components/layout/AccountClosedBanner';
import Login from './pages/auth/Login';
import Register from './pages/auth/Register';
import VerifyEmail from './pages/auth/VerifyEmail';
import ForgotPassword from './pages/auth/ForgotPassword';
import ResetPassword from './pages/auth/ResetPassword';
import Landing from './pages/Landing';
import GetStarted from './pages/GetStarted';
import ImportData from './pages/ImportData';
import JoinInvite, { PENDING_INVITE_KEY } from './pages/auth/JoinInvite';

// After any sign-in/registration, resume a workspace invite the user opened while
// logged out (its token is parked in localStorage). Covers every auth method,
// including the OAuth round-trip that loses URL params. Rendered only inside the
// authenticated branches; JoinInvite clears the token on any terminal outcome.
const PendingInviteRedirect = () => {
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    const tok = localStorage.getItem(PENDING_INVITE_KEY);
    if (tok && !location.pathname.startsWith('/join/')) {
      navigate(`/join/${tok}`, { replace: true });
    }
  }, [location.pathname, navigate]);
  return null;
};

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
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/join/:token" element={<JoinInvite />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  // Authenticated but no company - show company selector (landing still accessible).
  // Platform owners can still reach Studio even without a workspace context.
  if (!currentCompany) {
    return (
      <>
        <PendingInviteRedirect />
        <AccountClosedBanner />
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/join/:token" element={<JoinInvite />} />
          <Route path="/companies" element={<CompanySelect />} />
          <Route path="/studio" element={user?.is_platform_admin ? <Studio /> : <Navigate to="/companies" replace />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="*" element={<Navigate to="/companies" replace />} />
        </Routes>
      </>
    );
  }

  return (
    <>
    <PendingInviteRedirect />
    <Routes>
      <Route path="/join/:token" element={<JoinInvite />} />
      <Route element={<AppLayout />}>
        <Route path="/" element={<Analyst />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/utm" element={<Campaigns />} />
        <Route path="/segments" element={<Segments />} />
        <Route path="/profiles" element={<Profiles />} />
        <Route path="/edm" element={<EDM />} />
        <Route path="/integrations" element={<Integrations />} />
        <Route path="/popup" element={<PopUp />} />
        <Route path="/attributes" element={<Attributes />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/studio" element={user?.is_platform_admin ? <Studio /> : <Navigate to="/" replace />} />
        <Route path="/get-started" element={<GetStarted />} />
        <Route path="/import-export" element={<ImportData />} />
        <Route path="/companies" element={<CompanySelect />} />
      </Route>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="/register" element={<Navigate to="/" replace />} />
      <Route path="/landing" element={<Landing />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="*" element={<PageNotFound />} />
    </Routes>
    </>
  );
};

function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <PreferencesProvider>
            <AuthenticatedApp />
          </PreferencesProvider>
        </Router>
        <Toaster />
        <SonnerToaster
          closeButton
          icons={{
            success: <Check className="w-4 h-4" />,
            error: <X className="w-4 h-4" />,
            warning: <AlertTriangle className="w-4 h-4" />,
            info: <Info className="w-4 h-4" />,
          }}
          toastOptions={{
            classNames: {
              toast: "bg-background text-foreground border border-border shadow-md",
              title: "text-foreground text-sm font-medium",
              description: "text-muted-foreground text-xs",
              icon: "text-foreground",
              closeButton: "bg-background border border-border text-foreground hover:bg-secondary",
            },
          }}
        />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App
