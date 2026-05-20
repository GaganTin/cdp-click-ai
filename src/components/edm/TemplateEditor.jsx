import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AlertCircle } from "lucide-react";
import EmailBuilder, { blocksToHtml } from "./EmailBuilder";
import { toast } from "sonner";

const DEFAULT_BLOCKS = [
  { id: "h1", type: "header", config: { title: "Hi {{first_name}},", subtitle: "", bgColor: "#ffffff", color: "#111111", subtitleColor: "#6b7280", align: "left", fontSize: 26, padding: 24 } },
  { id: "t1", type: "text", config: { content: "Your message here. Keep it conversational and focused on one clear action.", color: "#374151", fontSize: 15, lineHeight: 1.6, padding: 16 } },
  { id: "b1", type: "button", config: { text: "Click here", url: "https://", bgColor: "#2563eb", color: "#ffffff", align: "center", fontSize: 14, paddingV: 12, paddingH: 28, radius: 6, padding: 16 } },
  { id: "t2", type: "text", config: { content: "You're receiving this because you opted in to our communications.", color: "#9ca3af", fontSize: 13, lineHeight: 1.5, padding: 16 } },
];

export default function TemplateEditor({ open, onClose, onSave, initial = null }) {
  const isEdit = !!initial;
  const [name, setName] = useState("New Template");
  const [subject, setSubject] = useState("");
  const [blocks, setBlocks] = useState(DEFAULT_BLOCKS);
  const [htmlMode, setHtmlMode] = useState(false);
  const [rawHtml, setRawHtml] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      const vars = initial.variables || {};
      setName(initial.name || "Template");
      setSubject(initial.subject || "");
      setBlocks(vars._blocks || DEFAULT_BLOCKS);
      setHtmlMode(vars._html_mode || false);
      setRawHtml(initial.html_body || "");
    } else {
      setName("New Template");
      setSubject("");
      setBlocks(DEFAULT_BLOCKS);
      setHtmlMode(false);
      setRawHtml("");
    }
  }, [initial, open]);

  const handleSave = async () => {
    if (!name.trim()) return toast.error("Template name is required");
    if (!subject.trim()) return toast.error("Subject line is required");
    setSaving(true);
    try {
      const html_body = htmlMode ? rawHtml : blocksToHtml(blocks);
      await onSave({
        name: name.trim(),
        subject: subject.trim(),
        html_body,
        variables: { _blocks: blocks, _html_mode: htmlMode },
        status: "active",
      });
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent
        className="w-[96vw] max-w-6xl h-[92vh] p-0 flex flex-col overflow-hidden gap-0"
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">
          {isEdit ? "Edit Template" : "New Email Template"}
        </DialogTitle>

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-border flex-shrink-0">
          <Input
            value={name}
            onChange={e => setName(e.target.value)}
            className="text-base font-semibold border-none shadow-none focus-visible:ring-0 h-8 px-0 max-w-xs bg-transparent"
            placeholder="Template name..."
          />
          <Badge variant="outline" className="text-[11px] flex-shrink-0">Template</Badge>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" className="h-8 text-xs" onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : isEdit ? "Save Changes" : "Save Template"}
            </Button>
          </div>
        </div>

        {/* Subject line bar */}
        <div className="px-5 py-3 border-b border-border flex-shrink-0 bg-secondary/10">
          <div className="max-w-xl flex items-end gap-4">
            <div className="flex-1">
              <Label className="text-[11px] text-muted-foreground mb-1 block">Default Subject Line</Label>
              <Input
                value={subject}
                onChange={e => setSubject(e.target.value)}
                placeholder="e.g. Hi {{first_name}}, something special for you"
                className="h-8 text-sm"
              />
            </div>
            {subject.length > 50 && (
              <p className="text-[11px] text-amber-500 flex items-center gap-1 flex-shrink-0 pb-0.5">
                <AlertCircle className="w-3 h-3" /> Over 50 chars
              </p>
            )}
            <p className="text-[11px] text-muted-foreground flex-shrink-0 pb-1">
              Pre-filled when applying to a campaign
            </p>
          </div>
        </div>

        {/* Email Builder */}
        <div className="flex-1 min-h-0 p-3">
          <EmailBuilder
            blocks={blocks}
            onChange={setBlocks}
            htmlMode={htmlMode}
            onHtmlModeChange={setHtmlMode}
            rawHtml={rawHtml}
            onRawHtmlChange={setRawHtml}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
