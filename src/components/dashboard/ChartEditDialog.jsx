import { useState } from "react";
import { appClient } from "@/api/appClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

// Plain edit dialog - lets user rename title/description
export function ChartEditBasicDialog({ chart, onSave, onClose }) {
  const [title, setTitle] = useState(chart.title || "");
  const [description, setDescription] = useState(chart.description || "");

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-heading">Edit Chart</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-1">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">Title</label>
            <Input value={title} onChange={e => setTitle(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1.5">Description</label>
            <Input value={description} onChange={e => setDescription(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={() => onSave({ title, description })}>Save</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// AI edit dialog - user describes what they want changed, AI rewrites the config
export function ChartEditAIDialog({ chart, onSave, onClose }) {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    let currentConfig = {};
    try { currentConfig = JSON.parse(chart.chart_config); } catch {}

    const result = await appClient.integrations.Core.InvokeLLM({
      prompt: `You are a data visualization assistant. The user has a chart with this configuration:
\`\`\`json
${JSON.stringify(currentConfig, null, 2)}
\`\`\`
Chart type: ${chart.chart_type}
Current title: ${chart.title}

The user wants to make this change: "${prompt}"

Return ONLY a valid JSON object with the updated chart configuration. Keep the same structure (data, xKey, series/dataKey fields). You may update the data, add/remove series, change labels, or restructure as requested. Do not include explanation.`,
      response_json_schema: {
        type: "object",
        properties: {
          title: { type: "string" },
          chart_type: { type: "string" },
          description: { type: "string" },
          data: { type: "array", items: { type: "object" } },
          xKey: { type: "string" },
          series: { type: "array", items: { type: "object" } },
          dataKey: { type: "string" },
        },
      },
    });
    setLoading(false);
    onSave({
      title: result.title || chart.title,
      description: result.description || chart.description,
      chart_type: result.chart_type || chart.chart_type,
      chart_config: JSON.stringify(result),
    });
    toast.success("Chart updated with AI");
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center gap-2">
            <Sparkles className="w-4 h-4" /> Edit with AI
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-1">
          <p className="text-xs text-muted-foreground">Describe the changes you want to make to <span className="font-medium text-foreground">"{chart.title}"</span>.</p>
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder="e.g. Change to a line chart, add a trend line, rename the Y axis to Revenue..."
            rows={4}
            className="w-full border border-input rounded-md px-3 py-2 text-sm bg-transparent outline-none focus:ring-1 focus:ring-ring resize-none"
          />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={onClose} disabled={loading}>Cancel</Button>
            <Button size="sm" onClick={handleSubmit} disabled={!prompt.trim() || loading} className="gap-1.5">
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {loading ? "Updating…" : "Apply"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
