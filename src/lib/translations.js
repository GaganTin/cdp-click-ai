// Central translation dictionary, keyed by the English source string.
// Each entry carries every non-English variant; the language maps consumed by
// `t()` are derived from this at module load. Page-level objects are spread-
// merged below, so a key repeated across pages is harmless (last one wins).
import { PAGE_TRANSLATIONS } from "./translations.pages.js";

// ── Sidebar / settings nav + common UI (was inline in PreferencesContext) ──────
const nav = {
  "AI Analyst": { zh: "AI 分析師", "zh-cn": "AI 分析师" },
  "Dashboard": { zh: "儀表板", "zh-cn": "仪表板" },
  "Campaigns": { zh: "行銷活動", "zh-cn": "营销活动" },
  "Email": { zh: "電子郵件", "zh-cn": "电子邮件" },
  "Pop Up": { zh: "彈出視窗", "zh-cn": "弹出窗口" },
  "UTM": { zh: "UTM", "zh-cn": "UTM" },
  "Audience": { zh: "受眾", "zh-cn": "受众" },
  "Profiles": { zh: "檔案", "zh-cn": "档案" },
  "Segments": { zh: "細分", "zh-cn": "细分" },
  "Attributes": { zh: "屬性", "zh-cn": "属性" },
  "Tools": { zh: "工具", "zh-cn": "工具" },
  "Integrations": { zh: "整合", "zh-cn": "集成" },
  "Import / Export": { zh: "匯入／匯出", "zh-cn": "导入/导出" },
  "Settings": { zh: "設定", "zh-cn": "设置" },
  "Profile": { zh: "個人資料", "zh-cn": "个人资料" },
  "Security": { zh: "安全", "zh-cn": "安全" },
  "Preferences": { zh: "偏好設定", "zh-cn": "偏好设置" },
  "Billing": { zh: "帳單", "zh-cn": "账单" },
  "Company": { zh: "公司", "zh-cn": "公司" },
  "Members": { zh: "成員", "zh-cn": "成员" },
  "Audit Log": { zh: "稽核日誌", "zh-cn": "审计日志" },
  "Support": { zh: "支援", "zh-cn": "支持" },
  "Studio": { zh: "Studio", "zh-cn": "Studio" },
  "Save changes": { zh: "儲存變更", "zh-cn": "保存更改" },
  "Cancel": { zh: "取消", "zh-cn": "取消" },
  "Delete": { zh: "刪除", "zh-cn": "删除" },
  "Edit": { zh: "編輯", "zh-cn": "编辑" },
  "Search": { zh: "搜尋", "zh-cn": "搜索" },
  "Loading…": { zh: "載入中…", "zh-cn": "加载中…" },
  "Saving…": { zh: "儲存中…", "zh-cn": "保存中…" },
  "Sign out": { zh: "登出", "zh-cn": "退出登录" },
  "Add workspace": { zh: "新增工作區", "zh-cn": "添加工作区" },
  "Workspaces": { zh: "工作區", "zh-cn": "工作区" },
  "Get Started": { zh: "開始使用", "zh-cn": "开始使用" },
};

// Page-level objects are appended to this array (see ./translations.pages.js).
const PAGES = [nav];

// ── Derive the per-language maps consumed by t() ───────────────────────────────
function buildTranslations() {
  const merged = Object.assign({}, ...PAGES);
  const out = { en: {}, zh: {}, "zh-cn": {} };
  for (const [key, variants] of Object.entries(merged)) {
    if (variants.zh != null) out.zh[key] = variants.zh;
    if (variants["zh-cn"] != null) out["zh-cn"][key] = variants["zh-cn"];
  }
  return out;
}

PAGES.push(...PAGE_TRANSLATIONS);

export const TRANSLATIONS = buildTranslations();
