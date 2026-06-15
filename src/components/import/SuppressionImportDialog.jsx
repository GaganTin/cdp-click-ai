import { useState, useRef } from "react";
import { appClient } from "@/api/appClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Upload, FileDown, FileText, CheckCircle2, XCircle, Info, X } from "lucide-react";
import { toast } from "sonner";

// Import emails onto the EDM suppression list from a CSV. Mirrors the "Import
// file" flow in the EDM suppression modal so the same import can be reached from
// the central Import / Export page. Parsing dedupes against the live list, then
// the valid rows are sent via appClient.edm.importSuppression.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function downloadTemplate() {
  const csv = "email,reason\njohn@example.com,manual\njane@example.com,unsubscribed\n";
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "suppression-import-template.csv";
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}

export default function SuppressionImportDialog({ open, onClose, onImported }) {
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState(null); // { valid, duplicates, invalid }
  const [results, setResults] = useState(null); // { added, duplicates, invalid }
  const fileRef = useRef(null);
  const queryClient = useQueryClient();

  const { data: suppressed = [] } = useQuery({
    queryKey: ["edm-suppression"],
    queryFn: () => appClient.edm.listSuppression(),
    enabled: open,
  });

  const reset = () => { setFileName(""); setRows(null); setResults(null); };
  const close = () => { reset(); onClose?.(); };

  // Parse a CSV/TXT file into { valid, duplicates, invalid }. Accepts "email,reason"
  // rows or one email per line; skips a leading header row, dedupes within the file,
  // and skips emails already on the list.
  const parseEmailFile = (text) => {
    const existing = new Set((suppressed || []).map((s) => String(s.email).toLowerCase()));
    const seen = new Set();
    const valid = [], duplicates = [], invalid = [];
    text.split(/\r?\n/).forEach((line, i) => {
      const raw = line.trim();
      if (!raw) return;
      const cols = raw.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
      const email = cols[0].toLowerCase();
      if (i === 0 && (email === "email" || email === "email address")) return; // header
      if (!EMAIL_RE.test(email)) { invalid.push(cols[0]); return; }
      if (existing.has(email) || seen.has(email)) { duplicates.push(email); return; }
      seen.add(email);
      valid.push({ email, reason: (cols[1] || "manual").toLowerCase() });
    });
    return { valid, duplicates, invalid };
  };

  const processFile = async (file) => {
    if (!file) return;
    try {
      const text = await file.text();
      setFileName(file.name);
      setRows(parseEmailFile(text));
    } catch {
      toast.error("Could not read that file");
    }
  };

  const importMutation = useMutation({
    mutationFn: (entries) => appClient.edm.importSuppression(entries),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["edm-suppression"] });
      setResults({
        added: res?.added ?? (rows?.valid.length ?? 0),
        duplicates: rows?.duplicates.length ?? 0,
        invalid: rows?.invalid.length ?? 0,
      });
      onImported?.(res);
    },
    onError: (e) => toast.error(e.message || "Import failed"),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) close(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle className="font-heading">Import Email Suppression List</DialogTitle></DialogHeader>
        <div className="space-y-4 mt-1">
          {!results ? (
            <>
              <div className="rounded-md border border-border bg-secondary/20 p-4 space-y-2">
                <p className="text-xs font-semibold flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" /> Step 1 - Download the template</p>
                <p className="text-[11px] text-muted-foreground">
                  Fill in the emails to suppress using the CSV template. <strong>email</strong> is required; <strong>reason</strong> is optional. Duplicate and already-suppressed emails are skipped automatically.
                </p>
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
                  onDrop={(e) => { e.preventDefault(); processFile(e.dataTransfer.files[0]); }}
                >
                  <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden"
                    onChange={(e) => { processFile(e.target.files[0]); e.target.value = ""; }} />
                  {fileName ? (
                    <div className="flex items-center justify-center gap-2 text-sm">
                      <FileText className="w-4 h-4 text-foreground" />
                      <span className="font-medium">{fileName}</span>
                      <button onClick={(e) => { e.stopPropagation(); setFileName(""); setRows(null); }} className="text-muted-foreground hover:text-foreground">
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

              {rows && (
                <div className="rounded-md border border-border bg-secondary/20 p-3 space-y-1 text-[11px]">
                  <div className="flex items-center gap-1.5 text-foreground">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                    <span className="font-medium">{rows.valid.length}</span> new email{rows.valid.length !== 1 ? "s" : ""} ready to import
                  </div>
                  {rows.duplicates.length > 0 && (
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Info className="w-3.5 h-3.5" /> {rows.duplicates.length} duplicate{rows.duplicates.length !== 1 ? "s" : ""} skipped (already on list or repeated)
                    </div>
                  )}
                  {rows.invalid.length > 0 && (
                    <div className="flex items-center gap-1.5 text-destructive">
                      <XCircle className="w-3.5 h-3.5" /> {rows.invalid.length} invalid email{rows.invalid.length !== 1 ? "s" : ""} skipped
                    </div>
                  )}
                </div>
              )}

              <Button
                className="w-full gap-1.5"
                disabled={!rows?.valid.length || importMutation.isPending}
                onClick={() => rows?.valid.length && importMutation.mutate(rows.valid)}
              >
                {importMutation.isPending
                  ? "Importing…"
                  : <><Upload className="w-3.5 h-3.5" /> Import{rows?.valid.length ? ` ${rows.valid.length}` : ""} Email{rows?.valid.length !== 1 ? "s" : ""}</>}
              </Button>
            </>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-foreground" />
                <span className="font-medium text-sm">Import complete</span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-md border border-border bg-secondary/30 p-3 text-center">
                  <p className="text-2xl font-bold">{results.added}</p>
                  <p className="text-[11px] text-muted-foreground">Imported</p>
                </div>
                <div className="rounded-md border border-border bg-secondary/30 p-3 text-center">
                  <p className="text-2xl font-bold">{results.duplicates}</p>
                  <p className="text-[11px] text-muted-foreground">Duplicates</p>
                </div>
                <div className="rounded-md border border-border bg-secondary/30 p-3 text-center">
                  <p className="text-2xl font-bold">{results.invalid}</p>
                  <p className="text-[11px] text-muted-foreground">Invalid</p>
                </div>
              </div>
              <Button className="w-full" onClick={close}>Done</Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
