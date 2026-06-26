import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { appClient } from "@/api/appClient";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Ban, ShieldOff, X } from "lucide-react";
import { fmtRelative } from "./helpers.jsx";

const REASON_LABELS = {
  account_deleted: "Account deleted",
  admin_blocked: "Blocked by admin",
};

// Manage the email blocklist: emails here can never sign up or sign in, on any
// provider (password, Google, Microsoft). Deleted accounts are added automatically;
// owners can also block/unblock any email directly here.
export default function BlockedEmailsTab() {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");

  const { data: blocked, isLoading } = useQuery({
    queryKey: ["admin", "blocked-emails"],
    queryFn: () => appClient.admin.listBlockedEmails(),
  });

  const block = useMutation({
    mutationFn: (e) => appClient.admin.blockEmail(e),
    onSuccess: (r) => {
      toast.success(`${r.email} is now blocked`);
      setEmail("");
      qc.invalidateQueries({ queryKey: ["admin", "blocked-emails"] });
    },
    onError: (e) => toast.error(e.message || "Failed to block email"),
  });

  const unblock = useMutation({
    mutationFn: (e) => appClient.admin.unblockEmail(e),
    onSuccess: () => {
      toast.success("Email unblocked");
      qc.invalidateQueries({ queryKey: ["admin", "blocked-emails"] });
    },
    onError: (e) => toast.error(e.message || "Failed to unblock email"),
  });

  const list = blocked || [];

  return (
    <div className="space-y-8">
      {/* Block an email */}
      <section className="space-y-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><Ban className="w-4 h-4" /> Block an email</h3>
        <form
          onSubmit={(e) => { e.preventDefault(); if (email.trim()) block.mutate(email.trim()); }}
          className="flex items-center gap-2 max-w-lg"
        >
          <Input type="email" placeholder="name@company.com" value={email}
            onChange={(e) => setEmail(e.target.value)} className="h-9" />
          <Button type="submit" variant="destructive"
            disabled={!email.trim() || block.isPending} className="h-9 whitespace-nowrap">
            {block.isPending ? "Blocking…" : "Block email"}
          </Button>
        </form>
        <p className="text-xs text-muted-foreground">
          A blocked email can never sign up or sign in again, on any provider. Deleted accounts
          are blocked automatically. Remove an email below to allow it again.
        </p>
      </section>

      {/* Blocked list */}
      <section className="space-y-2.5">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <ShieldOff className="w-4 h-4" /> Blocked emails
          {!isLoading && <span className="text-muted-foreground font-normal">({list.length})</span>}
        </h3>
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-secondary/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left font-medium px-4 py-2.5">Email</th>
                <th className="text-left font-medium px-4 py-2.5">Reason</th>
                <th className="text-left font-medium px-4 py-2.5">Blocked</th>
                <th className="text-right font-medium px-4 py-2.5">Unblock</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={4} className="px-4 py-6 text-muted-foreground">Loading…</td></tr>
              ) : !list.length ? (
                <tr><td colSpan={4} className="px-4 py-6 text-muted-foreground">No blocked emails.</td></tr>
              ) : list.map((b) => (
                <tr key={b.email} className="border-t border-border hover:bg-secondary/20">
                  <td className="px-4 py-2.5 font-medium">{b.email}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{REASON_LABELS[b.reason] || b.reason}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{fmtRelative(b.blocked_at)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <button onClick={() => unblock.mutate(b.email)} disabled={unblock.isPending}
                      className="p-1 rounded-md hover:bg-secondary text-muted-foreground disabled:opacity-50"
                      title="Unblock email">
                      <X className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
