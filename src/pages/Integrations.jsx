import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { appClient, getCurrentCompanyId } from "@/api/appClient";
import { toast } from "sonner";
import { formatDistanceToNow, format } from "date-fns";
import {
  BarChart2, Search, ShoppingBag, Plug, Globe, Store, ShoppingCart, Boxes,
  CheckCircle2, AlertCircle, RefreshCw, Loader2,
  EyeOff, Eye, ExternalLink, Unplug, ChevronRight,
  Copy, Download, XCircle, ShieldCheck, History,
  Activity, Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sheet, SheetContent, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { usePreferences } from "@/lib/PreferencesContext";

const GA_EDITOR_EMAILS = [
  import.meta.env.VITE_GA_EDITOR_EMAIL_1 || "capsuite.ga@gmail.com",
  import.meta.env.VITE_GA_EDITOR_EMAIL_2 || "starting-account-u9jbb14nb4ie@capsuite-1709107069505.iam.gserviceaccount.com",
];

const GSC_EDITOR_EMAILS = [
  import.meta.env.VITE_GSC_EDITOR_EMAIL_1 || "capsuite.ga@gmail.com",
  import.meta.env.VITE_GSC_EDITOR_EMAIL_2 || "capsuite-cdp-dev-2@capsuitecdp-400308.iam.gserviceaccount.com",
];

const INTEGRATIONS = [
  {
    id: "googleAnalytics",
    name: "Google Analytics",
    shortName: "GA4",
    description: "Sync traffic, sessions, events, and conversion data from your GA4 property.",
    category: "Analytics",
    Icon: BarChart2,
    syncable: true,
    fields: [
      { key: "propertyId",   label: "Property ID",   placeholder: "e.g. 123456789",             type: "text",     hint: "Admin → Property Details (top right corner)" },
      { key: "propertyName", label: "Property URL",  placeholder: "e.g. https://www.example.com", type: "text",   hint: "Admin → Data Streams → your website URL" },
    ],
    instructions: [
      {
        title: "Grant the editor role",
        steps: [
          "Log in to your Google Analytics account.",
          "In the sidebar, click Admin. Under Property Settings, click Property access management.",
          "Click the + button, then Add users.",
          "Enter both service account emails below and select Editor as the role:",
          { type: "emails", value: GA_EDITOR_EMAILS },
        ],
      },
      {
        title: "Find your Property ID",
        steps: [
          "In the sidebar, click Admin.",
          "Under Property, click Property details.",
          "Copy the Property ID shown in the top-right corner and paste it in the form.",
        ],
      },
      {
        title: "Find your Property URL",
        steps: [
          "In the sidebar, click Admin.",
          "Under Data Collection and Modification, click Data Streams.",
          "Copy the website URL (starting with https://) and paste it in the form.",
        ],
      },
      {
        title: "Add custom dimensions",
        steps: [
          "In the sidebar, click Admin.",
          "Under Data display, click Custom definitions → Create custom dimensions.",
          { type: "table", headers: ["Dimension name", "Description", "Scope", "Event parameter"], rows: [
            ["CapSuite APID", "Client AP_ID for no GA id existing", "User", "capsuite_apid"],
            ["Capsuite SID",  "Client ID from cookies",              "User", "capsuite_sid"],
          ]},
        ],
      },
    ],
    disconnectWarning: "All Google Analytics data and its anonymous visitor profiles will be permanently deleted. Your content attributes' crawled pages, tags, and discovered values will also be cleared - only the attribute definitions are kept.",
  },
  {
    id: "googleSearchConsole",
    name: "Google Search Console",
    shortName: "GSC",
    description: "Import keyword rankings, search impressions, and click-through data.",
    category: "Analytics",
    Icon: Search,
    syncable: true,
    fields: [
      { key: "siteUrl", label: "Site URL", placeholder: "https://www.example.com/ or sc-domain:example.com", type: "text", hint: "URL-prefix format (https://www.example.com/) or Domain format (sc-domain:example.com)" },
    ],
    instructions: [
      {
        title: "Grant access to the service accounts",
        steps: [
          "Log in to your Google Search Console account.",
          "In the sidebar, click Settings, then Users and permissions under General Settings.",
          "Click Add Users, paste both emails below, and select Full permission:",
          { type: "emails", value: GSC_EDITOR_EMAILS },
        ],
      },
      {
        title: "Find your Site URL",
        steps: [
          "Your site URL must match exactly how it appears in Search Console.",
          "Use the URL-prefix format: https://www.example.com/ (with trailing slash)",
          "Or Domain property format: sc-domain:example.com",
        ],
      },
    ],
    disconnectWarning: "All Google Search Console data (e.g. keyword report) stored in the CDP will be permanently deleted.",
  },
  {
    id: "shopify",
    name: "Shopify",
    shortName: "Shopify",
    description: "Import orders, products, and customer records from your Shopify store.",
    category: "eCommerce",
    Icon: ShoppingBag,
    syncable: true,
    fields: [
      { key: "storeName",    label: "Store Name",    placeholder: "storename123 (without .myshopify.com)", type: "text",     hint: "Settings → Store details → your myshopify.com subdomain." },
      { key: "accessToken",  label: "Access Token",  placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",       type: "password", hint: "Settings → Apps → Develop Apps → your app → Install App → \"Reveal & Copy Token\"" },
    ],
    instructions: [
      {
        title: "Find your Store Name",
        steps: [
          "Log in to your Shopify admin.",
          "Go to Settings → Store details.",
          "Your Store Name is the subdomain before .myshopify.com (e.g. storename123).",
        ],
      },
      {
        title: "Generate the Access Token",
        steps: [
          "Go to Settings → Apps and sales channels, then click Develop Apps (top right).",
          "Click Create an app, enter any name ending with _CDP (e.g. MyCDP), and save.",
          "Under Configuration, click Configure Admin API scopes and select: orders, products, customers.",
          "Click Save, then Install App → Install.",
          "Click Install App → Install, then click \"Reveal & Copy Token\". (It is only shown once.)",
        ],
      },
    ],
    disconnectWarning: "All Shopify data (membership, transactions, etc.) stored in the CDP will be permanently deleted.",
  },
  {
    id: "shopifyCustomApp",
    name: "Shopify CDP App",
    shortName: "CDP Script",
    description: "Install the CDP tracking script on your storefront to track visitor sessions.",
    category: "Tracking",
    Icon: Plug,
    syncable: false,
    isOAuth: true,
    comingSoon: true,
    fields: [
      { key: "storeName", label: "Store Name", placeholder: "storename123 (without .myshopify.com)", type: "text", hint: "Settings → Store details → your myshopify.com subdomain." },
    ],
    instructions: [
      { title: "Log in as store owner", steps: ["Log in to your Shopify store as the store owner or with admin permissions to approve app installs."] },
      { title: "Find your Store Name", steps: ["In the sidebar, go to Settings.", "Your Store Name is the subdomain before .myshopify.com (e.g. storename123)."] },
      { title: "Install the CDP App", steps: ["Enter your store name below and click Install CDP App.", "You will be redirected to a Shopify permissions screen.", "Click Install app to approve the Capsuite CDP app.", "The CDP tracking script will be automatically added to your storefront."] },
    ],
    disconnectWarning: "The CDP tracking script will be immediately removed from your storefront. Visitor tracking and session data collection will stop immediately.",
  },
  {
    id: "odoo",
    name: "Odoo",
    shortName: "Odoo",
    description: "Import sales orders, products, inventory, and member records from your Odoo ERP.",
    category: "eCommerce",
    Icon: Boxes,
    syncable: true,
    comingSoon: true,
    fields: [],
    instructions: [],
  },
  {
    id: "shopline",
    name: "Shopline",
    shortName: "Shopline",
    description: "Import orders, products, and member records from your Shopline store.",
    category: "eCommerce",
    Icon: Store,
    syncable: true,
    comingSoon: true,
    fields: [],
    instructions: [],
  },
  {
    id: "woocommerce",
    name: "WooCommerce",
    shortName: "Woo",
    description: "Import orders, products, and customer records from your WooCommerce store.",
    category: "eCommerce",
    Icon: ShoppingCart,
    syncable: true,
    comingSoon: true,
    fields: [],
    instructions: [],
  },
  {
    id: "wordpress",
    name: "WordPress Plugin",
    shortName: "WP Plugin",
    description: "Install the Capsuite CDP plugin on your WordPress site to track visitors and serve personalised pop ups.",
    category: "Tracking",
    Icon: Globe,
    syncable: false,
    isPlugin: true,
    fields: [],
    instructions: [
      {
        title: "Download and install the plugin",
        steps: [
          "Download the Capsuite CDP plugin (.zip) from the Install tab.",
          "In your WordPress admin, go to Plugins → Add New Plugin → Upload Plugin.",
          "Upload the downloaded .zip file, click Install Now, then Activate.",
        ],
      },
      {
        title: "Enter your Company ID",
        steps: [
          "After activation, go to Settings → Capsuite CDP in your WordPress admin.",
          "Copy your Company ID from the Install tab on this page.",
          "Paste it into the Company ID field and click Save Settings.",
        ],
      },
      {
        title: "Configure display URLs",
        steps: [
          "In the plugin settings, enter the URL patterns where pop ups should appear.",
          "Use * to show on all pages, /product/* for a section, or /specific-page for one page.",
          "Choose a default position (center, bottom-right, etc.) and set your preferred popup dimensions.",
        ],
      },
      {
        title: "Test the connection",
        steps: [
          "Click the Test Connection button in the plugin settings page to verify the plugin can reach Capsuite.",
          "Visit any matching page on your site - if a pop-up is active and you meet the targeting rules, it will appear.",
          "Check the Install tab on this page - the activity indicator will update when the first visitor event is captured.",
        ],
      },
    ],
    disconnectWarning: "The Capsuite CDP plugin will stop serving pop ups and tracking visitor sessions on your WordPress site.",
  },
];

// ── Status helpers ─────────────────────────────────────────────────────────────
function getStatus(record) {
  if (!record) return "disconnected";
  if (!record.is_connected && !record.is_connection_error) return "disconnected";
  if (record.is_connection_error) return "error";
  const active = record.latest_job_status;
  if (active === "queued" || active === "running") return "syncing";
  // Connected, but the most recent sync failed - surface it (with the reason).
  if (record.is_sync_error || active === "failed") return "sync_failed";
  if (record.is_synced) return "synced";
  return "connected";
}

const STATUS_BADGE = {
  disconnected: "bg-secondary text-secondary-foreground",
  connected:    "bg-secondary text-secondary-foreground",
  synced:       "bg-secondary text-secondary-foreground",
  syncing:      "bg-secondary text-secondary-foreground",
  sync_failed:  "bg-yellow-500/10 text-yellow-700",
  error:        "bg-yellow-500/10 text-yellow-700",
};

const STATUS_DOT = {
  disconnected: "bg-muted-foreground/40",
  connected:    "bg-foreground",
  synced:       "bg-foreground",
  syncing:      "bg-foreground animate-pulse",
  sync_failed:  "bg-yellow-500",
  error:        "bg-yellow-500",
};

const STATUS_LABEL = {
  disconnected: "Not connected",
  connected:    "Connected",
  synced:       "Connected",
  syncing:      "Syncing…",
  sync_failed:  "Sync failed",
  error:        "Error",
};

const JOB_STATUS_BADGE = {
  queued:    "bg-secondary text-muted-foreground",
  running:   "bg-secondary text-foreground",
  completed: "bg-secondary text-foreground",
  failed:    "bg-destructive/10 text-destructive",
  cancelled: "bg-secondary text-muted-foreground",
};

const AUDIT_ICON = {
  connected:         { Icon: CheckCircle2, cls: "text-foreground" },
  disconnected:      { Icon: Unplug,       cls: "text-muted-foreground" },
  connection_failed: { Icon: XCircle,      cls: "text-destructive" },
  reconnected:       { Icon: CheckCircle2, cls: "text-foreground" },
  health_passed:     { Icon: ShieldCheck,  cls: "text-foreground" },
  health_failed:     { Icon: AlertCircle,  cls: "text-destructive" },
  sync_queued:       { Icon: Clock,        cls: "text-muted-foreground" },
  sync_completed:    { Icon: CheckCircle2, cls: "text-foreground" },
  sync_failed:       { Icon: XCircle,      cls: "text-destructive" },
  sync_cancelled:    { Icon: XCircle,      cls: "text-muted-foreground" },
};

// ── Instruction step renderer ──────────────────────────────────────────────────
function InstructionStep({ step, index }) {
  const { t } = usePreferences();
  const [copied, setCopied] = useState(null);
  const copyText = (text, i) => {
    navigator.clipboard.writeText(text);
    setCopied(i);
    setTimeout(() => setCopied(null), 1500);
  };
  return (
    <div className="mb-5">
      <div className="flex items-center gap-2 mb-2">
        <span className="flex items-center justify-center w-5 h-5 rounded-full bg-foreground text-background text-[10px] font-bold flex-shrink-0">
          {index + 1}
        </span>
        <p className="text-xs font-semibold">{t(step.title)}</p>
      </div>
      <div className="ml-7 space-y-1.5">
        {step.steps.map((s, si) => {
          if (typeof s === "string")
            return <p key={si} className="text-xs text-muted-foreground leading-relaxed">{t(s)}</p>;
          if (s.type === "emails")
            return (
              <div key={si} className="space-y-1.5 mt-1.5">
                {s.value.map((email, ei) => (
                  <div key={ei} className="flex items-center gap-2 bg-secondary rounded-md px-2.5 py-1.5">
                    <span className="text-[11px] font-mono flex-1 truncate">{email}</span>
                    <button onClick={() => copyText(email, ei)} className="text-muted-foreground hover:text-foreground flex-shrink-0">
                      {copied === ei ? <CheckCircle2 className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    </button>
                  </div>
                ))}
              </div>
            );
          if (s.type === "table")
            return (
              <div key={si} className="mt-2 overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="bg-secondary/60">
                      {s.headers.map((h, hi) => (
                        <th key={hi} className="px-2.5 py-1.5 text-left font-medium text-muted-foreground whitespace-nowrap">{t(h)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {s.rows.map((row, ri) => (
                      <tr key={ri} className="border-t border-border">
                        {row.map((cell, ci) => <td key={ci} className="px-2.5 py-1.5 font-mono">{cell}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          return null;
        })}
      </div>
    </div>
  );
}

// ── WordPress Plugin Install panel ────────────────────────────────────────────
function WordPressPluginInstall({ isConnected, onConnect, isLoading }) {
  const { t } = usePreferences();
  const [copied, setCopied] = useState(false);

  const { data: activityData } = useQuery({
    queryKey: ["popup-last-activity"],
    queryFn: () => appClient.popup.getLastActivity(),
    refetchInterval: 60_000,
  });

  const companyId = getCurrentCompanyId() || "";
  const hasActivity = activityData?.has_activity;
  const lastActivity = activityData?.last_activity;

  const copyCompanyId = () => {
    if (!companyId) return;
    navigator.clipboard.writeText(companyId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // Activity status indicator
  let activityDot = "bg-muted-foreground/40";
  let activityLabel = t("No activity captured yet");
  let activitySub = t("Install the plugin and visit a page on your site to verify it's working.");

  if (hasActivity && lastActivity?.CreatedAt) {
    const ms = Date.now() - new Date(lastActivity.CreatedAt).getTime();
    const hours = ms / 36e5;
    if (hours < 1) {
      activityDot = "bg-green-500";
      activityLabel = t("Last activity") + " " + formatDistanceToNow(new Date(lastActivity.CreatedAt), { addSuffix: true });
      activitySub = t("Plugin is active and sending data.");
    } else if (hours < 24) {
      activityDot = "bg-yellow-400";
      activityLabel = t("Last activity") + " " + formatDistanceToNow(new Date(lastActivity.CreatedAt), { addSuffix: true });
      activitySub = t("Plugin is installed. No recent activity in the last hour.");
    } else {
      activityDot = "bg-muted-foreground/40";
      activityLabel = t("Last activity") + " " + formatDistanceToNow(new Date(lastActivity.CreatedAt), { addSuffix: true });
      activitySub = t("No recent activity - check if the plugin is still active on your WordPress site.");
    }
  }

  return (
    <div className="space-y-4 pt-1">
      {/* Company ID */}
      <div className="space-y-1.5">
        <p className="text-xs font-medium">{t("Your Company ID")}</p>
        <p className="text-[11px] text-muted-foreground">{t("Paste this into the plugin settings in your WordPress admin.")}</p>
        <div className="flex items-center gap-2 bg-secondary rounded-md px-2.5 py-2">
          <span className="text-[11px] font-mono flex-1 truncate text-foreground">
            {companyId || t("Loading…")}
          </span>
          <button
            onClick={copyCompanyId}
            disabled={!companyId}
            className="text-muted-foreground hover:text-foreground flex-shrink-0 transition-colors"
          >
            {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-foreground" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Activity indicator */}
      <div className="rounded-lg border border-border p-3 bg-secondary/20 space-y-1">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${activityDot}`} />
          <p className="text-xs font-medium">{activityLabel}</p>
        </div>
        <p className="text-[11px] text-muted-foreground pl-4">{activitySub}</p>
      </div>

      {/* Download */}
      <div className="rounded-lg border border-border p-3 bg-secondary/20 space-y-2">
        <p className="text-xs text-muted-foreground">{t("Download the plugin and install it on your WordPress site following the steps in the")} <strong>{t("How to Connect")}</strong> {t("tab.")}</p>
        <a
          href={appClient.dataIntegrations.downloadWordPressPlugin()}
          download="capsuite-cdp-popup.zip"
        >
          <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs">
            <Download className="w-3 h-3" /> {t("Download Plugin (.zip)")}
          </Button>
        </a>
      </div>

      {!isConnected ? (
        <Button size="sm" className="w-full h-8 text-xs" onClick={() => onConnect({})} disabled={isLoading}>
          {isLoading && <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />}
          {t("Mark as Installed")}
        </Button>
      ) : (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CheckCircle2 className="w-3.5 h-3.5" /> {t("Plugin marked as installed")}
        </div>
      )}
    </div>
  );
}

// ── Connection form ────────────────────────────────────────────────────────────
function ConnectionForm({ integration, record, onConnect, isLoading }) {
  const { t } = usePreferences();
  const [form, setForm] = useState(() =>
    Object.fromEntries((integration.fields || []).map((f) => [
      f.key,
      // Never pre-fill password / token fields- the stored value is encrypted
      // and the client only receives a redacted mask anyway. Non-sensitive fields
      // (like storeName, propertyId) pre-fill for convenience.
      f.type === "password" ? "" : (record?.config?.[f.key] || ""),
    ]))
  );
  const [showPasswords, setShowPasswords] = useState({});

  const isConnected = record?.is_connected && !record?.is_connection_error;

  if (integration.isPlugin) {
    return (
      <WordPressPluginInstall
        isConnected={isConnected}
        onConnect={onConnect}
        isLoading={isLoading}
      />
    );
  }

  if (integration.isOAuth) {
    return (
      <form onSubmit={(e) => { e.preventDefault(); onConnect(form); }} className="space-y-4 pt-1">
        {integration.fields.map((field) => (
          <div key={field.key} className="space-y-1">
            <Label className="text-xs">{t(field.label)}</Label>
            <Input
              value={form[field.key]}
              onChange={(e) => setForm((p) => ({ ...p, [field.key]: e.target.value }))}
              placeholder={t(field.placeholder)}
              disabled={isLoading}
              className="h-9 text-sm"
            />
            {field.hint && <p className="text-[11px] text-muted-foreground">{t(field.hint)}</p>}
          </div>
        ))}
        {record?.is_connection_error && (
          <div className="flex items-start gap-1.5 rounded-md border border-border bg-secondary/20 px-3 py-2">
            <AlertCircle className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
            <p className="text-xs text-muted-foreground">{record.connection_error || t("Connection failed.")}</p>
          </div>
        )}
        <Button type="submit" size="sm" className="w-full h-8 text-xs gap-1.5" disabled={isLoading || !form[integration.fields[0]?.key]}>
          {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <ExternalLink className="w-3 h-3" />}
          {t("Install CDP App")}
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); onConnect(form); }} className="space-y-4 pt-1">
      {integration.fields.map((field) => (
        <div key={field.key} className="space-y-1">
          <Label className="text-xs">{t(field.label)}</Label>
          <div className="relative">
            <Input
              type={field.type === "password" && !showPasswords[field.key] ? "password" : "text"}
              value={form[field.key]}
              onChange={(e) => setForm((p) => ({ ...p, [field.key]: e.target.value }))}
              placeholder={isConnected ? "••••••••••••" : t(field.placeholder)}
              disabled={isConnected || isLoading}
              className={cn("h-9 text-sm", field.type === "password" && "pr-9")}
            />
            {field.type === "password" && (
              <button
                type="button"
                onClick={() => setShowPasswords((p) => ({ ...p, [field.key]: !p[field.key] }))}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                tabIndex={-1}
              >
                {showPasswords[field.key] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            )}
          </div>
          {field.hint && <p className="text-[11px] text-muted-foreground">{t(field.hint)}</p>}
        </div>
      ))}

      {record?.is_connection_error && (
        <div className="flex items-start gap-1.5 rounded-md border border-border bg-secondary/20 px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
          <p className="text-xs text-muted-foreground">{record.connection_error || t("Check your credentials and try again.")}</p>
        </div>
      )}

      {isConnected ? (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CheckCircle2 className="w-3.5 h-3.5" /> {t("Connected- disconnect to update credentials.")}
        </div>
      ) : (
        <Button
          type="submit" size="sm" className="w-full h-8 text-xs"
          disabled={isLoading || integration.fields.some((f) => !form[f.key]?.trim())}
        >
          {isLoading && <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />}
          {record?.is_connection_error ? t("Retry Connection") : t("Connect")}
        </Button>
      )}
    </form>
  );
}

// ── Sync job list ──────────────────────────────────────────────────────────────
function SyncJobList({ type }) {
  const { t } = usePreferences();
  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ["sync-jobs", type],
    queryFn: () => appClient.dataIntegrations.syncJobs(type),
    staleTime: 10_000,
  });

  if (isLoading) return <div className="py-8 flex justify-center"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>;
  if (!jobs.length) return <p className="text-xs text-muted-foreground py-4">{t("No sync jobs yet.")}</p>;

  return (
    <div className="space-y-2">
      {jobs.map((job) => (
        <div key={job.id} className="flex items-start gap-2.5 rounded-lg border border-border px-3 py-2.5">
          <div className="mt-0.5 flex-shrink-0">
            {(job.status === "queued" || job.status === "running")
              ? <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
              : job.status === "completed"
              ? <CheckCircle2 className="w-3.5 h-3.5 text-foreground" />
              : <XCircle className="w-3.5 h-3.5 text-destructive" />
            }
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <Badge className={cn("text-[10px] h-4 px-1.5", JOB_STATUS_BADGE[job.status] || "bg-secondary")}>
                {job.status}
              </Badge>
              <span className="text-[11px] text-muted-foreground">
                {job.created_date
                  ? formatDistanceToNow(new Date(job.created_date), { addSuffix: true })
                  : "-"}
              </span>
              {job.records_synced != null && (
                <span className="text-[11px] text-muted-foreground">{job.records_synced.toLocaleString()} {t("records")}</span>
              )}
            </div>
            {job.error_message && (
              <p className="text-[11px] text-destructive mt-0.5 break-words">{job.error_message}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Audit log list ─────────────────────────────────────────────────────────────
function AuditLogList({ type }) {
  const { t } = usePreferences();
  const { data: events = [], isLoading } = useQuery({
    queryKey: ["audit-log", type],
    queryFn: () => appClient.dataIntegrations.auditLog(type),
    staleTime: 10_000,
  });

  if (isLoading) return <div className="py-8 flex justify-center"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>;
  if (!events.length) return <p className="text-xs text-muted-foreground py-4">{t("No activity yet.")}</p>;

  return (
    <div className="space-y-1.5">
      {events.map((evt) => {
        const { Icon, cls } = AUDIT_ICON[evt.action] || { Icon: Activity, cls: "text-muted-foreground" };
        return (
          <div key={evt.id} className="flex items-start gap-2.5 py-1.5">
            <Icon className={cn("w-3.5 h-3.5 mt-0.5 flex-shrink-0", cls)} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-medium capitalize">{evt.action.replace(/_/g, " ")}</span>
                <span className="text-[11px] text-muted-foreground">
                  {evt.occurred_at
                    ? formatDistanceToNow(new Date(evt.occurred_at), { addSuffix: true })
                    : "-"}
                </span>
              </div>
              {evt.detail && <p className="text-[11px] text-muted-foreground mt-0.5 break-words">{evt.detail}</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Integration card ───────────────────────────────────────────────────────────
function IntegrationCard({ integration, record, onSetup, onSync, onRetest, onDisconnect, isRetesting }) {
  const { t } = usePreferences();
  const status = integration.comingSoon ? "disconnected" : getStatus(record);
  const isConnected = ["connected", "synced", "syncing", "sync_failed"].includes(status);

  // Config detail lines shown below the status badge - array of { label, value }
  const configLines = isConnected && record?.config
    ? integration.id === "googleAnalytics"
      ? [
          { label: "ID",  value: record.config.propertyId },
          { label: "URL", value: record.config.propertyName },
        ]
      : integration.id === "googleSearchConsole"
      ? [{ label: "Site", value: record.config.siteUrl }]
      : integration.id === "shopify"
      ? [{ label: "Store", value: `${record.config.storeName}.myshopify.com` }]
      : integration.id === "shopifyCustomApp"
      ? [{ label: "Store", value: record.config.storeName }]
      : []
    : [];

  return (
    <div className={cn(
      "bg-background border border-border rounded-xl overflow-hidden transition-all flex flex-col",
      integration.comingSoon ? "opacity-60 cursor-not-allowed" : "hover:shadow-md hover:border-border/80"
    )}>
      <div className="p-4 flex flex-col gap-3 flex-1">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0">
            <integration.Icon className="w-4 h-4 text-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold text-sm leading-snug">{integration.name}</p>
              <span className="text-[10px] text-muted-foreground">{t(integration.category)}</span>
              {integration.comingSoon && (
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground border border-border">
                  {t("Coming Soon")}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{t(integration.description)}</p>
          </div>
        </div>

        {/* Status + config detail */}
        <div className="flex flex-col gap-1">
          <Badge className={cn("text-[10px] h-4 px-1.5 gap-0.5 flex items-center self-start", STATUS_BADGE[status])}>
            {status === "syncing"
              ? <Loader2 className="w-1.5 h-1.5 animate-spin flex-shrink-0" />
              : <span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", STATUS_DOT[status])} />
            }
            {t(STATUS_LABEL[status])}
          </Badge>
          {configLines.map(({ label, value }) => value && (
            <div key={label} className="flex items-baseline gap-1.5 min-w-0">
              <span className="text-[10px] text-muted-foreground/60 font-medium uppercase tracking-wide flex-shrink-0">{t(label)}</span>
              <span className="text-[11px] text-muted-foreground font-mono truncate">{value}</span>
            </div>
          ))}
        </div>

        {/* Dates */}
        {isConnected && (
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap">
            {record?.last_connected_date && (
              <span>{t("Connected")} {format(new Date(record.last_connected_date), "MMM d, yyyy")}</span>
            )}
            {record?.last_tested_date && (
              <span className="flex items-center gap-1">
                <span className="w-1 h-1 rounded-full bg-muted-foreground/30" />
                {t("Tested")} {formatDistanceToNow(new Date(record.last_tested_date), { addSuffix: true })}
              </span>
            )}
            {record?.last_synced_date && (
              <span className="flex items-center gap-1">
                <span className="w-1 h-1 rounded-full bg-muted-foreground/30" />
                {t("Synced")} {format(new Date(record.last_synced_date), "MMM d, yyyy")}
              </span>
            )}
          </div>
        )}

      </div>

      {/* Action bar - single row, no wrapping */}
      <div className="px-3 py-2 border-t border-border bg-secondary/20 flex items-center gap-0.5 min-w-0">
        {integration.comingSoon ? (
          <span className="text-[11px] text-muted-foreground px-1">{t("Available soon")}</span>
        ) : (
          <>
            {!isConnected && status !== "error" && (
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 px-2 text-muted-foreground hover:text-foreground flex-shrink-0" onClick={onSetup}>
                <ChevronRight className="w-3 h-3" /> {t("Set Up")}
              </Button>
            )}
            {status === "error" && (
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 px-2 text-muted-foreground hover:text-foreground flex-shrink-0" onClick={onSetup}>
                <AlertCircle className="w-3 h-3" /> {t("Fix")}
              </Button>
            )}
            {(isConnected || status === "error") && (
              <Button
                variant="ghost" size="sm"
                className="h-7 text-xs gap-1 px-2 text-muted-foreground hover:text-foreground flex-shrink-0"
                onClick={onRetest}
                disabled={isRetesting || status === "syncing"}
              >
                {isRetesting ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
                {isRetesting ? t("Testing…") : t("Re-test")}
              </Button>
            )}
            {integration.syncable && (status === "connected" || status === "sync_failed") && (
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 px-2 text-muted-foreground hover:text-foreground flex-shrink-0" onClick={onSync}>
                <RefreshCw className="w-3 h-3" /> {t("Sync Data")}
              </Button>
            )}
            {integration.syncable && status === "synced" && (
              <span
                className="flex items-center gap-1 text-[11px] text-muted-foreground px-2 flex-shrink-0"
                title={t("This integration now syncs automatically once a day. Manual sync is no longer needed.")}
              >
                <RefreshCw className="w-3 h-3" /> {t("Synced daily")}
              </span>
            )}
            {isConnected && status === "syncing" && (
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground px-2 flex-shrink-0">
                <Loader2 className="w-3 h-3 animate-spin" /> {t("Syncing…")}
              </span>
            )}
            {(isConnected || status === "error") && (
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 px-2 text-muted-foreground hover:text-foreground ml-auto flex-shrink-0" onClick={onDisconnect}>
                <Unplug className="w-3 h-3" /> {t("Disconnect")}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function Integrations() {
  const { t } = usePreferences();
  const [search, setSearch]                 = useState("");
  const [activeIntegration, setActiveIntegration] = useState(null);
  const [sheetTab, setSheetTab]             = useState("instructions");
  const [disconnectTarget, setDisconnectTarget] = useState(null);
  const [retestingTypes, setRetestingTypes] = useState(new Set());
  const queryClient = useQueryClient();

  const { data: integrationsList = [], isLoading } = useQuery({
    queryKey: ["data-integrations"],
    queryFn: () => appClient.dataIntegrations.list(),
    // Dynamic polling: every 3 s when any integration is actively syncing,
    // no polling otherwise. Removes the old always-on 30 s interval.
    refetchInterval: (query) => {
      const list = query.state.data || [];
      const hasSyncing = list.some((r) =>
        r.latest_job_status === "queued" || r.latest_job_status === "running"
      );
      return hasSyncing ? 3_000 : false;
    },
    refetchOnWindowFocus: true,
  });

  const recordMap = useMemo(
    () => Object.fromEntries(integrationsList.map((r) => [r.integration_type, r])),
    [integrationsList]
  );

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["data-integrations"] });

  // ── Connect ──────────────────────────────────────────────────────────────────
  const connectMutation = useMutation({
    mutationFn: ({ type, config }) => appClient.dataIntegrations.connect(type, config),
    onSuccess: (data) => {
      invalidate();
      if (data?.oauthUrl) { window.location.href = data.oauthUrl; return; }
      if (data?.is_connection_error) {
        toast.error(t("Connection failed:") + " " + (data.connection_error || t("Unknown error")));
      } else {
        toast.success(t("Integration connected."));
        setActiveIntegration(null);
      }
    },
    onError: (e) => toast.error(e.message),
  });

  // ── Re-test ──────────────────────────────────────────────────────────────────
  const retestMutation = useMutation({
    mutationFn: (type) => appClient.dataIntegrations.check(type),
    onMutate: (type) => setRetestingTypes((p) => new Set([...p, type])),
    onSettled: (_, __, type) => setRetestingTypes((p) => { const n = new Set(p); n.delete(type); return n; }),
    onSuccess: (data) => {
      invalidate();
      if (data?.is_connection_error) {
        toast.error(t("Connection check failed:") + " " + (data.connection_error || t("Unknown error")));
      } else {
        toast.success(t("Connection verified successfully."));
      }
    },
    onError: (e) => toast.error(e.message),
  });

  // ── Sync ─────────────────────────────────────────────────────────────────────
  const syncMutation = useMutation({
    mutationFn: (type) => appClient.dataIntegrations.sync(type),
    onSuccess: (data) => {
      invalidate();
      if (data?.alreadyQueued) {
        toast.info(t("A sync is already in progress."));
      } else {
        toast.success(t("Sync queued. Data will refresh shortly."));
      }
    },
    onError: (e) => toast.error(e.message),
  });

  // ── Disconnect ───────────────────────────────────────────────────────────────
  const disconnectMutation = useMutation({
    mutationFn: (type) => appClient.dataIntegrations.disconnect(type),
    onSuccess: () => {
      invalidate();
      toast.success(t("Integration disconnected."));
      setDisconnectTarget(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const handleSetup = (integration) => {
    const record = recordMap[integration.id];
    const connected = record?.is_connected && !record?.is_connection_error;
    // Already connected (or errored) → open the connection/manage view, not the
    // "How to Connect" steps. Only a never-connected integration lands on instructions.
    setSheetTab(connected || record?.is_connection_error ? "connect" : "instructions");
    setActiveIntegration(integration);
  };

  const handleDisconnect = (integration) => {
    const record = recordMap[integration.id];
    // Skip confirmation when the connection never succeeded - just wipe it immediately
    if (record?.is_connection_error && !record?.is_connected) {
      disconnectMutation.mutate(integration.id);
    } else {
      setDisconnectTarget(integration.id);
    }
  };

  const filtered = INTEGRATIONS.filter((i) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return i.name.toLowerCase().includes(q) || i.category.toLowerCase().includes(q);
  });

  // "My Connections" - connected or attempted (error counts)
  const myConnections = filtered.filter((i) => {
    if (i.comingSoon) return false;
    const r = recordMap[i.id];
    return r?.is_connected || r?.is_connection_error;
  });

  // "Available Connections" - never touched, not coming soon
  const availableConnections = filtered.filter((i) => {
    if (i.comingSoon) return false;
    const r = recordMap[i.id];
    return !r?.is_connected && !r?.is_connection_error;
  });

  // "Coming Soon" - flagged integrations
  const comingSoonConnections = filtered.filter((i) => i.comingSoon);

  const activeRecord         = activeIntegration ? recordMap[activeIntegration.id] : null;
  const disconnectIntegration = disconnectTarget  ? INTEGRATIONS.find((i) => i.id === disconnectTarget) : null;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-8 pt-8 pb-0 flex-shrink-0">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-heading text-3xl font-semibold tracking-tight">{t("Integrations")}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {t("Connect your data sources to sync customer behaviour, orders, and web analytics.")}
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-8 py-6">
        <div className="mb-6">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("Search integrations...")}
              className="w-full h-9 pl-9 pr-3 text-sm bg-background border border-input rounded-md outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>

        {isLoading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {[1, 2, 3, 4, 5].map((n) => (
              <div key={n} className="h-36 rounded-xl border border-border bg-background animate-pulse" />
            ))}
          </div>
        )}

        {!isLoading && filtered.length === 0 && (
          <p className="text-sm text-muted-foreground py-8">{t("No integrations match your search.")}</p>
        )}

        {!isLoading && filtered.length > 0 && (
          <div className="space-y-8">
            {/* My Connections */}
            {myConnections.length > 0 && (
              <div>
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  {t("My Connections")}
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {myConnections.map((integration) => (
                    <IntegrationCard
                      key={integration.id}
                      integration={integration}
                      record={recordMap[integration.id]}
                      onSetup={() => handleSetup(integration)}
                      onSync={() => syncMutation.mutate(integration.id)}
                      onRetest={() => retestMutation.mutate(integration.id)}
                      onDisconnect={() => handleDisconnect(integration)}
                      isRetesting={retestingTypes.has(integration.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Available Connections */}
            {availableConnections.length > 0 && (
              <div>
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  {t("Available Connections")}
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {availableConnections.map((integration) => (
                    <IntegrationCard
                      key={integration.id}
                      integration={integration}
                      record={recordMap[integration.id]}
                      onSetup={() => handleSetup(integration)}
                      onSync={() => syncMutation.mutate(integration.id)}
                      onRetest={() => retestMutation.mutate(integration.id)}
                      onDisconnect={() => handleDisconnect(integration)}
                      isRetesting={retestingTypes.has(integration.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Coming Soon */}
            {comingSoonConnections.length > 0 && (
              <div>
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  {t("Coming Soon")}
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {comingSoonConnections.map((integration) => (
                    <IntegrationCard
                      key={integration.id}
                      integration={integration}
                      record={recordMap[integration.id]}
                      onSetup={() => {}}
                      onSync={() => {}}
                      onRetest={() => {}}
                      onDisconnect={() => {}}
                      isRetesting={false}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Setup / History Sheet */}
      <Sheet open={!!activeIntegration} onOpenChange={(open) => !open && setActiveIntegration(null)}>
        <SheetContent side="right" className="w-full sm:max-w-md flex flex-col p-0 overflow-y-auto">
          {activeIntegration && (
            <>
              <div className="px-6 pt-6 pb-4 border-b border-border flex-shrink-0">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0">
                    <activeIntegration.Icon className="w-4 h-4 text-foreground" />
                  </div>
                  <div>
                    <SheetTitle className="text-sm font-semibold leading-tight">{activeIntegration.name}</SheetTitle>
                    <SheetDescription className="text-xs mt-0.5">{t(activeIntegration.description)}</SheetDescription>
                  </div>
                </div>
              </div>

              <Tabs value={sheetTab} onValueChange={setSheetTab} className="flex flex-col flex-1 overflow-hidden">
                <TabsList className="mx-6 mt-4 w-auto self-start flex-shrink-0">
                  <TabsTrigger value="instructions" className="text-xs">{t("How to Connect")}</TabsTrigger>
                  <TabsTrigger value="connect" className="text-xs">
                    {activeIntegration.isPlugin ? t("Install") : t("Connect")}
                  </TabsTrigger>
                  {(activeRecord?.is_connected || activeRecord?.is_connection_error) && (
                    <TabsTrigger value="history" className="text-xs gap-1">
                      <History className="w-3 h-3" /> {t("History")}
                    </TabsTrigger>
                  )}
                </TabsList>

                <TabsContent value="instructions" className="flex-1 overflow-y-auto px-6 pb-6 mt-4">
                  {activeIntegration.instructions.map((step, i) => (
                    <InstructionStep key={i} step={step} index={i} />
                  ))}
                  <Button
                    variant="outline" size="sm" className="w-full h-8 text-xs gap-1.5 mt-2"
                    onClick={() => setSheetTab("connect")}
                  >
                    {t("Continue to")} {activeIntegration.isPlugin ? t("Install") : t("Connect")}
                    <ChevronRight className="w-3 h-3" />
                  </Button>
                </TabsContent>

                <TabsContent value="connect" className="flex-1 overflow-y-auto px-6 pb-6 mt-4">
                  <ConnectionForm
                    integration={activeIntegration}
                    record={activeRecord}
                    onConnect={(config) => connectMutation.mutate({ type: activeIntegration.id, config })}
                    isLoading={connectMutation.isPending}
                  />
                </TabsContent>

                {(activeRecord?.is_connected || activeRecord?.is_connection_error) && (
                  <TabsContent value="history" className="flex-1 overflow-y-auto px-6 pb-6 mt-4">
                    {activeIntegration.syncable && (
                      <>
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-xs font-medium">{t("Sync Jobs")}</p>
                          {getStatus(activeRecord) === "synced" ? (
                            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <RefreshCw className="w-3 h-3" /> {t("Synced daily")}
                            </span>
                          ) : (
                            <Button
                              variant="outline" size="sm" className="h-7 text-xs gap-1.5"
                              onClick={() => syncMutation.mutate(activeIntegration.id)}
                              disabled={syncMutation.isPending || getStatus(activeRecord) === "syncing"}
                            >
                              {syncMutation.isPending
                                ? <Loader2 className="w-3 h-3 animate-spin" />
                                : <RefreshCw className="w-3 h-3" />
                              }
                              {t("Sync Data")}
                            </Button>
                          )}
                        </div>
                        {getStatus(activeRecord) === "synced" && (
                          <p className="text-[11px] text-muted-foreground mb-3 -mt-1">
                            {t("This integration syncs automatically once a day - no need to sync manually anymore.")}
                          </p>
                        )}
                        <SyncJobList type={activeIntegration.id} />
                        <div className="mt-6 mb-3">
                          <p className="text-xs font-medium">{t("Activity Log")}</p>
                        </div>
                      </>
                    )}
                    {!activeIntegration.syncable && (
                      <div className="mb-3">
                        <p className="text-xs font-medium">{t("Activity Log")}</p>
                      </div>
                    )}
                    <AuditLogList type={activeIntegration.id} />
                  </TabsContent>
                )}
              </Tabs>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Disconnect dialog */}
      <AlertDialog open={!!disconnectTarget} onOpenChange={(open) => !open && setDisconnectTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Disconnect")} {disconnectIntegration?.name}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                {disconnectIntegration?.disconnectWarning && (
                  <div className="rounded-lg border border-border bg-secondary/20 px-3 py-2.5 space-y-1">
                    <p className="text-xs font-medium">{t("Please be aware:")}</p>
                    <ul className="text-xs text-muted-foreground space-y-0.5 list-disc list-inside">
                      <li>{t(disconnectIntegration.disconnectWarning)}</li>
                      <li>{t("Real-time data flow will stop immediately.")}</li>
                      <li>{t("This action cannot be undone.")}</li>
                    </ul>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => disconnectMutation.mutate(disconnectTarget)}
              className="bg-foreground text-background hover:bg-foreground/90"
              disabled={disconnectMutation.isPending}
            >
              {disconnectMutation.isPending && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
              {t("Disconnect")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
