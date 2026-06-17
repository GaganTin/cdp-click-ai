import { useState } from "react";
import { appClient } from "@/api/appClient";
import { Sparkles, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import ReactMarkdown from "react-markdown";

export default function ChartExplainer({ chart, config, chartKey }) {
  const [open, setOpen] = useState(false);
  const [explanation, setExplanation] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleExplain = async (e) => {
    e.stopPropagation();
    setOpen(true);
    setExplanation(null);
    setLoading(true);
    try {
      if (chartKey) {
        const result = await appClient.chartSummaries.explain({
          chart_key: chartKey,
          chart_title: chart.title,
          chart_type: chart.chart_type,
          data: config?.data?.slice?.(0, 15) || [],
        });
        setExplanation(result.summary);
      } else {
        const dataPreview = JSON.stringify(config?.data?.slice?.(0, 10) || config, null, 2).slice(0, 1200);
        const prompt = `You are a data analyst. Explain this chart clearly and concisely to a non-technical business user.

Chart title: "${chart.title}"
Chart type: ${chart.chart_type}
Description: ${chart.description || "none"}
Data preview:
${dataPreview}

Provide:
1. What this chart shows (1-2 sentences)
2. Key insight or trend from the data (1-2 sentences)
3. What action this suggests (1 sentence)

Keep it short, plain, and business-focused.`;
        const result = await appClient.integrations.Core.InvokeLLM({ prompt });
        setExplanation(result);
      }
    } catch (err) {
      setExplanation(err?.payload?.error || err?.message || "Unable to generate explanation. Please try again.");
    }
    setLoading(false);
  };

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-muted-foreground hover:text-foreground"
        title="AI explanation"
        onClick={handleExplain}
      >
        <Sparkles className="w-3.5 h-3.5" />
      </Button>

      {open && (
        <div className="absolute right-0 top-8 z-50 w-72 bg-popover border border-border rounded-lg shadow-lg p-4" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold">AI Explanation</span>
            </div>
            <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Analysing chart...
            </div>
          ) : (
            <div className="prose prose-xs prose-neutral max-w-none text-xs leading-relaxed">
              <ReactMarkdown>{explanation || ""}</ReactMarkdown>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
