import { useState, useRef } from "react";
import { appClient } from "@/api/appClient";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileText, FileDown, Download, Upload, X, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";

// Import / export of attribute definitions in a single modal, modeled on the
// "Import UTM Links" modal on the Campaigns page: download a template, fill it,
// upload it - plus an Export tab to pull the current attributes back out.
// One CSV schema per source (Content / Manual / Rule); a row = one attribute.

const SOURCE_META = {
  web_content: {
    label: "Content",
    columns: ["name", "description", "extract_from", "value_type", "scope", "status", "values"],
    example: ["Country", "If any country is found in the text, extract it.", "both", "multi", "both", "draft", "England;Australia;Canada"],
    hint: <><strong>name</strong> is required. <strong>values</strong> is a <code>;</code>-separated list of expected values (optional). After importing, open each attribute and <strong>Reconstruct</strong> to tag pages.</>,
  },
  manual: {
    label: "Manual",
    columns: ["name", "description", "value_type", "scope", "status", "values"],
    example: ["Account Tier", "Customer loyalty tier", "single", "customer", "draft", "VIP;Standard"],
    hint: <><strong>name</strong> is required. <strong>values</strong> is a <code>;</code>-separated list (optional). Assign people to each value after importing.</>,
  },
  rule: {
    label: "Rule",
    columns: ["name", "description", "scope", "status", "rules"],
    example: ["Engagement Level", "Computed from GA sessions", "customer", "draft", '{"match":"first","rules":[{"value":"High","op":"AND","conditions":[{"field":"ga_sessions","operator":"gte","value":"10"}]}]}'],
    hint: <><strong>name</strong> is required. <strong>rules</strong> is a JSON rule definition (optional) - the easiest way to get the shape is to build one rule in the UI, <strong>Export</strong>, then edit and re-import.</>,
  },
};

const DEFAULTS = {
  web_content: { value_type: "multi", scope: "both", extract_from: "both" },
  manual:      { value_type: "multi", scope: "customer" },
  rule:        { value_type: "single", scope: "customer" },
};

const VALUE_TYPES = ["single", "multi"];
const SCOPES = ["customer", "anonymous", "both"];
const STATUSES = ["draft", "active", "archived"];
const EXTRACT = ["both", "title", "content"];

const parseList = (s) => [...new Set(String(s || "").split(/[;,\n]/).map((x) => x.trim()).filter(Boolean))];

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

// Minimal RFC-4180-ish CSV parser: handles quoted fields, escaped quotes (""),
// and commas / newlines inside quotes (needed for the rules JSON column).
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\r") {
      // ignore
    } else if (c === "\n") {
      row.push(field); rows.push(row); row = []; field = "";
    } else {
      field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

// Build a /attributes create payload from one parsed CSV row. Invalid enum
// values fall back to the source's defaults (lenient, like the UTM importer).
function buildPayload(source, row) {
  const d = DEFAULTS[source];
  const payload = {
    name: row.name.trim(),
    description: (row.description || "").trim(),
    source,
    value_type: VALUE_TYPES.includes(row.value_type) ? row.value_type : d.value_type,
    scope: SCOPES.includes(row.scope) ? row.scope : d.scope,
    status: STATUSES.includes(row.status) ? row.status : "draft",
  };
  if (source === "web_content") {
    payload.extract_from = EXTRACT.includes(row.extract_from) ? row.extract_from : d.extract_from;
  }
  if (source === "rule") {
    if (row.rules?.trim()) {
      let parsed;
      try { parsed = JSON.parse(row.rules); }
      catch { return { error: "Invalid rules JSON" }; }
      payload.rule = Array.isArray(parsed)
        ? { match: "first", rules: parsed }
        : (parsed && Array.isArray(parsed.rules) ? parsed : { match: "first", rules: [] });
    } else {
      payload.rule = { match: "first", rules: [] };
    }
  } else {
    const values = parseList(row.values);
    if (values.length) payload.values = values;
  }
  return { data: payload };
}

// Export the given attributes (of one source) to a CSV matching the import
// template. Fetches each attribute's detail so approved values / rules are
// included. Exported by name so the page can wire it to an Export button.
export async function exportAttributes(source, attrs) {
  const meta = SOURCE_META[source];
  if (!meta || !attrs.length) return;
  const details = await Promise.all(attrs.map((a) => appClient.attributes.get(a.id).catch(() => a)));
  const cell = (d, col) => {
    if (col === "values") {
      return (d.values || [])
        .filter((v) => v.is_approved && !v.merged_into)
        .map((v) => v.display_label || v.value)
        .join("; ");
    }
    if (col === "rules") return d.rule ? JSON.stringify(d.rule) : "";
    return d[col] ?? "";
  };
  const header = meta.columns.join(",");
  const body = details.map((d) => meta.columns.map((c) => csvEscape(cell(d, c))).join(",")).join("\n");
  downloadCsv(`${source}-attributes.csv`, `${header}\n${body}\n`);
}

export default function AttributeImportDialog({ open, source, attrs = [], onClose, onImported }) {
  const meta = SOURCE_META[source] || SOURCE_META.web_content;
  const [mode, setMode] = useState("import");
  const [file, setFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [results, setResults] = useState(null);
  const fileRef = useRef(null);

  const reset = () => { setMode("import"); setFile(null); setImporting(false); setExporting(false); setResults(null); };
  const close = () => { reset(); onClose(); };

  const handleTemplate = () => {
    downloadCsv(`${source}-attributes-template.csv`, `${meta.columns.join(",")}\n${meta.example.map(csvEscape).join(",")}\n`);
  };

  const handleExport = async () => {
    if (!attrs.length) { toast.error("No attributes to export."); return; }
    setExporting(true);
    try {
      await exportAttributes(source, attrs);
      toast.success(`Exported ${attrs.length} ${meta.label} attribute${attrs.length === 1 ? "" : "s"}`);
    } catch {
      toast.error("Export failed.");
    }
    setExporting(false);
  };

  const handleImport = async () => {
    if (!file) return;
    setImporting(true);
    try {
      const matrix = parseCsv(await file.text());
      if (matrix.length < 2) { toast.error("File has no data rows."); setImporting(false); return; }
      const header = matrix[0].map((h) => h.trim().toLowerCase());
      if (!header.includes("name")) { toast.error("Missing required column: name"); setImporting(false); return; }

      const rows = matrix.slice(1).map((cells) => {
        const obj = {};
        header.forEach((h, i) => { obj[h] = (cells[i] ?? "").trim(); });
        return obj;
      });

      const taken = new Set(attrs.map((a) => (a.name || "").toLowerCase()));
      let created = 0, skipped = 0;
      const errors = [];
      for (const row of rows) {
        if (!row.name) { skipped++; errors.push({ name: "(blank)", reason: "Missing name" }); continue; }
        if (taken.has(row.name.toLowerCase())) { skipped++; errors.push({ name: row.name, reason: "Name already exists" }); continue; }
        const built = buildPayload(source, row);
        if (built.error) { skipped++; errors.push({ name: row.name, reason: built.error }); continue; }
        try {
          await appClient.attributes.create(built.data);
          created++;
          taken.add(row.name.toLowerCase());
        } catch (e) {
          skipped++;
          errors.push({ name: row.name, reason: e.message || "Create failed" });
        }
      }
      onImported?.();
      setResults({ created, skipped, errors });
    } catch {
      toast.error("Failed to read file. Make sure it's a valid CSV.");
    }
    setImporting(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) close(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle className="font-heading">Import / Export {meta.label} Attributes</DialogTitle></DialogHeader>

        {!results && (
          <div className="flex gap-0.5 p-0.5 bg-secondary/40 rounded-lg">
            {[["import", "Import"], ["export", "Export"]].map(([k, label]) => (
              <button key={k} onClick={() => setMode(k)}
                className={`flex-1 h-8 text-xs font-medium rounded-md transition-colors ${mode === k ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                {label}
              </button>
            ))}
          </div>
        )}

        {mode === "export" && !results ? (
          <div className="space-y-4 mt-1">
            <div className="rounded-md border border-border bg-secondary/20 p-4 space-y-2">
              <p className="text-xs font-semibold flex items-center gap-1.5"><Download className="w-3.5 h-3.5" /> Export to CSV</p>
              <p className="text-[11px] text-muted-foreground">
                Download all <strong>{attrs.length}</strong> {meta.label} attribute{attrs.length === 1 ? "" : "s"} - with their {source === "rule" ? "rule definitions" : "approved values"} - as a CSV. The file matches the import template, so you can edit it and import it back.
              </p>
            </div>
            <Button className="w-full gap-1.5" disabled={!attrs.length || exporting} onClick={handleExport}>
              {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              {exporting ? "Exporting…" : `Export ${attrs.length} Attribute${attrs.length === 1 ? "" : "s"}`}
            </Button>
          </div>
        ) : (
        <div className="space-y-4 mt-1">
          {!results ? (
            <>
              <div className="rounded-md border border-border bg-secondary/20 p-4 space-y-2">
                <p className="text-xs font-semibold flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" /> Step 1 - Download the template</p>
                <p className="text-[11px] text-muted-foreground">{meta.hint} Rows with a duplicate name are skipped.</p>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={handleTemplate}>
                  <FileDown className="w-3.5 h-3.5" /> Download Template CSV
                </Button>
              </div>
              <div className="space-y-2">
                <p className="text-xs font-semibold flex items-center gap-1.5"><Upload className="w-3.5 h-3.5" /> Step 2 - Upload your filled CSV</p>
                <div
                  className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-foreground/40 transition-colors"
                  onClick={() => fileRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setFile(f); }}
                >
                  <input ref={fileRef} type="file" accept=".csv" className="hidden"
                    onChange={(e) => { setFile(e.target.files[0] || null); e.target.value = ""; }} />
                  {file ? (
                    <div className="flex items-center justify-center gap-2 text-sm">
                      <FileText className="w-4 h-4 text-foreground" />
                      <span className="font-medium">{file.name}</span>
                      <button onClick={(e) => { e.stopPropagation(); setFile(null); }} className="text-muted-foreground hover:text-foreground">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="text-muted-foreground text-xs">
                      <Upload className="w-5 h-5 mx-auto mb-1 opacity-40" />
                      Click to select CSV or drag and drop
                    </div>
                  )}
                </div>
              </div>
              <Button className="w-full gap-1.5" disabled={!file || importing} onClick={handleImport}>
                {importing ? "Importing…" : <><Upload className="w-3.5 h-3.5" /> Import {meta.label} Attributes</>}
              </Button>
            </>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-foreground" />
                <span className="font-medium text-sm">Import complete</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-md border border-border bg-secondary/30 p-3 text-center">
                  <p className="text-2xl font-bold">{results.created}</p>
                  <p className="text-[11px] text-muted-foreground">Attributes imported</p>
                </div>
                <div className="rounded-md border border-border bg-secondary/30 p-3 text-center">
                  <p className="text-2xl font-bold">{results.skipped}</p>
                  <p className="text-[11px] text-muted-foreground">Skipped</p>
                </div>
              </div>
              {results.errors?.length > 0 && (
                <div className="rounded-md border border-border bg-secondary/20 p-3 space-y-1 max-h-40 overflow-auto">
                  <p className="text-[11px] font-semibold flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" /> Skipped rows</p>
                  {results.errors.map((e, i) => (
                    <p key={i} className="text-[11px] text-muted-foreground">{e.name}: {e.reason}</p>
                  ))}
                </div>
              )}
              <Button className="w-full" onClick={close}>Done</Button>
            </div>
          )}
        </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
