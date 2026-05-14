import { useState } from "react";
import { appClient } from "@/api/appClient";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import {
  FileText, MoreHorizontal, Trash2, Download, Pencil, Clock, Plus, Sparkles, Loader2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ReactMarkdown from "react-markdown";
import { format } from "date-fns";
import { toast } from "sonner";

const SCHEDULE_OPTIONS = [
  { value: "", label: "No schedule" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

function ReportExplainer({ report }) {
  const [open, setOpen] = useState(false);
  const [explanation, setExplanation] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleExplain = async () => {
    setOpen(true);
    if (explanation) return;
    setLoading(true);
    const prompt = `You are a senior data analyst. Summarise this report for a business stakeholder in 3-5 bullet points. Focus on the key findings, trends, and recommended actions. Be concise and business-focused.

Report title: "${report.title}"
Content:
${(report.content || "").slice(0, 2000)}`;
    const result = await appClient.integrations.Core.InvokeLLM({ prompt });
    setExplanation(result);
    setLoading(false);
  };

  return (
    <div className="relative">
      <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={handleExplain}>
        <Sparkles className="w-3 h-3" /> AI Summary
      </Button>
      {open && (
        <div className="absolute right-0 top-8 z-50 w-80 bg-popover border border-border rounded-lg shadow-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold">AI Summary</span>
            </div>
            <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground text-xs">✕</button>
          </div>
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Summarising report...
            </div>
          ) : (
            <p className="text-xs leading-relaxed whitespace-pre-wrap">{explanation}</p>
          )}
        </div>
      )}
    </div>
  );
}

function EditReportDialog({ report, onClose, onSave, isPending }) {
  const [title, setTitle] = useState(report?.title || "");
  const [content, setContent] = useState(report?.content || "");
  const [tags, setTags] = useState((report?.tags || []).join(", "));
  const [schedule, setSchedule] = useState(report?.schedule || "");

  return (
    <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
      <DialogHeader><DialogTitle className="font-heading">{report?.id ? "Edit Report" : "New Report"}</DialogTitle></DialogHeader>
      <div className="flex flex-col gap-4 flex-1 overflow-auto mt-2">
        <div>
          <Label className="text-xs">Title</Label>
          <Input value={title} onChange={e => setTitle(e.target.value)} className="mt-1" placeholder="Report title" />
        </div>
        <div>
          <Label className="text-xs">Tags (comma-separated)</Label>
          <Input value={tags} onChange={e => setTags(e.target.value)} className="mt-1" placeholder="marketing, weekly, utm" />
        </div>
        <div>
          <Label className="text-xs">Schedule</Label>
          <Select value={schedule} onValueChange={setSchedule}>
            <SelectTrigger className="mt-1"><SelectValue placeholder="No schedule" /></SelectTrigger>
            <SelectContent>
              {SCHEDULE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1">
          <Label className="text-xs">Content (Markdown)</Label>
          <Textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            className="mt-1 font-mono text-xs"
            rows={14}
            placeholder="# Report Title&#10;&#10;Write your report content in markdown..."
          />
        </div>
        <Button
          onClick={() => onSave({ title, content, tags: tags.split(",").map(t => t.trim()).filter(Boolean), schedule })}
          disabled={!title || isPending}
          className="w-full"
        >
          {isPending ? "Saving..." : "Save Report"}
        </Button>
      </div>
    </DialogContent>
  );
}

export default function ReportFolder({ reports, isLoading }) {
  const queryClient = useQueryClient();
  const [viewReport, setViewReport] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);

  const createMutation = useMutation({
    mutationFn: (data) => appClient.entities.SavedReport.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["reports"] }); setCreateOpen(false); toast.success("Report created"); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => appClient.entities.SavedReport.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["reports"] }),
  });

  const handleDownload = (report) => {
    const blob = new Blob([report.content || ""], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${report.title.replace(/\s+/g, "-").toLowerCase()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSaveNew = (data) => createMutation.mutate(data);

  // Group by schedule
  const scheduled = reports.filter(r => r.schedule);
  const unscheduled = reports.filter(r => !r.schedule);

  const renderGroup = (title, items) => {
    if (!items.length) return null;
    return (
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          {title === "Scheduled" ? <Clock className="w-3.5 h-3.5 text-muted-foreground" /> : <FileText className="w-3.5 h-3.5 text-muted-foreground" />}
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title} · {items.length}</span>
        </div>
        <div className="space-y-2">
          {items.map(report => (
            <div
              key={report.id}
              className="border border-border rounded-lg p-4 hover:shadow-sm transition-shadow cursor-pointer group"
              onClick={() => setViewReport(report)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h3 className="text-sm font-semibold truncate">{report.title}</h3>
                    {report.schedule && (
                      <Badge variant="secondary" className="text-[10px] h-5 gap-1 flex-shrink-0">
                        <Clock className="w-2.5 h-2.5" /> {report.schedule}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] text-muted-foreground">{format(new Date(report.created_date), "MMM d, yyyy")}</span>
                    {report.tags?.map(tag => (
                      <Badge key={tag} variant="secondary" className="text-[10px] h-5">{tag}</Badge>
                    ))}
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0 opacity-0 group-hover:opacity-100" onClick={e => e.stopPropagation()}>
                      <MoreHorizontal className="w-3.5 h-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={e => { e.stopPropagation(); handleDownload(report); }}>
                      <Download className="w-3.5 h-3.5 mr-2" /> Download
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={e => { e.stopPropagation(); deleteMutation.mutate(report.id); }} className="text-destructive">
                      <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full overflow-auto px-6 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-shrink-0">
        <div>
          <h2 className="font-heading text-lg font-semibold">Reports Folder</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Save, organise, and schedule your reports.</p>
        </div>
        <Button size="sm" className="gap-1.5 h-8 text-xs" onClick={() => setCreateOpen(true)}>
          <Plus className="w-3.5 h-3.5" /> New Report
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-16 bg-secondary animate-pulse rounded-lg" />)}</div>
      ) : reports.length === 0 ? (
        <div className="border border-dashed border-border rounded-lg p-10 text-center">
          <FileText className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm font-medium mb-1">No reports yet</p>
          <p className="text-xs text-muted-foreground">Use the AI assistant to generate reports, then save them here.</p>
        </div>
      ) : (
        <>
          {renderGroup("Scheduled", scheduled)}
          {renderGroup("All Reports", unscheduled)}
        </>
      )}

      {/* View Dialog */}
      <Dialog open={!!viewReport} onOpenChange={() => setViewReport(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <div className="flex items-start justify-between gap-4">
              <DialogTitle className="font-heading">{viewReport?.title}</DialogTitle>
              <div className="flex items-center gap-2 flex-shrink-0">
                {viewReport && <ReportExplainer report={viewReport} />}
              </div>
            </div>
          </DialogHeader>
          <div className="flex-1 overflow-auto prose prose-sm prose-neutral max-w-none mt-2">
            <ReactMarkdown>{viewReport?.content || "No content"}</ReactMarkdown>
          </div>
        </DialogContent>
      </Dialog>

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <EditReportDialog report={{}} onClose={() => setCreateOpen(false)} onSave={handleSaveNew} isPending={createMutation.isPending} />
      </Dialog>

    </div>
  );
}
