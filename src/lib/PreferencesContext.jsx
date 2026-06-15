import { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";
import { useAuth } from "@/lib/AuthContext";
import { appClient } from "@/api/appClient";

// ── Translations ──────────────────────────────────────────────────────────────

const TRANSLATIONS = {
  en: {},
  zh: {
    // Sidebar nav
    "AI Analyst": "AI 分析師",
    "Dashboard": "儀表板",
    "Campaigns": "行銷活動",
    "Email": "電子郵件",
    "Pop Up": "彈出視窗",
    "UTM": "UTM",
    "Audience": "受眾",
    "Profiles": "檔案",
    "Segments": "細分",
    "Attributes": "屬性",
    "Tools": "工具",
    "Integrations": "整合",
    // Settings nav
    "Settings": "設定",
    "Profile": "個人資料",
    "Security": "安全",
    "Preferences": "偏好設定",
    "Billing": "帳單",
    "Company": "公司",
    "Members": "成員",
    "Audit Log": "稽核日誌",
    "Support": "支援",
    // Common UI
    "Save changes": "儲存變更",
    "Cancel": "取消",
    "Delete": "刪除",
    "Edit": "編輯",
    "Search": "搜尋",
    "Loading…": "載入中…",
    "Saving…": "儲存中…",
    "Sign out": "登出",
    "Add workspace": "新增工作區",
    "Workspaces": "工作區",
    "Get Started": "開始使用",
  },
  "zh-cn": {
    // Sidebar nav
    "AI Analyst": "AI 分析师",
    "Dashboard": "仪表板",
    "Campaigns": "营销活动",
    "Email": "电子邮件",
    "Pop Up": "弹出窗口",
    "UTM": "UTM",
    "Audience": "受众",
    "Profiles": "档案",
    "Segments": "细分",
    "Attributes": "属性",
    "Tools": "工具",
    "Integrations": "集成",
    // Settings nav
    "Settings": "设置",
    "Profile": "个人资料",
    "Security": "安全",
    "Preferences": "偏好设置",
    "Billing": "账单",
    "Company": "公司",
    "Members": "成员",
    "Audit Log": "审计日志",
    "Support": "支持",
    // Common UI
    "Save changes": "保存更改",
    "Cancel": "取消",
    "Delete": "删除",
    "Edit": "编辑",
    "Search": "搜索",
    "Loading…": "加载中…",
    "Saving…": "保存中…",
    "Sign out": "退出登录",
    "Add workspace": "添加工作区",
    "Workspaces": "工作区",
    "Get Started": "开始使用",
  },
};

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
