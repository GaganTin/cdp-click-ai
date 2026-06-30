import { useState, useEffect, useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { appClient } from "@/api/appClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const EMPTY = { name: "", base_url: "", utm_source: "", utm_medium: "", utm_campaign: "", utm_term: "", utm_content: "", status: "draft" };

// Single-value input with a suggestion dropdown (native datalist): users pick a
// known value or type a brand-new one. utm_source / utm_medium each take ONE
// value, so this replaces the old free-text input whose "google, newsletter"
// placeholder misleadingly implied multiple comma-separated values were allowed.
function ComboInput({ value, onChange, placeholder, options }) {
  const listId = useId();
  return (
    <>
      <Input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        list={listId} autoComplete="off" className="mt-1" />
      <datalist id={listId}>
        {options.map(o => <option key={o} value={o} />)}
      </datalist>
    </>
  );
}

const uniqSort = (...lists) =>
  [...new Set(lists.flat().filter(Boolean).map(String))].sort((a, b) => a.localeCompare(b));

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

// Split a stored URL into its protocol and the remainder so the protocol can be
// edited via a dropdown. Anything without a recognised protocol defaults to https://.
function splitUrl(url = "") {
  const m = /^(https?:\/\/)(.*)$/i.exec(url);
  if (m) return { protocol: m[1].toLowerCase(), rest: m[2] };
  return { protocol: "https://", rest: url };
}

export default function UTMForm({ initialValues, onSubmit, isPending, submitLabel = "Save", sourceOptions = [], mediumOptions = [] }) {
  const [form, setForm] = useState(initialValues || EMPTY);
  const initUrl = splitUrl((initialValues || EMPTY).base_url);
  const [protocol, setProtocol] = useState(initUrl.protocol);
  const [urlRest, setUrlRest] = useState(initUrl.rest);
  const wasActive = initialValues?.status && initialValues.status !== "draft";

  // Suggestions: distinct source / medium values previously seen in this
  // workspace's GA data, merged with any already used on CDP UTM links. Falls
  // back gracefully to just the CDP values if GA isn't connected.
  const wide = { start: "20180101" }; // far enough back to cover all GA history
  const { data: gaSources = [] } = useQuery({
    queryKey: ["utm-suggest", "session_source"],
    queryFn: () => appClient.utm.paramValues({ col: "session_source", ...wide }),
    staleTime: 5 * 60 * 1000, retry: false,
  });
  const { data: gaMediums = [] } = useQuery({
    queryKey: ["utm-suggest", "session_medium"],
    queryFn: () => appClient.utm.paramValues({ col: "session_medium", ...wide }),
    staleTime: 5 * 60 * 1000, retry: false,
  });
  const sourceOpts = uniqSort(sourceOptions, gaSources);
  const mediumOpts = uniqSort(mediumOptions, gaMediums);

  useEffect(() => {
    if (initialValues) {
      setForm(initialValues);
      const { protocol: p, rest } = splitUrl(initialValues.base_url);
      setProtocol(p);
      setUrlRest(rest);
    }
  }, [initialValues]);

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  // Keep protocol + remainder in sync and recombine into the full base_url.
  const applyUrl = (proto, rest) => {
    setProtocol(proto);
    setUrlRest(rest);
    set("base_url", rest ? `${proto}${rest}` : "");
  };

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-xs">Campaign Name</Label>
        <Input value={form.name} onChange={e => set("name", e.target.value)} placeholder="Summer Sale 2024" className="mt-1" />
      </div>
      <div>
        <Label className="text-xs">Base URL</Label>
        <div className="mt-1 flex">
          <Select value={protocol} onValueChange={v => applyUrl(v, urlRest)}>
            <SelectTrigger className="w-[104px] flex-shrink-0 rounded-r-none border-r-0 font-mono">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="https://">https://</SelectItem>
              <SelectItem value="http://">http://</SelectItem>
            </SelectContent>
          </Select>
          <Input
            value={urlRest}
            onChange={e => applyUrl(protocol, e.target.value.replace(/^https?:\/\//i, ""))}
            placeholder="yoursite.com/landing"
            className="rounded-l-none"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Source</Label>
          <ComboInput value={form.utm_source} onChange={v => set("utm_source", v)} placeholder="e.g. google" options={sourceOpts} />
        </div>
        <div>
          <Label className="text-xs">Medium</Label>
          <ComboInput value={form.utm_medium} onChange={v => set("utm_medium", v)} placeholder="e.g. cpc" options={mediumOpts} />
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
              {!wasActive && <SelectItem value="draft">Draft</SelectItem>}
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="paused">Paused</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
          {wasActive && (
            <p className="text-[10px] text-muted-foreground mt-1">Only draft campaigns can be edited.</p>
          )}
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