import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { appClient } from "@/api/appClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";

// Usage limits shown as editable numbers. Empty = unlimited (null).
const LIMIT_FIELDS = [
  ["profiles",     "Customer profiles"],
  ["campaigns",    "Email campaigns"],
  ["ai_tokens",    "AI tokens"],
  ["team_members", "Team members"],
  ["workspaces",   "Workspaces"],
];

function numOrNull(v) {
  if (v === "" || v == null) return null;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
}

function PlanCard({ plan }) {
  const qc = useQueryClient();
  const [form, setForm] = useState(plan);

  useEffect(() => { setForm(plan); }, [plan]);

  const save = useMutation({
    mutationFn: (body) => appClient.admin.updatePlan(plan.id, body),
    onSuccess: () => {
      toast.success(`${form.name} plan saved`);
      qc.invalidateQueries({ queryKey: ["admin", "plans"] });
    },
    onError: (e) => toast.error(e.message || "Save failed"),
  });

  const setLimit = (key, v) =>
    setForm((f) => ({ ...f, limits: { ...(f.limits || {}), [key]: v } }));

  const onSave = () => {
    const limits = {};
    for (const [key] of LIMIT_FIELDS) limits[key] = numOrNull(form.limits?.[key]);
    save.mutate({
      name: form.name,
      description: form.description,
      trial_days: numOrNull(form.trial_days),
      warning_days: numOrNull(form.warning_days) ?? 7,
      features: (form.features || []).filter(Boolean),
      limits,
      is_active: form.is_active,
    });
  };

  return (
    <div className="border border-border rounded-lg p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Input
            value={form.name || ""}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="h-8 w-40 font-heading font-semibold"
          />
          <span className="text-xs text-muted-foreground uppercase tracking-wide">{plan.id}</span>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Active</span>
          <Switch checked={!!form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
        </label>
      </div>

      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1">Description</label>
        <Textarea
          value={form.description || ""}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          rows={2}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Free trial (days)</label>
          <Input
            type="number" min="0"
            value={form.trial_days ?? ""}
            placeholder="-"
            onChange={(e) => setForm({ ...form, trial_days: e.target.value })}
          />
          <p className="text-[11px] text-muted-foreground mt-1">
            {form.trial_days ? `${(form.trial_days / 30).toFixed(form.trial_days % 30 ? 1 : 0)} month(s)` : "No trial"}
          </p>
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Expiry warning (days)</label>
          <Input
            type="number" min="0"
            value={form.warning_days ?? ""}
            onChange={(e) => setForm({ ...form, warning_days: e.target.value })}
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-2">Usage limits (blank = unlimited)</label>
        <div className="grid grid-cols-2 gap-3">
          {LIMIT_FIELDS.map(([key, label]) => (
            <div key={key}>
              <label className="block text-xs text-muted-foreground mb-1">{label}</label>
              <Input
                type="number" min="0"
                value={form.limits?.[key] ?? ""}
                placeholder="Unlimited"
                onChange={(e) => setLimit(key, e.target.value)}
              />
            </div>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1">Features (one per line)</label>
        <Textarea
          value={(form.features || []).join("\n")}
          onChange={(e) => setForm({ ...form, features: e.target.value.split("\n") })}
          rows={5}
        />
      </div>

      <Button onClick={onSave} disabled={save.isPending} className="w-full">
        {save.isPending ? "Saving…" : `Save ${plan.id} plan`}
      </Button>
    </div>
  );
}

export default function PlansTab() {
  const { data: plans, isLoading } = useQuery({
    queryKey: ["admin", "plans"],
    queryFn: () => appClient.admin.listPlans(),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading plans…</p>;

  return (
    <div className="space-y-1">
      <p className="text-sm text-muted-foreground mb-4">
        Changes apply live to every account on that plan. Trial length only affects new sign-ups -
        extend an existing client&apos;s trial from their account panel.
      </p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {(plans || []).map((p) => <PlanCard key={p.id} plan={p} />)}
      </div>
    </div>
  );
}
