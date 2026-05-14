import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const EMPTY = { name: "", base_url: "", utm_source: "", utm_medium: "", utm_campaign: "", utm_term: "", utm_content: "", status: "draft" };

function buildUTMUrl(form) {
  if (!form.base_url) return "";
  const params = new URLSearchParams();
  if (form.utm_source) params.set("utm_source", form.utm_source);
  if (form.utm_medium) params.set("utm_medium", form.utm_medium);
  if (form.utm_campaign) params.set("utm_campaign", form.utm_campaign || form.name);
  if (form.utm_term) params.set("utm_term", form.utm_term);
  if (form.utm_content) params.set("utm_content", form.utm_content);
  return `${form.base_url}${form.base_url.includes("?") ? "&" : "?"}${params.toString()}`;
}

export { buildUTMUrl };

export default function UTMForm({ initialValues, onSubmit, isPending, submitLabel = "Save" }) {
  const [form, setForm] = useState(initialValues || EMPTY);

  useEffect(() => {
    if (initialValues) setForm(initialValues);
  }, [initialValues]);

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-xs">Campaign Name</Label>
        <Input value={form.name} onChange={e => set("name", e.target.value)} placeholder="Summer Sale 2024" className="mt-1" />
      </div>
      <div>
        <Label className="text-xs">Base URL</Label>
        <Input value={form.base_url} onChange={e => set("base_url", e.target.value)} placeholder="https://yoursite.com/landing" className="mt-1" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Source</Label>
          <Input value={form.utm_source} onChange={e => set("utm_source", e.target.value)} placeholder="google, newsletter" className="mt-1" />
        </div>
        <div>
          <Label className="text-xs">Medium</Label>
          <Input value={form.utm_medium} onChange={e => set("utm_medium", e.target.value)} placeholder="cpc, email, social" className="mt-1" />
        </div>
        <div>
          <Label className="text-xs">Campaign Param</Label>
          <Input value={form.utm_campaign} onChange={e => set("utm_campaign", e.target.value)} placeholder="Auto-filled from name" className="mt-1" />
        </div>
        <div>
          <Label className="text-xs">Status</Label>
          <Select value={form.status} onValueChange={v => set("status", v)}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="paused">Paused</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Term (optional)</Label>
          <Input value={form.utm_term} onChange={e => set("utm_term", e.target.value)} placeholder="running+shoes" className="mt-1" />
        </div>
        <div>
          <Label className="text-xs">Content (optional)</Label>
          <Input value={form.utm_content} onChange={e => set("utm_content", e.target.value)} placeholder="logolink, textlink" className="mt-1" />
        </div>
      </div>
      {form.base_url && (
        <div className="bg-secondary rounded-md p-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Generated URL</p>
          <p className="text-xs break-all font-mono">{buildUTMUrl(form)}</p>
        </div>
      )}
      <Button onClick={() => onSubmit(form)} disabled={!form.name || isPending} className="w-full">
        {submitLabel}
      </Button>
    </div>
  );
}