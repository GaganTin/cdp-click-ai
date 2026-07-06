import { useState, useRef } from "react";
import { appClient } from "@/api/appClient";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Upload, FileDown, FileText, AlertCircle, CheckCircle2, X } from "lucide-react";
import { toast } from "sonner";
import { buildUTMUrl } from "../campaigns/UTMForm";
import { useRole } from "@/lib/useRole";

// Import UTM links from a CSV template. Extracted from the Campaigns page so the
// same flow can be reused on the central Import Data page. Parsing happens
// client-side, then each row is created via appClient.entities.Campaign.create.

function downloadTemplate() {
  const header = "name,base_url,utm_source,utm_medium,utm_campaign,utm_term,utm_content,status";
  const example = "Summer Sale 2024,https://yoursite.com/landing,google,cpc,summer-sale-2024,running+shoes,logolink,draft";
  const blob = new Blob([`${header}\n${example}\n`], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = "utm-import-template.csv";
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}

export default function UTMImportDialog({ open, onClose, existingCampaigns = [], onImported }) {
  const [file, setFile] = useState(null);
  const [results, setResults] = useState(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef(null);
  const queryClient = useQueryClient();
  // Viewers are read-only and can't import.
  const { canWrite } = useRole();

  const reset = () => { setFile(null); setResults(null); setImporting(false); };
  const close = () => { reset(); onClose?.(); };

  const handleImport = async () => {
    if (!file) return;
    if (!canWrite) { toast.error("Viewers have read-only access and can't import data."); return; }
    setImporting(true);
    try {
      const text = await file.text();
      const lines = text.trim().split("\n");
      if (lines.length < 2) { toast.error("File has no data rows."); setImporting(false); return; }

      const rawHeader = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
      const REQUIRED = ["name", "base_url"];
      const missing = REQUIRED.filter((r) => !rawHeader.includes(r));
      if (missing.length) { toast.error(`Missing required columns: ${missing.join(", ")}`); setImporting(false); return; }

      const rows = lines.slice(1).map((line) => {
        const vals = line.match(/(".*?"|[^,]+|(?<=,)(?=,)|(?<=,)$|^(?=,))/g) || line.split(",");
        const obj = {};
        rawHeader.forEach((h, i) => { obj[h] = (vals[i] || "").trim().replace(/^"|"$/g, ""); });
        return obj;
      });

      const taken = new Set(existingCampaigns.map((c) => (c.name || "").toLowerCase()));
      let created = 0, skipped = 0;
      const errors = [];
      for (const row of rows) {
        if (!row.name) { skipped++; errors.push({ name: "(blank)", reason: "Missing name" }); continue; }
        if (taken.has(row.name.toLowerCase())) { skipped++; errors.push({ name: row.name, reason: "Name already exists" }); continue; }
        const form = {
          name: row.name,
          base_url: row.base_url || "",
          utm_source: row.utm_source || "",
          utm_medium: row.utm_medium || "",
          utm_campaign: row.utm_campaign || row.name,
          utm_term: row.utm_term || "",
          utm_content: row.utm_content || "",
          status: ["draft", "active", "paused", "completed", "archived"].includes(row.status) ? row.status : "draft",
        };
        const full_utm_url = buildUTMUrl(form);
        try {
          await appClient.entities.Campaign.create({ ...form, full_utm_url });
          created++;
          taken.add(row.name.toLowerCase());
        } catch {
          skipped++;
          errors.push({ name: row.name, reason: "Create failed" });
        }
      }
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      setResults({ created, skipped, errors });
      onImported?.({ created, skipped, errors });
    } catch {
      toast.error("Failed to read file. Make sure it's a valid CSV.");
    }
    setImporting(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) close(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle className="font-heading">Import UTM Links</DialogTitle></DialogHeader>
        <div className="space-y-4 mt-1">
          {!results ? (
            <>
              <div className="rounded-md border border-border bg-secondary/20 p-4 space-y-2">
                <p className="text-xs font-semibold flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" /> Step 1 - Download the template</p>
                <p className="text-[11px] text-muted-foreground">Fill in your UTM links using the CSV template. <strong>name</strong> and <strong>base_url</strong> are required. Rows with duplicate names will be skipped.</p>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={downloadTemplate}>
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
                {importing ? "Importing…" : <><Upload className="w-3.5 h-3.5" /> Import UTM Links</>}
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
                  <p className="text-[11px] text-muted-foreground">Links imported</p>
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
      </DialogContent>
    </Dialog>
  );
}
