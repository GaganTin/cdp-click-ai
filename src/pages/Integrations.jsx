import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { appClient } from "@/api/appClient";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  BarChart2, Search, ShoppingBag, Plug, Globe,
  CheckCircle2, AlertCircle, RefreshCw,
  Loader2, EyeOff, Eye, ExternalLink, Unplug,
  ChevronRight, Copy, Download, XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

const GA_EDITOR_EMAILS = [
  import.meta.env.VITE_GA_EDITOR_EMAIL_1 || "cdp-analytics-1@your-project.iam.gserviceaccount.com",
  import.meta.env.VITE_GA_EDITOR_EMAIL_2 || "cdp-analytics-2@your-project.iam.gserviceaccount.com",
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
      { key: "propertyId", label: "Property ID", placeholder: "e.g. 123456789", type: "text", hint: "Admin → Property Details (top right corner)" },
      { key: "propertyName", label: "Property URL", placeholder: "e.g. https://www.example.com", type: "text", hint: "Admin → Data Streams → your website URL" },
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
            ["Capsuite SID", "Client ID from cookies", "User", "capsuite_sid"],
          ]},
        ],
      },
    ],
    disconnectWarning: "All Google Analytics data (dashboard, custom attributes, anonymous profiles, etc.) stored in the CDP will be permanently deleted.",
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
          { type: "emails", value: GA_EDITOR_EMAILS },
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
      { key: "storeName", label: "Store Name", placeholder: "storename123 (without .myshopify.com)", type: "text", hint: "Settings → Store details → your myshopify.com subdomain." },
      { key: "accessToken", label: "Access Token", placeholder: "shpat_xxxxxxxxxxxxxxxx", type: "password", hint: "Settings → Apps → Develop Apps → your app → Install App." },
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
          "Click Reveal token once to copy your Access Token. (It is only shown once.)",
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
    fields: [
      { key: "storeName", label: "Store Name", placeholder: "storename123 (without .myshopify.com)", type: "text", hint: "Settings → Store details → your myshopify.com subdomain." },
    ],
    instructions: [
      {
        title: "Log in as store owner",
        steps: ["Log in to your Shopify store as the store owner or with admin permissions to approve app installs."],
      },
      {
        title: "Find your Store Name",
        steps: [
          "In the sidebar, go to Settings.",
          "Your Store Name is the subdomain before .myshopify.com (e.g. storename123).",
        ],
      },
      {
        title: "Install the CDP App",
        steps: [
          "Enter your store name below and click Install CDP App.",
          "You will be redirected to a Shopify permissions screen.",
          "Click Install app to approve the Capsuite CDP app.",
          "The CDP tracking script will be automatically added to your storefront.",
        ],
      },
    ],
    disconnectWarning: "The CDP tracking script will be immediately removed from your storefront. Visitor tracking and session data collection will stop immediately.",
  },
  {
    id: "wordpress",
    name: "WordPress Plugin",
    shortName: "WP Plugin",
    description: "Install the CDP tracking plugin on your WordPress site to capture visitor sessions.",
    category: "Tracking",
    Icon: Globe,
    syncable: false,
    isPlugin: true,
    fields: [],
    instructions: [
      {
        title: "Download and install the plugin",
        steps: [
          "Download the Capsuite CDP plugin from the link below.",
          "In your WordPress admin, go to Plugins → Add New Plugin → Upload Plugin.",
          "Upload the downloaded .zip file and click Install Now, then Activate.",
        ],
      },
      {
        title: "Configure your CDP API key",
        steps: [
          "After activation, go to Settings → Capsuite CDP.",
          "Enter your CDP API key (available from your account settings).",
          "Click Save Settings. The plugin will begin tracking visitors immediately.",
        ],
      },
    ],
    disconnectWarning: "The CDP tracking script will be removed from your WordPress site and visitor tracking will stop.",
  },
];

// ── Status helpers ─────────────────────────────────────────────────────────────
function getStatus(record) {
  if (!record?.is_connected) return record?.is_connection_error ? "error" : "disconnected";
  if (record.is_connection_error) return "error";
  return record.is_synced ? "synced" : "connected";
}

const STATUS_BADGE = {
  disconnected: "bg-secondary text-secondary-foreground",
  connected:    "bg-secondary text-secondary-foreground",
  synced:       "bg-secondary text-secondary-foreground",
  error:        "bg-red-100 text-red-700",
};

const STATUS_DOT = {
  disconnected: "bg-muted-foreground/40",
  connected:    "bg-foreground",
  synced:       "bg-foreground",
  error:        "bg-red-500",
};

const STATUS_LABEL = {
  disconnected: "Not connected",
  connected:    "Connected",
  synced:       "Connected",
  error:        "Error",
};

// ── Instruction step ───────────────────────────────────────────────────────────
function InstructionStep({ step, index }) {
  const [copied, setCopied] = useState(null);

  const copyText = (text, i) => {
    navigator.clipboard.writeText(text);
    setCopied(i);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="mb-5">
      <div className="flex items-center gap-2 mb-2">
        <span className="flex items-center justify-center w-4.5 h-4.5 w-5 h-5 rounded-full bg-foreground text-background text-[10px] font-bold flex-shrink-0">
          {index + 1}
        </span>
        <p className="text-xs font-semibold">{step.title}</p>
      </div>
      <div className="ml-7 space-y-1.5">
        {step.steps.map((s, si) => {
          if (typeof s === "string") {
            return <p key={si} className="text-xs text-muted-foreground leading-relaxed">{s}</p>;
          }
          if (s.type === "emails") {
            return (
              <div key={si} className="space-y-1.5 mt-1.5">
                {s.value.map((email, ei) => (
                  <div key={ei} className="flex items-center gap-2 bg-secondary rounded-md px-2.5 py-1.5">
                    <span className="text-[11px] font-mono flex-1 text-foreground truncate">{email}</span>
                    <button onClick={() => copyText(email, ei)} className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0">
                      {copied === ei
                        ? <CheckCircle2 className="w-3 h-3 text-foreground" />
                        : <Copy className="w-3 h-3" />}
                    </button>
                  </div>
                ))}
              </div>
            );
          }
          if (s.type === "table") {
            return (
              <div key={si} className="mt-2 overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="bg-secondary/60">
                      {s.headers.map((h, hi) => (
                        <th key={hi} className="px-2.5 py-1.5 text-left font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {s.rows.map((row, ri) => (
                      <tr key={ri} className="border-t border-border">
                        {row.map((cell, ci) => (
                          <td key={ci} className="px-2.5 py-1.5 font-mono">{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}

// ── Connection form ────────────────────────────────────────────────────────────
function ConnectionForm({ integration, record, onConnect, isLoading }) {
  const [form, setForm] = useState(() =>
    Object.fromEntries((integration.fields || []).map((f) => [f.key, record?.config?.[f.key] || ""]))
  );
  const [showPasswords, setShowPasswords] = useState({});

  const isConnected = record?.is_connected;
  const isBlocked = isConnected && !record?.is_connection_error;

  if (integration.isPlugin) {
    return (
      <div className="space-y-4 pt-1">
        <div className="rounded-lg border border-border p-3 bg-secondary/20 space-y-3">
          <p className="text-xs text-muted-foreground">Download and install the Capsuite CDP WordPress plugin following the instructions in the How to Connect tab.</p>
          <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs" onClick={() => window.open("#", "_blank")}>
            <Download className="w-3 h-3" />
            Download Plugin (.zip)
            <ExternalLink className="w-3 h-3 text-muted-foreground" />
          </Button>
        </div>
        {!isConnected && (
          <Button size="sm" className="w-full h-8 text-xs" onClick={() => onConnect({})} disabled={isLoading}>
            {isLoading && <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />}
            Mark as Installed
          </Button>
        )}
        {isConnected && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Plugin marked as installed
          </div>
        )}
      </div>
    );
  }

  if (integration.isOAuth) {
    return (
      <form onSubmit={(e) => { e.preventDefault(); onConnect(form); }} className="space-y-4 pt-1">
        {integration.fields.map((field) => (
          <div key={field.key} className="space-y-1">
            <Label className="text-xs">{field.label}</Label>
            <Input
              id={field.key}
              value={form[field.key]}
              onChange={(e) => setForm((p) => ({ ...p, [field.key]: e.target.value }))}
              placeholder={field.placeholder}
              disabled={isBlocked || isLoading}
              className="h-9 text-sm"
            />
            {field.hint && <p className="text-[11px] text-muted-foreground">{field.hint}</p>}
          </div>
        ))}
        {record?.is_connection_error && (
          <div className="flex items-start gap-1.5 rounded-md border border-border bg-secondary/20 px-3 py-2">
            <AlertCircle className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
            <p className="text-xs text-muted-foreground">{record.connection_error || "Connection failed."}</p>
          </div>
        )}
        <Button type="submit" size="sm" className="w-full h-8 text-xs gap-1.5" disabled={isLoading || !form[integration.fields[0]?.key]}>
          {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <ExternalLink className="w-3 h-3" />}
          Install CDP App
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); onConnect(form); }} className="space-y-4 pt-1">
      {integration.fields.map((field) => (
        <div key={field.key} className="space-y-1">
          <Label className="text-xs">{field.label}</Label>
          <div className="relative">
            <Input
              id={field.key}
              type={field.type === "password" && !showPasswords[field.key] ? "password" : "text"}
              value={form[field.key]}
              onChange={(e) => setForm((p) => ({ ...p, [field.key]: e.target.value }))}
              placeholder={isBlocked ? "••••••••••••" : field.placeholder}
              disabled={isBlocked || isLoading}
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
          {field.hint && <p className="text-[11px] text-muted-foreground">{field.hint}</p>}
        </div>
      ))}

      {record?.is_connection_error && (
        <div className="flex items-start gap-1.5 rounded-md border border-border bg-secondary/20 px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
          <p className="text-xs text-muted-foreground">{record.connection_error || "Check your credentials and try again."}</p>
        </div>
      )}

      {isBlocked ? (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CheckCircle2 className="w-3.5 h-3.5" />
          Connected - disconnect to edit credentials.
        </div>
      ) : (
        <Button
          type="submit"
          size="sm"
          className="w-full h-8 text-xs"
          disabled={isLoading || integration.fields.some((f) => !form[f.key]?.trim())}
        >
          {isLoading && <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />}
          {record?.is_connection_error ? "Retry Connection" : "Connect"}
        </Button>
      )}
    </form>
  );
}

// ── Integration card ───────────────────────────────────────────────────────────
function IntegrationCard({ integration, record, onSetup, onSync, onDisconnect, isSyncing }) {
  const status = getStatus(record);
  const isConnected = status === "connected" || status === "synced";

  const configDetail = isConnected && record?.config
    ? integration.id === "googleAnalytics"      ? record.config.propertyId
    : integration.id === "googleSearchConsole"  ? record.config.siteUrl
    : integration.id === "shopify"              ? `${record.config.storeName}.myshopify.com`
    : integration.id === "shopifyCustomApp"     ? record.config.storeName
    : null
    : null;

  return (
    <div className="bg-background border border-border rounded-xl overflow-hidden hover:shadow-md hover:border-border/80 transition-all group flex flex-col">
      <div className="p-4 flex flex-col gap-3 flex-1">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0">
            <integration.Icon className="w-4 h-4 text-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold text-sm leading-snug">{integration.name}</p>
              <span className="text-[10px] text-muted-foreground">{integration.category}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{integration.description}</p>
          </div>
        </div>

        {/* Status + detail */}
        <div className="flex items-center gap-2 flex-wrap">
          <Badge className={cn("text-[10px] h-4 px-1.5 gap-0.5 flex items-center", STATUS_BADGE[status])}>
            <span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", STATUS_DOT[status])} />
            {STATUS_LABEL[status]}
          </Badge>
          {configDetail && (
            <span className="text-[11px] text-muted-foreground font-mono truncate">{configDetail}</span>
          )}
        </div>

        {/* Dates */}
        {isConnected && record?.last_connected_date && (
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap">
            <span>Connected {format(new Date(record.last_connected_date), "MMM d, yyyy")}</span>
            {record.last_synced_date && (
              <span className="flex items-center gap-1">
                <span className="w-1 h-1 rounded-full bg-muted-foreground/30" />
                Synced {format(new Date(record.last_synced_date), "MMM d, yyyy")}
              </span>
            )}
          </div>
        )}

        {/* Error */}
        {status === "error" && record?.connection_error && (
          <p className="text-[11px] text-muted-foreground truncate">{record.connection_error}</p>
        )}
      </div>

      {/* Action bar */}
      <div className="px-3 py-2 border-t border-border bg-secondary/20 flex items-center gap-1">
        {!isConnected && status !== "error" && (
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground" onClick={onSetup}>
            <ChevronRight className="w-3 h-3" /> Set Up
          </Button>
        )}
        {status === "error" && (
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground" onClick={onSetup}>
            <AlertCircle className="w-3 h-3" /> Fix Connection
          </Button>
        )}
        {isConnected && integration.syncable && (
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground" onClick={onSync} disabled={isSyncing}>
            {isSyncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            {isSyncing ? "Syncing…" : "Sync"}
          </Button>
        )}
        {(isConnected || status === "error") && (
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground ml-auto" onClick={onDisconnect}>
            <Unplug className="w-3 h-3" /> Disconnect
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function Integrations() {
  const [search, setSearch] = useState("");
  const [activeIntegration, setActiveIntegration] = useState(null);
  const [sheetTab, setSheetTab] = useState("instructions");
  const [disconnectTarget, setDisconnectTarget] = useState(null);
  const [syncingTypes, setSyncingTypes] = useState(new Set());
  const queryClient = useQueryClient();

  const { data: integrationsList = [], isLoading } = useQuery({
    queryKey: ["data-integrations"],
    queryFn: () => appClient.dataIntegrations.list(),
    refetchInterval: 30_000,
  });

  const recordMap = Object.fromEntries(integrationsList.map((r) => [r.integration_type, r]));

  const connectMutation = useMutation({
    mutationFn: ({ type, config }) => appClient.dataIntegrations.connect(type, config),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["data-integrations"] });
      if (data?.oauthUrl) { window.location.href = data.oauthUrl; return; }
      if (data?.is_connection_error) {
        toast.error(`Connection failed: ${data.connection_error || "Unknown error"}`);
      } else {
        toast.success("Integration connected.");
        setActiveIntegration(null);
      }
    },
    onError: (e) => toast.error(e.message),
  });

  const disconnectMutation = useMutation({
    mutationFn: (type) => appClient.dataIntegrations.disconnect(type),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["data-integrations"] });
      toast.success("Integration disconnected.");
      setDisconnectTarget(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const syncMutation = useMutation({
    mutationFn: (type) => appClient.dataIntegrations.sync(type),
    onSuccess: (data, type) => {
      setSyncingTypes((p) => { const n = new Set(p); n.delete(type); return n; });
      queryClient.invalidateQueries({ queryKey: ["data-integrations"] });
      if (data?.is_sync_error) toast.error(`Sync failed: ${data.sync_error || "Unknown error"}`);
      else toast.success("Data sync triggered.");
    },
    onError: (e, type) => {
      setSyncingTypes((p) => { const n = new Set(p); n.delete(type); return n; });
      toast.error(e.message);
    },
  });

  const handleSync = (type) => {
    setSyncingTypes((p) => new Set([...p, type]));
    syncMutation.mutate(type);
  };

  const handleSetup = (integration) => {
    const record = recordMap[integration.id];
    setSheetTab(record?.is_connection_error ? "connect" : "instructions");
    setActiveIntegration(integration);
  };

  const filtered = INTEGRATIONS.filter((i) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return i.name.toLowerCase().includes(q) || i.category.toLowerCase().includes(q);
  });

  const activeRecord = activeIntegration ? recordMap[activeIntegration.id] : null;
  const disconnectIntegration = disconnectTarget ? INTEGRATIONS.find((i) => i.id === disconnectTarget) : null;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-8 pt-8 pb-0 flex-shrink-0">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-heading text-3xl font-semibold tracking-tight">Integrations</h1>
            <p className="text-sm text-muted-foreground mt-1">Connect your data sources to sync customer behaviour, orders, and web analytics.</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-8 py-6">
        {/* Search */}
        <div className="mb-6">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search integrations..."
              className="w-full h-9 pl-9 pr-3 text-sm bg-background border border-input rounded-md outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>

        {/* Loading skeleton */}
        {isLoading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {[1, 2, 3, 4].map((n) => (
              <div key={n} className="h-36 rounded-xl border border-border bg-background animate-pulse" />
            ))}
          </div>
        )}

        {/* Cards */}
        {!isLoading && filtered.length === 0 && (
          <p className="text-sm text-muted-foreground py-8">No integrations match your search.</p>
        )}

        {!isLoading && filtered.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((integration) => (
              <IntegrationCard
                key={integration.id}
                integration={integration}
                record={recordMap[integration.id]}
                onSetup={() => handleSetup(integration)}
                onSync={() => handleSync(integration.id)}
                onDisconnect={() => setDisconnectTarget(integration.id)}
                isSyncing={syncingTypes.has(integration.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Setup Sheet */}
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
                    <SheetDescription className="text-xs mt-0.5">{activeIntegration.description}</SheetDescription>
                  </div>
                </div>
              </div>

              <Tabs value={sheetTab} onValueChange={setSheetTab} className="flex flex-col flex-1 overflow-hidden">
                <TabsList className="mx-6 mt-4 w-auto self-start flex-shrink-0">
                  <TabsTrigger value="instructions" className="text-xs">How to Connect</TabsTrigger>
                  <TabsTrigger value="connect" className="text-xs">
                    {activeIntegration.isPlugin ? "Install" : "Connect"}
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="instructions" className="flex-1 overflow-y-auto px-6 pb-6 mt-4">
                  {activeIntegration.instructions.map((step, i) => (
                    <InstructionStep key={i} step={step} index={i} />
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full h-8 text-xs gap-1.5 mt-2"
                    onClick={() => setSheetTab("connect")}
                  >
                    Continue to {activeIntegration.isPlugin ? "Install" : "Connect"}
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
              </Tabs>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Disconnect dialog */}
      <AlertDialog open={!!disconnectTarget} onOpenChange={(open) => !open && setDisconnectTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {disconnectIntegration?.name}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                {disconnectIntegration?.disconnectWarning && (
                  <div className="rounded-lg border border-border bg-secondary/20 px-3 py-2.5 space-y-1">
                    <p className="text-xs font-medium">Please be aware:</p>
                    <ul className="text-xs text-muted-foreground space-y-0.5 list-disc list-inside">
                      <li>{disconnectIntegration.disconnectWarning}</li>
                      <li>Real-time data flow will stop immediately.</li>
                      <li>This action cannot be undone.</li>
                    </ul>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => disconnectMutation.mutate(disconnectTarget)}
              className="bg-foreground text-background hover:bg-foreground/90"
              disabled={disconnectMutation.isPending}
            >
              {disconnectMutation.isPending && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
