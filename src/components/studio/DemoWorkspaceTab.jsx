import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { appClient } from "@/api/appClient";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Sparkles, RefreshCw, Trash2, CheckCircle2, Circle } from "lucide-react";
import { fmtDate, fmtRelative } from "./helpers.jsx";

const COUNT_LABELS = [
  ["customers", "Customer profiles"],
  ["anonymous", "Anonymous visitors"],
  ["segments", "Segments"],
  ["campaigns", "UTM campaigns"],
  ["edm_campaigns", "Email campaigns"],
  ["popups", "Pop-ups"],
  ["attributes", "Attributes"],
  ["pinned_charts", "Dashboard charts"],
];

// Manage the single shared, read-only DEMO workspace. It's injected into every
// user's workspace switcher, is read-only everywhere except the AI analyst chat,
// and can only be provisioned / reseeded / deleted here. Seeding runs
// scripts/seed_demo.cjs on the server and may take a little while.
export default function DemoWorkspaceTab() {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "demo-workspace"],
    queryFn: () => appClient.admin.getDemoWorkspace(),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin", "demo-workspace"] });

  const provision = useMutation({
    mutationFn: () => appClient.admin.provisionDemoWorkspace(),
    onSuccess: () => { toast.success("Demo workspace provisioned"); invalidate(); },
    onError: (e) => toast.error(e.message || "Failed to provision demo workspace"),
  });
  const reseed = useMutation({
    mutationFn: () => appClient.admin.reseedDemoWorkspace(),
    onSuccess: () => { toast.success("Demo workspace reseeded with fresh mock data"); invalidate(); },
    onError: (e) => toast.error(e.message || "Failed to reseed demo workspace"),
  });
  const remove = useMutation({
    mutationFn: () => appClient.admin.deleteDemoWorkspace(),
    onSuccess: () => { toast.success("Demo workspace deleted"); setConfirm(""); invalidate(); },
    onError: (e) => toast.error(e.message || "Failed to delete demo workspace"),
  });

  const busy = provision.isPending || reseed.isPending || remove.isPending;
  const exists = data?.exists;
  const ws = data?.workspace;
  const counts = data?.counts || {};

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="w-4 h-4" /> Demo workspace
        </h3>
        <p className="text-sm text-muted-foreground max-w-2xl">
          A single shared, fully-mocked workspace that appears in every user's workspace
          switcher. It's read-only everywhere except the AI analyst chat - users can explore
          every page and chat with the analyst, but can't connect data, import, or create
          anything. It exists only here: users can never delete it.
        </p>
      </section>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !exists ? (
        <section className="border border-border rounded-lg p-6 space-y-4">
          <div className="flex items-center gap-2 text-sm">
            <Circle className="w-4 h-4 text-muted-foreground" />
            <span className="text-muted-foreground">No demo workspace exists yet.</span>
          </div>
          <Button onClick={() => provision.mutate()} disabled={busy} className="h-9">
            <Sparkles className="w-4 h-4 mr-1.5" />
            {provision.isPending ? "Provisioning…" : "Provision demo workspace"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Creates the workspace and fills every page with realistic retail / e-commerce
            sample data. This can take up to a minute.
          </p>
        </section>
      ) : (
        <>
          {/* Status + counts */}
          <section className="border border-border rounded-lg p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" /> {ws?.name || "Demo workspace"}
              </div>
              <span className="text-xs text-muted-foreground">
                Created {ws?.created_date ? fmtDate(ws.created_date) : "-"} · updated {ws?.updated_date ? fmtRelative(ws.updated_date) : "-"}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {COUNT_LABELS.map(([key, label]) => (
                <div key={key} className="border border-border rounded-md p-3">
                  <p className="text-xl font-semibold tabular-nums">{Number(counts[key] ?? 0)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Reseed */}
          <section className="space-y-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold"><RefreshCw className="w-4 h-4" /> Refresh mock data</h3>
            <p className="text-xs text-muted-foreground max-w-2xl">
              Wipes the demo's data and regenerates it. The workspace keeps the same id, so
              users' saved selection stays valid.
            </p>
            <Button variant="outline" onClick={() => reseed.mutate()} disabled={busy} className="h-9">
              <RefreshCw className={`w-4 h-4 mr-1.5 ${reseed.isPending ? "animate-spin" : ""}`} />
              {reseed.isPending ? "Reseeding…" : "Reseed demo data"}
            </Button>
          </section>

          {/* Danger zone */}
          <section className="space-y-3 border border-destructive/40 rounded-lg p-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-destructive">
              <Trash2 className="w-4 h-4" /> Delete demo workspace
            </h3>
            <p className="text-xs text-muted-foreground max-w-2xl">
              Permanently removes the demo workspace and all its mock data for everyone. Type
              <span className="font-mono font-semibold"> DELETE </span> to confirm.
            </p>
            <div className="flex items-center gap-2 max-w-sm">
              <Input value={confirm} onChange={(e) => setConfirm(e.target.value)}
                placeholder="DELETE" className="h-9" />
              <Button variant="destructive" className="h-9 whitespace-nowrap"
                disabled={busy || confirm !== "DELETE"}
                onClick={() => remove.mutate()}>
                {remove.isPending ? "Deleting…" : "Delete"}
              </Button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
