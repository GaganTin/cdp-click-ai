import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { appClient } from "@/api/appClient";
import { fmtRelative } from "./helpers.jsx";

// Ticket enums mirror the app.support_tickets CHECK constraints / route validation.
const STATUSES = ["open", "in_progress", "resolved", "closed"];
const TYPES = ["", "feedback", "bug", "feature_request", "support"];

// Monochrome: unresolved tickets stand out with the filled treatment.
const statusStyle = {
  open:        "bg-foreground text-background",
  in_progress: "bg-foreground text-background",
  resolved:    "bg-secondary text-muted-foreground",
  closed:      "bg-secondary text-muted-foreground",
};
const priorityStyle = {
  urgent: "text-foreground font-semibold",
  high:   "text-foreground",
  normal: "text-muted-foreground",
  low:    "text-muted-foreground",
};

export default function SupportTab() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");

  const { data: tickets, isLoading } = useQuery({
    queryKey: ["admin", "tickets", status, type],
    queryFn: () => appClient.admin.listTickets({ status, type }),
  });

  const update = useMutation({
    mutationFn: ({ id, ...data }) => appClient.admin.updateTicket(id, data),
    onSuccess: () => {
      toast.success("Ticket updated");
      qc.invalidateQueries({ queryKey: ["admin", "tickets"] });
      qc.invalidateQueries({ queryKey: ["admin", "stats"] });
    },
    onError: (e) => toast.error(e.message || "Update failed"),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Support tickets and feedback submitted by clients (open first, last 200).
        </p>
        <div className="flex items-center gap-2">
          <select value={type} onChange={(e) => setType(e.target.value)}
            className="h-9 px-3 border border-input rounded-md bg-background text-sm">
            {TYPES.map((t) => <option key={t} value={t}>{t === "" ? "All types" : t.replace("_", " ")}</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)}
            className="h-9 px-3 border border-input rounded-md bg-background text-sm">
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
          </select>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !tickets?.length ? (
        <p className="text-sm text-muted-foreground border border-border rounded-lg px-4 py-6">No tickets found.</p>
      ) : (
        <div className="space-y-3">
          {tickets.map((t) => (
            <div key={t.id} className="border border-border rounded-lg p-4 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusStyle[t.status] || ""}`}>
                      {t.status.replace("_", " ")}
                    </span>
                    <span className="text-xs text-muted-foreground capitalize">{(t.type || "").replace("_", " ")}</span>
                    <span className={`text-xs font-medium capitalize ${priorityStyle[t.priority] || ""}`}>{t.priority}</span>
                  </div>
                  <p className="font-medium mt-1.5">{t.subject}</p>
                </div>
                <select
                  value={t.status}
                  onChange={(e) => update.mutate({ id: t.id, status: e.target.value })}
                  className="h-8 px-2 border border-input rounded-md bg-background text-xs flex-shrink-0"
                >
                  {STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
                </select>
              </div>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{t.body}</p>
              <div className="text-xs text-muted-foreground pt-1 border-t border-border flex flex-wrap gap-x-3 gap-y-1">
                <span>{t.account_name || "-"}</span>
                <span>·</span>
                <span>{t.user_name || t.user_email || "Unknown user"}</span>
                {t.company_name && <><span>·</span><span>{t.company_name}</span></>}
                <span>·</span>
                <span>{fmtRelative(t.created_date)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
