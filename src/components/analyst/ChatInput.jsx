import { useState, useRef } from "react";
import { Send, Plus, Upload, Check, FileText, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { appClient } from "@/api/appClient";
import { toast } from "sonner";

// Formats the analyst backend can actually read (see server/lib/fileExtract.js).
const ACCEPTED_EXT = [".csv", ".tsv", ".txt", ".json", ".md", ".log", ".xlsx", ".xls", ".docx", ".pdf"];
const ACCEPTED_LABEL = "CSV, TSV, TXT, JSON, MD, Excel, Word (.docx), PDF";
const MAX_FILE_BYTES = 25 * 1024 * 1024;

export default function ChatInput({
  onSend,
  disabled,
  contextSkills = [],
  templateSkills = [],
  activeSkillIds = [],
  onToggleSkill,
}) {
  const [message, setMessage] = useState("");
  const [uploading, setUploading] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  // Files stay attached to the composer until the user sends, so they can add a
  // message alongside them. Each: { name, url }.
  const [attachments, setAttachments] = useState([]);
  const fileRef = useRef(null);
  const textareaRef = useRef(null);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (disabled) return;
    const text = message.trim();
    if (!text && attachments.length === 0) return;
    // The visible message shows each attachment as a plain "[Attached file: name]"
    // label (no URL); the actual file_urls travel separately for the backend reader.
    const attachLines = attachments.map((a) => `[Attached file: ${a.name}]`).join("\n");
    const content = [text, attachLines].filter(Boolean).join("\n\n");
    const fileUrls = attachments.map((a) => a.url);
    const opts = {};
    // Title a file-first new chat after the file rather than an empty string.
    if (!text && attachments.length) opts.chatName = attachments[0].name;
    onSend(content, fileUrls.length ? fileUrls : undefined, opts);
    setMessage("");
    setAttachments([]);
  };

  const removeAttachment = (idx) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Analyst can only read data/document formats. Reject others up front so the
    // user isn't left wondering why the AI ignored their file.
    const ext = "." + (file.name.split(".").pop() || "").toLowerCase();
    if (!ACCEPTED_EXT.includes(ext)) {
      toast.error(`Unsupported file type. Allowed: ${ACCEPTED_LABEL}`);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      toast.error("File is too large (max 25 MB).");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setUploading(true);
    setPopoverOpen(false);
    try {
      const { file_url } = await appClient.integrations.Core.UploadFile({ file });
      // Attach to the composer instead of sending - the user can add a message
      // and then submit. The file goes out with the next send.
      setAttachments((prev) => [...prev, { name: file.name, url: file_url }]);
    } catch (err) {
      // Surface the failure and, crucially, re-enable the + button (previously a
      // failed upload left `uploading` true forever, locking the control).
      toast.error(err.message || "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleTemplateClick = (skill) => {
    setPopoverOpen(false);
    setMessage(skill.content || "");
    setTimeout(() => textareaRef.current?.focus(), 50);
  };

  const hasSkills = contextSkills.length > 0 || templateSkills.length > 0;

  return (
    <form onSubmit={handleSubmit} className="border-t border-border px-4 py-3 flex-shrink-0">
      {(attachments.length > 0 || uploading) && (
        <div className="max-w-3xl mx-auto mb-2 flex flex-wrap items-center gap-1.5">
          {attachments.map((a, i) => (
            <span
              key={`${a.url}-${i}`}
              className="inline-flex items-center gap-1.5 max-w-[240px] rounded-md border border-border bg-secondary/60 pl-2 pr-1 py-1 text-xs"
            >
              <FileText className="w-3 h-3 text-muted-foreground flex-shrink-0" />
              <span className="truncate">{a.name}</span>
              <button
                type="button"
                onClick={() => removeAttachment(i)}
                className="flex-shrink-0 rounded p-0.5 hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                aria-label={`Remove ${a.name}`}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          {uploading && (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/40 px-2 py-1 text-xs text-muted-foreground">
              <Loader2 className="w-3 h-3 animate-spin" /> Uploading…
            </span>
          )}
        </div>
      )}
      <div className="flex items-center gap-2 max-w-3xl mx-auto">
        <input ref={fileRef} type="file" accept={ACCEPTED_EXT.join(",")} className="hidden" onChange={handleFileUpload} />

        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 flex-shrink-0 relative"
              disabled={uploading}
            >
              <Plus className="w-4 h-4" />
              {activeSkillIds.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-foreground text-white text-[8px] flex items-center justify-center font-bold leading-none">
                  {activeSkillIds.length}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent side="top" align="start" className="w-72 p-0 mb-1">
            <div className="divide-y divide-border">

              {/* Upload */}
              <div className="px-3 py-2">
                <button
                  type="button"
                  className="flex items-center gap-2.5 w-full px-2 py-1.5 rounded-md hover:bg-secondary/60 transition-colors text-left"
                  onClick={() => { setPopoverOpen(false); fileRef.current?.click(); }}
                >
                  <Upload className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                  <span className="text-sm">Upload file</span>
                </button>
              </div>

              {/* Skills */}
              {contextSkills.length > 0 && (
                <div className="px-3 py-2 space-y-0.5">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide px-2 pb-1">Skills</p>
                  {contextSkills.map((skill) => {
                    const active = activeSkillIds.includes(skill.id);
                    return (
                      <button
                        key={skill.id}
                        type="button"
                        className={`flex items-center gap-2.5 w-full px-2 py-1.5 rounded-md transition-colors text-left ${active ? "bg-secondary" : "hover:bg-secondary/60"}`}
                        onClick={() => onToggleSkill?.(skill.id)}
                      >
                        <div className={`w-3.5 h-3.5 rounded flex items-center justify-center flex-shrink-0 border ${active ? "bg-foreground border-foreground" : "border-muted-foreground/40"}`}>
                          {active && <Check className="w-2 h-2 text-white" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm leading-none">{skill.name}</p>
                          {skill.description && <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{skill.description}</p>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Templates */}
              {templateSkills.length > 0 && (
                <div className="px-3 py-2 space-y-0.5">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide px-2 pb-1">Templates</p>
                  {templateSkills.map((skill) => (
                    <button
                      key={skill.id}
                      type="button"
                      className="flex items-center gap-2.5 w-full px-2 py-1.5 rounded-md hover:bg-secondary/60 transition-colors text-left"
                      onClick={() => handleTemplateClick(skill)}
                    >
                      <FileText className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm leading-none">{skill.name}</p>
                        {skill.description && <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{skill.description}</p>}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {!hasSkills && (
                <div className="px-5 py-3">
                  <p className="text-xs text-muted-foreground">
                    No skills yet - create skills or templates from the{" "}
                    <strong>Tools</strong> button above.
                  </p>
                </div>
              )}
            </div>
          </PopoverContent>
        </Popover>

        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
            placeholder="Ask about your data, create segments, generate reports..."
            className="w-full resize-none rounded-xl border border-border bg-secondary/50 px-4 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring min-h-[36px] max-h-32"
            rows={1}
            disabled={disabled}
          />
        </div>
        <Button
          type="submit"
          size="icon"
          className="h-9 w-9 rounded-xl flex-shrink-0"
          disabled={(!message.trim() && attachments.length === 0) || disabled}
        >
          <Send className="w-4 h-4" />
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground text-center mt-1.5">
        Meritma Analyst · Connected to your data
      </p>
    </form>
  );
}
