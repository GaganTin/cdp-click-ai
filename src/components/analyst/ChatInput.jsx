import { useState, useRef } from "react";
import { Send, Plus, Upload, Check, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { appClient } from "@/api/appClient";

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
  const fileRef = useRef(null);
  const textareaRef = useRef(null);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!message.trim() || disabled) return;
    onSend(message.trim());
    setMessage("");
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setPopoverOpen(false);
    const { file_url } = await appClient.integrations.Core.UploadFile({ file });
    onSend(`[Attached file: ${file.name}](${file_url})`, [file_url]);
    setUploading(false);
    fileRef.current.value = "";
  };

  const handleTemplateClick = (skill) => {
    setPopoverOpen(false);
    setMessage(skill.content || "");
    setTimeout(() => textareaRef.current?.focus(), 50);
  };

  const hasSkills = contextSkills.length > 0 || templateSkills.length > 0;

  return (
    <form onSubmit={handleSubmit} className="border-t border-border px-4 py-3 flex-shrink-0">
      <div className="flex items-center gap-2 max-w-3xl mx-auto">
        <input ref={fileRef} type="file" className="hidden" onChange={handleFileUpload} />

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
          disabled={!message.trim() || disabled}
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
