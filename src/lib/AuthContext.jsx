import React, { createContext, useState, useContext, useEffect, useCallback } from "react";
import { appClient, setCurrentCompanyId } from "@/api/appClient";

const AuthContext = createContext();

const COMPANY_KEY = "cdp_company_id";

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [currentCompany, setCurrentCompanyState] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  const setCurrentCompany = useCallback((company) => {
    setCurrentCompanyState(company);
    if (company?.id) {
      setCurrentCompanyId(company.id);
      localStorage.setItem(COMPANY_KEY, company.id);
    } else {
      setCurrentCompanyId(null);
      localStorage.removeItem(COMPANY_KEY);
    }
  }, []);

  const checkUserAuth = useCallback(async () => {
    setIsLoadingAuth(true);
    setAuthError(null);
    try {
      const me = await appClient.auth.me();
      setUser(me);
      setIsAuthenticated(true);

      // Restore or pick company
      const companies = me.companies || [];
      if (companies.length > 0) {
        const savedId = localStorage.getItem(COMPANY_KEY);
        const saved = companies.find(c => c.id === savedId);
        const company = saved || companies[0];
        setCurrentCompany(company);
      } else {
        setCurrentCompany(null);
      }
    } catch (error) {
      setUser(null);
      setIsAuthenticated(false);
      setCurrentCompany(null);
      setAuthError({
        type: "auth_required",
        message: error?.message || "Authentication required",
      });
    } finally {
      setIsLoadingAuth(false);
      setAuthChecked(true);
    }
  }, [setCurrentCompany]);

  useEffect(() => {
    checkUserAuth();
  }, [checkUserAuth]);

  const logout = useCallback(async () => {
    setUser(null);
    setIsAuthenticated(false);
    setCurrentCompany(null);
    await appClient.auth.logout();
  }, [setCurrentCompany]);

  const switchCompany = useCallback((company) => {
    setCurrentCompany(company);
  }, [setCurrentCompany]);

  const refreshUser = useCallback(async () => {
    try {
      const me = await appClient.auth.me();
      setUser(me);
      // Refresh current company data if it's in the new list
      if (currentCompany) {
        const updated = (me.companies || []).find(c => c.id === currentCompany.id);
        if (updated) setCurrentCompany(updated);
      }
    } catch { /* ignore */ }
  }, [currentCompany, setCurrentCompany]);

  return (
    <AuthContext.Provider
      value={{
        user,
        currentCompany,
        isAuthenticated,
        isLoadingAuth,
        isLoadingPublicSettings,
        authError,
        appPublicSettings: { local_mode: false },
        authChecked,
        logout,
        switchCompany,
        refreshUser,
        checkUserAuth,
        checkAppState: checkUserAuth,
        navigateToLogin: appClient.auth.redirectToLogin,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
