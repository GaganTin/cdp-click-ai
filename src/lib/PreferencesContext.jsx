import { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";
import { useAuth } from "@/lib/AuthContext";
import { appClient } from "@/api/appClient";
import { TRANSLATIONS } from "@/lib/translations";

// ── Date formatting ────────────────────────────────────────────────────────────

function buildFormatters(dateFormat, timezone) {
  const tz = (() => {
    try {
      // Validate timezone is supported
      Intl.DateTimeFormat(undefined, { timeZone: timezone });
      return timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    }
  })();
  const fmt = dateFormat || "MMM d, yyyy";

  function datePart(d) {
    if (fmt === "yyyy-MM-dd") {
      return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
    }
    if (fmt === "dd/MM/yyyy") {
      return new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
    }
    if (fmt === "MM/dd/yyyy") {
      return new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
    }
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "short", day: "numeric" }).format(d);
  }

  return {
    formatDate(val) {
      if (!val) return "-";
      const d = new Date(val);
      if (isNaN(d)) return "-";
      return datePart(d);
    },
    formatDateTime(val) {
      if (!val) return "-";
      const d = new Date(val);
      if (isNaN(d)) return "-";
      const time = new Intl.DateTimeFormat("en-US", {
        timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false,
      }).format(d);
      return `${datePart(d)}, ${time}`;
    },
  };
}

// ── Context ────────────────────────────────────────────────────────────────────

const PreferencesContext = createContext(null);

export const DEFAULT_PREFS = {
  theme: "system",
  language: "en",
  timezone: "UTC",
  date_format: "MMM d, yyyy",
  notifications: {},
};

function applyTheme(theme) {
  const html = document.documentElement;
  if (theme === "dark") {
    html.classList.add("dark");
  } else if (theme === "light") {
    html.classList.remove("dark");
  } else {
    // system
    html.classList.toggle("dark", window.matchMedia("(prefers-color-scheme: dark)").matches);
  }
}

export function PreferencesProvider({ children }) {
  const { user, currentCompany } = useAuth();
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);

  // Preferences are per (user, workspace) - load them for the active company and
  // reload when the user switches workspaces. (Was a single global blob before.)
  useEffect(() => {
    if (!user?.id || !currentCompany?.id) return;
    appClient.companies.getPreferences(currentCompany.id)
      .then((p) => {
        const merged = { ...DEFAULT_PREFS, ...(p || {}) };
        setPrefs(merged);
        applyTheme(merged.theme);
      })
      .catch(() => {});
  }, [user?.id, currentCompany?.id]);

  // Track system theme changes when mode is "system"
  useEffect(() => {
    if (prefs.theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e) => document.documentElement.classList.toggle("dark", e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [prefs.theme]);

  const updatePrefs = useCallback((newPrefs) => {
    setPrefs(newPrefs);
    applyTheme(newPrefs.theme);
  }, []);

  const t = useCallback((key) => {
    const lang = prefs.language || "en";
    return TRANSLATIONS[lang]?.[key] ?? key;
  }, [prefs.language]);

  const { formatDate, formatDateTime } = useMemo(
    () => buildFormatters(prefs.date_format, prefs.timezone),
    [prefs.date_format, prefs.timezone]
  );

  const value = useMemo(
    () => ({ prefs, updatePrefs, t, formatDate, formatDateTime }),
    [prefs, updatePrefs, t, formatDate, formatDateTime]
  );

  return (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences() {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error("usePreferences must be used within PreferencesProvider");
  return ctx;
}
