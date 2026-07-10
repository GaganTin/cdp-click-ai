import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { appClient } from "@/api/appClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toCredits, toTokens } from "@/lib/credits";

// Usage limits shown as editable numbers. Empty = unlimited (null). ai_tokens is
// stored as raw tokens but edited in "credits" (100,000 tokens = 1 credit).
const LIMIT_FIELDS = [
  ["profiles",     "Customer profiles"],
  ["campaigns",    "Emails Sent"],
  ["ai_tokens",    "AI credits"],
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
  // Edit ai_tokens in credit units; the raw token value is restored on save.
  const toEditable = (p) => {
    const limits = { ...(p.limits || {}) };
    if (limits.ai_tokens != null) limits.ai_tokens = toCredits(limits.ai_tokens);
    return { ...p, limits };
  };
  const [form, setForm] = useState(() => toEditable(plan));

  useEffect(() => { setForm(toEditable(plan)); }, [plan]);

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
    for (const [key] of LIMIT_FIELDS) {
      let v = numOrNull(form.limits?.[key]);
      if (key === "ai_tokens" && v != null) v = toTokens(v); // credits -> raw tokens
      limits[key] = v;
    }
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
        <label className="block text-xs font-medium text-muted-foreground mb-2">Usage limits (blank = unlimited; 1 AI credit = 100,000 tokens)</label>
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

// Editable per-model AI rates ($/1M tokens). Costs are frozen on each usage row
// at insert time, so a change here only affects FUTURE usage.
function AiPricingCard({ row }) {
  const qc = useQueryClient();
  const [form, setForm] = useState(row);
  useEffect(() => { setForm(row); }, [row]);

  const save = useMutation({
    mutationFn: (body) => appClient.admin.updateAiPricing(row.model, body),
    onSuccess: () => {
      toast.success(`${row.model} rates saved`);
      qc.invalidateQueries({ queryKey: ["admin", "ai-pricing"] });
    },
    onError: (e) => toast.error(e.message || "Save failed"),
  });

  const dirty =
    String(form.input_per_1m) !== String(row.input_per_1m) ||
    String(form.cached_input_per_1m) !== String(row.cached_input_per_1m) ||
    String(form.output_per_1m) !== String(row.output_per_1m);

  return (
    <div className="border border-border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="font-medium text-sm">{row.model}</span>
        <span className="text-xs text-muted-foreground">{row.currency || "USD"} / 1M tokens</span>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Input ($ / 1M)</label>
          <Input type="number" min="0" step="0.0001" value={form.input_per_1m ?? ""}
            onChange={(e) => setForm({ ...form, input_per_1m: e.target.value })} />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Cached input ($ / 1M)</label>
          <Input type="number" min="0" step="0.0001" value={form.cached_input_per_1m ?? ""}
            onChange={(e) => setForm({ ...form, cached_input_per_1m: e.target.value })} />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Output ($ / 1M)</label>
          <Input type="number" min="0" step="0.0001" value={form.output_per_1m ?? ""}
            onChange={(e) => setForm({ ...form, output_per_1m: e.target.value })} />
        </div>
      </div>
      <Button size="sm" className="w-full" disabled={!dirty || save.isPending}
        onClick={() => save.mutate({ input_per_1m: form.input_per_1m, cached_input_per_1m: form.cached_input_per_1m, output_per_1m: form.output_per_1m })}>
        {save.isPending ? "Saving…" : "Save rates"}
      </Button>
    </div>
  );
}

export default function PlansTab() {
  const { data: plans, isLoading } = useQuery({
    queryKey: ["admin", "plans"],
    queryFn: () => appClient.admin.listPlans(),
  });
  const { data: pricing } = useQuery({
    queryKey: ["admin", "ai-pricing"],
    queryFn: () => appClient.admin.listAiPricing(),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading plans…</p>;

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground mb-4">
          Changes apply live to every account on that plan. Trial length only affects new sign-ups -
          extend an existing client&apos;s trial from their account panel.
        </p>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {(plans || []).map((p) => <PlanCard key={p.id} plan={p} />)}
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="font-heading text-sm font-semibold">AI pricing</h3>
        <p className="text-sm text-muted-foreground">
          Rates used to cost AI usage. New rates apply to future usage only - already-recorded costs stay frozen.
        </p>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {(pricing || []).map((r) => <AiPricingCard key={r.model} row={r} />)}
          {!pricing?.length && <p className="text-sm text-muted-foreground">No AI models priced yet.</p>}
        </div>
      </div>
    </div>
  );
}
