import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, Eye, Code2 } from "lucide-react";
import EmailBuilder, { blocksToHtml, DEFAULT_EMAIL_CONTAINER } from "./EmailBuilder";
import { toast } from "sonner";

const DEFAULT_BLOCKS = [
  { id: "h1", type: "header", config: { title: "Hi {{first_name}},", subtitle: "", bgColor: "#ffffff", color: "#111111", subtitleColor: "#6b7280", align: "left", fontSize: 26, padding: 24 } },
  { id: "t1", type: "text", config: { content: "Your message here. Keep it conversational and focused on one clear action.", color: "#374151", fontSize: 15, lineHeight: 1.6, padding: 16 } },
  { id: "b1", type: "button", config: { text: "Click here", url: "https://", bgColor: "#2563eb", color: "#ffffff", align: "center", fontSize: 14, paddingV: 12, paddingH: 28, radius: 6, padding: 16 } },
  { id: "t2", type: "text", config: { content: "You're receiving this because you opted in to our communications.", color: "#9ca3af", fontSize: 13, lineHeight: 1.5, padding: 16 } },
];

export default function TemplateEditor({ open, onClose, onSave, onUseTemplate, initial = null }) {
  const isEdit = !!initial?.id;
  const [name, setName] = useState("New Template");
  const [subject, setSubject] = useState("");
  const [status, setStatus] = useState("draft");
  const [blocks, setBlocks] = useState(DEFAULT_BLOCKS);
  const [container, setContainer] = useState(DEFAULT_EMAIL_CONTAINER);
  const [htmlMode, setHtmlMode] = useState(false);
  const [rawHtml, setRawHtml] = useState("");
  const [saving, setSaving] = useState(false);
  // "build" | "preview"
  const [viewMode, setViewMode] = useState("build");

  useEffect(() => {
    if (!open) return;
    if (initial) {
      const vars = initial.variables || {};
      const hasBlocks = Array.isArray(vars._blocks) && vars._blocks.length > 0;
      setName(initial.name || "Template");
      setSubject(initial.subject || "");
      setStatus(initial.status || "draft");
      setBlocks(hasBlocks ? vars._blocks : DEFAULT_BLOCKS);
      setContainer({ ...DEFAULT_EMAIL_CONTAINER, ...(vars._container || {}) });
      // Open in HTML mode when the template is raw HTML or has saved HTML but no
      // block data, so the editor shows its real content (matching the preview)
      // instead of falling back to the default blocks.
      setHtmlMode(vars._html_mode || (!hasBlocks && !!initial.html_body));
      setRawHtml(initial.html_body || "");
    } else {
      setName("New Template");
      setSubject("");
      setStatus("draft");
      setBlocks(DEFAULT_BLOCKS);
      setContainer(DEFAULT_EMAIL_CONTAINER);
      setHtmlMode(false);
      setRawHtml("");
    }
    setViewMode("build");
  }, [initial, open]);

  const handleSave = async (saveStatus = status) => {
    if (!name.trim()) return toast.error("Template name is required");
    if (!subject.trim()) return toast.error("Subject line is required");
    setSaving(true);
    try {
      const html_body = htmlMode ? rawHtml : blocksToHtml(blocks, true, container);
      await onSave({
        name: name.trim(),
        subject: subject.trim(),
        html_body,
        variables: { _blocks: blocks, _container: container, _html_mode: htmlMode },
        status: saveStatus,
      });
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleUseTemplate = async () => {
    // Save first if it has unsaved changes, then open as a new campaign pre-filled
    const html_body = htmlMode ? rawHtml : blocksToHtml(blocks, true, container);
    if (onUseTemplate) {
      onUseTemplate({
        name: name.trim(),
        subject: subject.trim(),
        html_body,
        blocks,
        container,
        htmlMode,
      });
    }
  };

  const currentHtml = htmlMode ? rawHtml : blocksToHtml(blocks, true, container);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent
        className="w-[96vw] max-w-6xl h-[92vh] p-0 flex flex-col overflow-hidden gap-0"
        aria-describedby={undefined}
        hideClose
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
          <div className="ml-auto flex items-center gap-2">
            {/* Status badge inline with actions */}
            <Badge
              variant="outline"
              className={`text-[11px] flex-shrink-0 cursor-pointer capitalize ${
                status === "published"
                  ? "border-foreground text-foreground"
                  : "text-muted-foreground"
              }`}
              onClick={() => setStatus(s => s === "published" ? "draft" : "published")}
              title="Click to toggle Draft / Published"
            >
              {status}
            </Badge>
            {/* Build / Preview toggle */}
            <div className="flex items-center border border-border rounded-md overflow-hidden">
              <button
                onClick={() => setViewMode("build")}
                className={`h-8 px-3 text-xs flex items-center gap-1.5 transition-colors ${
                  viewMode === "build"
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Code2 className="w-3.5 h-3.5" /> Build
              </button>
              <button
                onClick={() => setViewMode("preview")}
                className={`h-8 px-3 text-xs flex items-center gap-1.5 transition-colors border-l border-border ${
                  viewMode === "preview"
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Eye className="w-3.5 h-3.5" /> Preview
              </button>
            </div>
            {onUseTemplate && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={handleUseTemplate}
                disabled={saving}
              >
                Use Template
              </Button>
            )}
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" className="h-8 text-xs" onClick={() => handleSave()} disabled={saving}>
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
              <p className="text-[11px] text-muted-foreground flex items-center gap-1 flex-shrink-0 pb-0.5">
                <AlertCircle className="w-3 h-3" /> Over 50 chars
              </p>
            )}
            <p className="text-[11px] text-muted-foreground flex-shrink-0 pb-1">
              Pre-filled when applying to a campaign
            </p>
          </div>
        </div>

        {/* Build view */}
        {viewMode === "build" && (
          <div className="flex-1 min-h-0 p-3">
            <EmailBuilder
              blocks={blocks}
              onChange={setBlocks}
              container={container}
              onContainerChange={setContainer}
              htmlMode={htmlMode}
              onHtmlModeChange={setHtmlMode}
              rawHtml={rawHtml}
              onRawHtmlChange={setRawHtml}
            />
          </div>
        )}

        {/* Preview view - full-width, centred email rendering */}
        {viewMode === "preview" && (
          <div className="flex-1 min-h-0 overflow-auto bg-secondary/10">
            <div className="min-h-full flex flex-col items-center py-8 px-4">
              <div className="w-full max-w-[650px]">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-sm font-medium">{name || "Untitled"}</p>
                    {subject && <p className="text-xs text-muted-foreground mt-0.5">Subject: {subject}</p>}
                  </div>
                  <span className="text-[11px] text-muted-foreground bg-background border border-border rounded px-2 py-1">
                    Desktop - 650px
                  </span>
                </div>
                <div className="rounded-xl overflow-hidden border border-border shadow-md bg-white">
                  <iframe
                    srcDoc={currentHtml || "<p style='font-family:sans-serif;color:#aaa;padding:32px;text-align:center'>No content yet - switch to Build and add blocks.</p>"}
                    className="w-full"
                    style={{ height: "700px", display: "block" }}
                    title="Template preview"
                    sandbox="allow-same-origin"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground text-center mt-3">
                  This is how your email will look when rendered. Personalisation tokens will be replaced with real values on send.
                </p>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
