import { useState, useRef } from "react";
import { appClient } from "@/api/appClient";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Upload, Download, FileText, AlertCircle, CheckCircle2, X } from "lucide-react";
import { toast } from "sonner";

// Import orders/transactions from a CSV into the neutral commerce layer. One row
// per line item, grouped server-side by (customer_email, order_ref). Imported
// orders create/attach profiles and feed segments + the AI analyst, exactly like
// synced store data. Mirrors ProfileImportDialog so both flows feel identical.
export default function OrderImportDialog({ open, onClose, onImported }) {
  const [file, setFile] = useState(null);
  const [results, setResults] = useState(null);
  const fileRef = useRef(null);
  const queryClient = useQueryClient();

  const reset = () => { setFile(null); setResults(null); };
  const close = () => { reset(); onClose?.(); };

  const importMutation = useMutation({
    mutationFn: (f) => appClient.commerce.importOrders(f),
    onSuccess: (data) => {
      setResults(data);
      setFile(null);
      queryClient.invalidateQueries({ queryKey: ["profiles-customers"] });
      queryClient.invalidateQueries({ queryKey: ["segments"] });
      onImported?.(data);
    },
    onError: (err) => toast.error(err.message || "Import failed"),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) close(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-heading">Import Orders / Transactions</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          {!results ? (
            <>
              <div className="rounded-md border border-border bg-secondary/20 p-4 space-y-2">
                <p className="text-xs font-semibold flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" /> Step 1 - Download the template</p>
                <p className="text-[11px] text-muted-foreground">One row per <strong>line item</strong>. Rows sharing the same <strong>customer_email</strong> + <strong>order_ref</strong> are grouped into one order. <strong>customer_email</strong>, <strong>order_ref</strong> and <strong>order_date</strong> are required.</p>
                <Button variant="outline" size="sm" className="gap-1.5"
                  onClick={() => appClient.commerce.downloadOrderTemplate()}>
                  <Download className="w-3.5 h-3.5" /> Download Template CSV
                </Button>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-semibold flex items-center gap-1.5"><Upload className="w-3.5 h-3.5" /> Step 2 - Upload your filled template</p>
                <div
                  className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-foreground/40 transition-colors"
                  onClick={() => fileRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setFile(f); }}
                >
                  <input
                    ref={fileRef} type="file" accept=".csv" className="hidden"
                    onChange={(e) => { setFile(e.target.files[0] || null); e.target.value = ""; }}
                  />
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

              <div className="rounded-md border border-border bg-secondary/50 px-3 py-2 text-[11px] text-muted-foreground">
                Customers are matched to existing profiles by email; unmatched orders create a new profile. Re-importing a file updates matching orders instead of duplicating them.
              </div>

              <Button
                className="w-full gap-1.5"
                disabled={!file || importMutation.isPending}
                onClick={() => importMutation.mutate(file)}
              >
                {importMutation.isPending ? "Importing…" : <><Upload className="w-3.5 h-3.5" /> Import Orders</>}
              </Button>
            </>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-foreground" />
                <span className="font-medium text-sm">Import complete</span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-md border border-border bg-secondary/30 p-3 text-center">
                  <p className="text-2xl font-bold">{results.imported}</p>
                  <p className="text-[11px] text-muted-foreground">Orders imported</p>
                </div>
                <div className="rounded-md border border-border bg-secondary/30 p-3 text-center">
                  <p className="text-2xl font-bold">{results.newProfiles ?? 0}</p>
                  <p className="text-[11px] text-muted-foreground">New profiles</p>
                </div>
                <div className="rounded-md border border-border bg-secondary/30 p-3 text-center">
                  <p className="text-2xl font-bold">{results.skipped}</p>
                  <p className="text-[11px] text-muted-foreground">Rows skipped</p>
                </div>
              </div>
              {results.errors?.length > 0 && (
                <div className="rounded-md border border-border bg-secondary/20 p-3 space-y-1 max-h-40 overflow-auto">
                  <p className="text-[11px] font-semibold flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" /> Skipped rows</p>
                  {results.errors.map((e, i) => (
                    <p key={i} className="text-[11px] text-muted-foreground">Row {e.row}: {e.error}</p>
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
