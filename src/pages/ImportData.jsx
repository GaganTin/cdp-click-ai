import { useState } from "react";
import { appClient } from "@/api/appClient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Upload, Download, Loader2, UserCheck, Ghost, Link as LinkIcon, Globe, UserCog,
  SlidersHorizontal, ShieldOff, Mail, BarChart2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import ProfileImportDialog from "@/components/import/ProfileImportDialog";
import UTMImportDialog from "@/components/import/UTMImportDialog";
import SuppressionImportDialog from "@/components/import/SuppressionImportDialog";
import AttributeImportDialog, { exportAttributes } from "@/components/attributes/AttributeImportDialog";

// Central hub for every CSV/data import AND export in the app. Each source keeps
// its own import/export entry point on its native page; this page just gathers
// the same flows in one place so they can all be reached from a single location.
// Import dialogs are the shared components those pages also use; exports call the
// same appClient endpoints / helpers the native pages do.

// ── Import cards ────────────────────────────────────────────────────────────────
// `kind` decides which dialog a card opens; "attribute" cards carry the source.
const IMPORT_SECTIONS = [
  {
    label: "Audience",
    cards: [
      { key: "profiles", kind: "profiles", icon: UserCheck, title: "Customer Profiles",
        desc: "Bulk-create customer profiles from a CSV. primary_email is required; member IDs auto-generate when blank." },
    ],
  },
  {
    label: "Attributes",
    cards: [
      { key: "attr-content", kind: "attribute", source: "web_content", icon: Globe, title: "Content Attributes",
        desc: "Import content-based attribute definitions the AI uses to tag pages and visitors." },
      { key: "attr-manual", kind: "attribute", source: "manual", icon: UserCog, title: "Manual Attributes",
        desc: "Import manual attribute definitions and their expected values, then assign people to each." },
      { key: "attr-rule", kind: "attribute", source: "rule", icon: SlidersHorizontal, title: "Rule Attributes",
        desc: "Import computed attributes defined by rules over profile data." },
    ],
  },
  {
    label: "Campaigns",
    cards: [
      { key: "utm", kind: "utm", icon: LinkIcon, title: "UTM Links",
        desc: "Bulk-create UTM-tagged campaign links from a CSV. name and base_url are required." },
    ],
  },
  {
    label: "Email & Pop-ups",
    cards: [
      { key: "suppression", kind: "suppression", icon: ShieldOff, title: "Email Suppression List",
        desc: "Bulk-add emails to your suppression list from a CSV. Duplicates and invalid addresses are skipped." },
    ],
  },
];

// ── Export cards ────────────────────────────────────────────────────────────────
const EXPORT_SECTIONS = [
  {
    label: "Audience",
    cards: [
      { key: "exp-profiles-customer", kind: "export-profiles", profileType: "customer", icon: UserCheck, title: "Customer Profiles",
        desc: "Export every customer profile - identity, demographics, and engagement fields - as a CSV." },
      { key: "exp-profiles-anon", kind: "export-profiles", profileType: "anonymous", icon: Ghost, title: "Anonymous Profiles",
        desc: "Export every anonymous visitor profile, with their behaviour and source fields, as a CSV." },
      { key: "exp-segments-customer", kind: "segments", segType: "customer", icon: UserCheck, title: "Customer Segments",
        desc: "Export a customer segment's matching profiles to a CSV - pick a segment to download." },
      { key: "exp-segments-anon", kind: "segments", segType: "anonymous_profile", icon: Ghost, title: "Anonymous Segments",
        desc: "Export an anonymous segment's matching visitors to a CSV - pick a segment to download." },
    ],
  },
  {
    label: "Attributes",
    cards: [
      { key: "exp-attr-content", kind: "export-attribute", source: "web_content", icon: Globe, title: "Content Attributes",
        desc: "Export all content attribute definitions and their tagged values as a CSV." },
      { key: "exp-attr-manual", kind: "export-attribute", source: "manual", icon: UserCog, title: "Manual Attributes",
        desc: "Export all manual attribute definitions and their approved values as a CSV." },
      { key: "exp-attr-rule", kind: "export-attribute", source: "rule", icon: SlidersHorizontal, title: "Rule Attributes",
        desc: "Export all rule attribute definitions, including their rule logic, as a CSV." },
    ],
  },
  {
    label: "Campaigns",
    cards: [
      { key: "exp-utm", kind: "export-utm", icon: LinkIcon, title: "UTM Links",
        desc: "Export every UTM-tagged campaign link, with its full tracking URL, as a CSV." },
    ],
  },
  {
    label: "Email & Pop-ups",
    cards: [
      { key: "exp-suppression", kind: "export-suppression", icon: ShieldOff, title: "Email Suppression List",
        desc: "Export every suppressed email address and the reason it was suppressed." },
      { key: "exp-collected", kind: "export-collected", icon: Mail, title: "Collected Emails",
        desc: "Export all emails collected by your pop-ups, with the source page and status." },
    ],
  },
  {
    label: "Analytics tables",
    cards: [
      { key: "exp-an-segments", kind: "export-analytics", dataset: "segments-overview", icon: BarChart2, title: "Segments - Overview",
        desc: "Export the segment overview table - size, type, status, and refresh - from the Segments analytics tab." },
      { key: "exp-an-attributes", kind: "export-analytics", dataset: "attributes-coverage", icon: BarChart2, title: "Attributes - Coverage",
        desc: "Export the per-attribute coverage table (values, pending, profiles covered) from the Attributes analytics tab." },
      { key: "exp-an-utm", kind: "export-analytics", dataset: "utm-ga-links", icon: BarChart2, title: "UTM - GA Links",
        desc: "Export the distinct UTM combinations seen in Google Analytics (last 30 days) from the UTM analytics tab." },
      { key: "exp-an-edm", kind: "export-analytics", dataset: "edm-performance", icon: BarChart2, title: "Email - Campaign Performance",
        desc: "Export per-campaign email performance (opens, clicks, bounces…) from the Email analytics tab." },
      { key: "exp-an-popup", kind: "export-analytics", dataset: "popup-performance", icon: BarChart2, title: "Pop-ups - Performance",
        desc: "Export per-pop-up performance (impressions, clicks, emails…) from the Pop Up analytics tab." },
    ],
  },
];

const UTM_EXPORT_COLS = ["name", "status", "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "base_url", "full_utm_url", "created_date"];

// Preferred leading columns per analytics dataset (rowsToCsv appends any others).
const ANALYTICS_COLS = {
  "segments-overview": ["name", "segment_type", "status", "estimated_size", "is_used", "daily_refresh", "last_refreshed"],
  "attributes-coverage": ["name", "source", "status", "value_count", "pending_count", "profiles_covered"],
  "utm-ga-links": ["session_source", "session_medium", "session_campaign_name", "session_content", "session_term", "session_utm_id"],
  "edm-performance": ["name", "subject", "segment_name", "total_recipients", "delivered_count", "open_count", "click_count", "bounce_count", "unsubscribe_count", "sent_at"],
  "popup-performance": ["name", "interaction_type", "status", "segment_name", "impressions", "unique_views", "clicks", "emails", "dismissals", "start_time", "end_time"],
};

// ── CSV helpers ─────────────────────────────────────────────────────────────────
function csvEscape(v) {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(filename, content) {
  const blob = new Blob([content], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Turn an array of row objects into CSV. `preferred` columns lead the order; any
// remaining scalar fields are appended so nothing is silently dropped even if the
// API adds fields. Object/array columns and a few internal ids are skipped.
function rowsToCsv(rows, preferred = []) {
  if (!rows.length) return "";
  const EXCLUDE = new Set(["id", "company_id", "account_id"]);
  const keys = [];
  const seen = new Set();
  preferred.forEach((k) => { keys.push(k); seen.add(k); });
  rows.forEach((r) => Object.keys(r).forEach((k) => {
    if (seen.has(k) || EXCLUDE.has(k)) return;
    const v = r[k];
    if (v === null || ["string", "number", "boolean"].includes(typeof v)) { seen.add(k); keys.push(k); }
  }));
  const present = keys.filter((k) => rows.some((r) => k in r));
  const header = present.join(",");
  const body = rows.map((r) => present.map((k) => csvEscape(r[k])).join(",")).join("\n");
  return `${header}\n${body}\n`;
}

// ── Card ────────────────────────────────────────────────────────────────────────
function DataCard({ card, action }) {
  return (
    <div className="bg-background border border-border rounded-xl overflow-hidden transition-all hover:shadow-md hover:border-border/80 flex flex-col">
      <div className="p-4 flex flex-col gap-3 flex-1">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0">
            <card.icon className="w-4 h-4 text-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm leading-snug">{card.title}</p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{card.desc}</p>
          </div>
        </div>
      </div>
      <div className="px-3 py-2 border-t border-border bg-secondary/20">{action}</div>
    </div>
  );
}

function Section({ section, children }) {
  return (
    <div>
      <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">{section.label}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">{children}</div>
    </div>
  );
}

export default function ImportData() {
  const [tab, setTab] = useState("import");
  // `active` holds the currently open import card descriptor (or null).
  const [active, setActive] = useState(null);
  // Which segment type the export picker is open for: null | "customer" | "anonymous_profile".
  const [segExportType, setSegExportType] = useState(null);
  const [exportingKey, setExportingKey] = useState(null);
  const [segExportingId, setSegExportingId] = useState(null);
  const queryClient = useQueryClient();

  const { data: attributes = [] } = useQuery({
    queryKey: ["attributes"],
    queryFn: () => appClient.attributes.list(),
  });
  const { data: campaigns = [] } = useQuery({
    queryKey: ["campaigns"],
    queryFn: () => appClient.entities.Campaign.list(),
  });
  const { data: segments = [] } = useQuery({
    queryKey: ["segments"],
    queryFn: () => appClient.entities.Segment.list("-created_date"),
  });

  const closeImport = () => setActive(null);

  // ── Export handlers ────────────────────────────────────────────────────────────
  const runExport = async (card) => {
    if (card.kind === "segments") { setSegExportType(card.segType); return; }
    setExportingKey(card.key);
    try {
      if (card.kind === "export-attribute") {
        const subset = attributes.filter((a) => a.source === card.source);
        if (!subset.length) { toast.error(`No ${card.title.toLowerCase()} to export.`); }
        else { await exportAttributes(card.source, subset); toast.success(`Exported ${subset.length} ${card.title.toLowerCase()}`); }
      } else if (card.kind === "export-utm") {
        if (!campaigns.length) { toast.error("No UTM links to export."); }
        else { downloadCsv("utm-links.csv", rowsToCsv(campaigns, UTM_EXPORT_COLS)); toast.success(`Exported ${campaigns.length} UTM link${campaigns.length === 1 ? "" : "s"}`); }
      } else if (card.kind === "export-suppression") {
        const res = await appClient.edm.listSuppression();
        const list = Array.isArray(res) ? res : (res?.data || []);
        if (!list.length) { toast.error("Suppression list is empty."); }
        else { downloadCsv("email-suppression.csv", rowsToCsv(list, ["email", "reason", "added_at"])); toast.success(`Exported ${list.length} suppressed email${list.length === 1 ? "" : "s"}`); }
      } else if (card.kind === "export-collected") {
        const res = await appClient.popup.exportEmailCollected();
        const list = res?.data || (Array.isArray(res) ? res : []);
        if (!list.length) { toast.error("No collected emails to export."); }
        else { downloadCsv("emails-collected.csv", rowsToCsv(list, ["email", "first_name", "last_name", "phone", "popup_name", "source_url", "status", "created_at"])); toast.success(`Exported ${list.length} collected email${list.length === 1 ? "" : "s"}`); }
      } else if (card.kind === "export-profiles") {
        const customer = card.profileType === "customer";
        toast.info(`Fetching ${customer ? "customer" : "anonymous"} profiles…`);
        const rows = await fetchAllProfiles(card.profileType);
        if (!rows.length) { toast.error(`No ${customer ? "customer" : "anonymous"} profiles to export.`); }
        else {
          const preferred = customer
            ? ["member_id", "primary_email", "primary_phone", "eng_full_name", "display_name", "member_type", "member_join_date", "member_reg_channel", "gender", "age_group", "nationality"]
            : ["visitor_id", "first_seen", "last_seen", "sessions", "page_views", "events", "source", "medium", "country"];
          downloadCsv(`${customer ? "customer" : "anonymous"}-profiles.csv`, rowsToCsv(rows, preferred));
          toast.success(`Exported ${rows.length.toLocaleString()} ${customer ? "customer" : "anonymous"} profile${rows.length === 1 ? "" : "s"}`);
        }
      } else if (card.kind === "export-analytics") {
        const { rows, filename } = await loadAnalytics(card.dataset);
        if (!rows.length) { toast.error("Nothing to export - this analytics table is empty."); }
        else { downloadCsv(filename, rowsToCsv(rows, ANALYTICS_COLS[card.dataset] || [])); toast.success(`Exported ${rows.length.toLocaleString()} row${rows.length === 1 ? "" : "s"}`); }
      }
    } catch (e) {
      toast.error(e.message || "Export failed.");
    }
    setExportingKey(null);
  };

  // Pull every profile of a type by paging until we've collected `total`. Uses the
  // actual returned batch size so it's robust to whatever page cap the server applies.
  const fetchAllProfiles = async (profileType) => {
    const fn = profileType === "customer" ? appClient.profiles.listCustomers : appClient.profiles.listAnonymous;
    const PAGE = 500;
    let rows = [], page = 1, total = Infinity;
    while (rows.length < total) {
      const res = await fn({ page, limit: PAGE });
      total = res?.total ?? rows.length + (res?.data?.length || 0);
      const batch = res?.data || [];
      if (!batch.length) break;
      rows = rows.concat(batch);
      page++;
      if (page > 2000) break; // safety stop
    }
    return rows;
  };

  // Fetch an analytics table's rows + a filename. Mirrors what each page's
  // analytics tab renders, so the CSV matches the on-screen table.
  const loadAnalytics = async (dataset) => {
    if (dataset === "segments-overview") {
      return { rows: segments, filename: "segments-overview.csv" };
    }
    if (dataset === "attributes-coverage") {
      const res = await appClient.attributes.analytics();
      return { rows: res?.table || [], filename: "attributes-coverage.csv" };
    }
    if (dataset === "utm-ga-links") {
      const res = await appClient.utm.links(30);
      return { rows: Array.isArray(res) ? res : (res?.data || []), filename: "utm-ga-links.csv" };
    }
    if (dataset === "edm-performance") {
      const res = await appClient.edm.listCampaigns();
      const list = Array.isArray(res) ? res : (res?.data || []);
      return { rows: list.filter((c) => c.status === "sent"), filename: "email-campaign-performance.csv" };
    }
    if (dataset === "popup-performance") {
      const res = await appClient.popup.getAnalytics();
      return { rows: Array.isArray(res) ? res : (res?.data || []), filename: "popup-performance.csv" };
    }
    return { rows: [], filename: "export.csv" };
  };

  const exportSegment = async (seg) => {
    setSegExportingId(seg.id);
    try {
      toast.info("Resolving segment profiles…");
      await appClient.segments.exportCsv(seg.id, seg.name);
      toast.success(`Exported "${seg.name}"`);
    } catch (e) {
      toast.error(e.message || "Export failed");
    }
    setSegExportingId(null);
  };

  // Segments matching the type the export picker is open for.
  const segExportSegments = segExportType
    ? segments.filter((s) => s.segment_type === segExportType)
    : [];

  const TABS = [
    { key: "import", label: "Import", icon: Upload },
    { key: "export", label: "Export", icon: Download },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-8 pt-8 pb-0 flex-shrink-0">
        <div className="mb-5">
          <h1 className="font-heading text-3xl font-semibold tracking-tight">Import / Export Data</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Move data in and out of Click CDP from one place. Every import and export here is also available on its own page.
          </p>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border gap-6">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
                tab === t.key ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <t.icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-8 py-6">
        {tab === "import" ? (
          <div className="space-y-8">
            {IMPORT_SECTIONS.map((section) => (
              <Section key={section.label} section={section}>
                {section.cards.map((card) => (
                  <DataCard key={card.key} card={card} action={
                    <Button
                      variant="ghost" size="sm"
                      className="h-7 text-xs gap-1 px-2 text-muted-foreground hover:text-foreground"
                      onClick={() => setActive(card)}
                    >
                      <Upload className="w-3 h-3" /> Import
                    </Button>
                  } />
                ))}
              </Section>
            ))}
          </div>
        ) : (
          <div className="space-y-8">
            {EXPORT_SECTIONS.map((section) => (
              <Section key={section.label} section={section}>
                {section.cards.map((card) => (
                  <DataCard key={card.key} card={card} action={
                    <Button
                      variant="ghost" size="sm"
                      className="h-7 text-xs gap-1 px-2 text-muted-foreground hover:text-foreground"
                      disabled={exportingKey === card.key}
                      onClick={() => runExport(card)}
                    >
                      {exportingKey === card.key
                        ? <Loader2 className="w-3 h-3 animate-spin" />
                        : <Download className="w-3 h-3" />}
                      {card.kind === "segments" ? "Choose & Export" : "Export CSV"}
                    </Button>
                  } />
                ))}
              </Section>
            ))}
          </div>
        )}
      </div>

      {/* Import dialogs - one mounts at a time based on the active card. */}
      <ProfileImportDialog open={active?.kind === "profiles"} onClose={closeImport} />
      <UTMImportDialog open={active?.kind === "utm"} onClose={closeImport} existingCampaigns={campaigns} />
      <SuppressionImportDialog open={active?.kind === "suppression"} onClose={closeImport} />
      <AttributeImportDialog
        open={active?.kind === "attribute"}
        source={active?.kind === "attribute" ? active.source : "web_content"}
        attrs={active?.kind === "attribute" ? attributes.filter((a) => a.source === active.source) : []}
        onClose={closeImport}
        onImported={() => queryClient.invalidateQueries({ queryKey: ["attributes"] })}
      />

      {/* Segment export picker (filtered to the chosen segment type) */}
      <Dialog open={!!segExportType} onOpenChange={(v) => { if (!v) setSegExportType(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-heading">
              Export {segExportType === "anonymous_profile" ? "an Anonymous" : "a Customer"} Segment
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Download a segment's matching {segExportType === "anonymous_profile" ? "visitors" : "profiles"} as a CSV. Resolving a large segment may take a moment.
          </p>
          <div className="max-h-80 overflow-auto -mx-1 px-1 space-y-1.5 mt-1">
            {segExportSegments.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No {segExportType === "anonymous_profile" ? "anonymous" : "customer"} segments yet.
              </p>
            ) : (
              segExportSegments.map((seg) => (
                <div key={seg.id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{seg.name}</p>
                    {seg.description && <p className="text-[11px] text-muted-foreground truncate">{seg.description}</p>}
                  </div>
                  <Button
                    variant="outline" size="sm" className="h-7 text-xs gap-1.5 flex-shrink-0"
                    disabled={segExportingId === seg.id}
                    onClick={() => exportSegment(seg)}
                  >
                    {segExportingId === seg.id
                      ? <Loader2 className="w-3 h-3 animate-spin" />
                      : <Download className="w-3 h-3" />}
                    Export
                  </Button>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
