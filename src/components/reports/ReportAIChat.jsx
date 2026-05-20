import { useState, useEffect, useRef } from "react";
import { appClient } from "@/api/appClient";
import { Send, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import ChatMessage from "../analyst/ChatMessage";
import { toast } from "sonner";

const SUGGESTED = [
  "What reports can I create from my current data?",
  "Create a UTM campaign performance summary report",
  "Generate a segment analysis report",
  "Build a monthly marketing overview report",
  "Create a report comparing active vs draft campaigns",
];

export default function ReportAIChat({ reports, campaigns, segments, onSaveReport }) {
  const [conversationId, setConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [savingMsg, setSavingMsg] = useState(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (!conversationId) return;
    const unsub = appClient.agents.subscribeToConversation(conversationId, (data) => {
      setMessages(data.messages || []);
      const last = data.messages?.[data.messages.length - 1];
      setIsStreaming(last?.role === "assistant" && !last?.content?.endsWith?.("\n"));
    });
    return () => unsub();
  }, [conversationId]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const buildContext = () => {
    const lines = ["[CURRENT DATA CONTEXT:]\n"];
    if (reports?.length) {
      lines.push(`SAVED REPORTS (${reports.length}):`);
      reports.forEach(r => lines.push(`  - "${r.title}" | tags: ${r.tags?.join(", ") || "none"} | created: ${r.created_date?.slice(0, 10)}`));
    }
    if (campaigns?.length) {
      lines.push(`\nUTM CAMPAIGNS (${campaigns.length}):`);
      campaigns.forEach(c => lines.push(`  - "${c.name}" [${c.status}] source=${c.utm_source || "-"} medium=${c.utm_medium || "-"}`));
    }
    if (segments?.length) {
      lines.push(`\nSEGMENTS (${segments.length}):`);
      segments.forEach(s => lines.push(`  - "${s.name}": ${s.description || "no desc"}${s.estimated_size ? ` (~${s.estimated_size.toLocaleString()} users)` : ""}`));
    }
    lines.push("\n[END CONTEXT]\n");
    lines.push("You are a reporting analyst. Help the user understand what reports they can create, generate report content in clear markdown, and suggest report structures. When generating a report, always produce well-structured markdown with sections, summaries, and insights.\n");
    return lines.join("\n");
  };

  const handleSend = async (text) => {
    if (!text.trim() || isStreaming) return;
    setInput("");
    let conv;
    const isNew = !conversationId;
    if (isNew) {
      conv = await appClient.agents.createConversation({
        agent_name: "cdp_analyst",
        metadata: { name: text.length > 50 ? text.slice(0, 50) + "…" : text },
      });
      setConversationId(conv.id);
    } else {
      conv = await appClient.agents.getConversation(conversationId);
    }
    const fullText = isNew ? buildContext() + text : text;
    setMessages(prev => [...prev, { role: "user", content: text }]);
    setIsStreaming(true);
    await appClient.agents.addMessage(conv, { role: "user", content: fullText });
  };

  const handleSaveAsReport = async (msg) => {
    setSavingMsg(msg.content);
    const titleMatch = msg.content.match(/^#+ (.+)/m);
    const title = titleMatch ? titleMatch[1] : `Report - ${new Date().toLocaleDateString()}`;
    await onSaveReport({ title, content: msg.content, tags: ["ai-generated"] });
    setSavingMsg(null);
    toast.success("Report saved!");
  };

  return (
    <div className="flex flex-col h-full">
      {messages.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center px-8">
          <div className="text-center mb-8">
            <h2 className="font-heading text-xl font-semibold tracking-tight mb-2">Report Assistant</h2>
            <p className="text-sm text-muted-foreground max-w-md">
              I know your data - campaigns, segments, and existing reports. Ask me to generate any report, and save it directly to your reports folder.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-2 max-w-lg w-full">
            {SUGGESTED.map((s, i) => (
              <button key={i} onClick={() => handleSend(s)} className="text-left px-4 py-3 rounded-lg border border-border hover:border-foreground/20 hover:bg-secondary/50 transition-all text-sm">
                {s}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div ref={scrollRef} className="flex-1 overflow-auto py-6">
          <div className="max-w-3xl mx-auto px-6 space-y-6">
            {messages.map((msg, i) => (
              <div key={i}>
                <ChatMessage message={msg} />
                {msg.role === "assistant" && msg.content && (
                  <div className="flex justify-end mt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1.5"
                      disabled={savingMsg === msg.content}
                      onClick={() => handleSaveAsReport(msg)}
                    >
                      <Save className="w-3 h-3" />
                      {savingMsg === msg.content ? "Saving..." : "Save as Report"}
                    </Button>
                  </div>
                )}
              </div>
            ))}
            {isStreaming && messages[messages.length - 1]?.role !== "assistant" && (
              <div className="flex gap-3">
                <div className="w-7 h-7 rounded-full bg-foreground flex items-center justify-center flex-shrink-0">
                  <span className="text-[10px] font-semibold text-background">AI</span>
                </div>
                <div className="bg-secondary rounded-2xl px-4 py-3">
                  <div className="flex gap-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce" />
                    <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:150ms]" />
                    <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:300ms]" />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="border-t border-border p-4">
        <div className="flex items-end gap-2 max-w-3xl mx-auto">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(input); } }}
            placeholder="Ask me to generate a report from your data..."
            className="flex-1 resize-none rounded-xl border border-border bg-secondary/50 px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring min-h-[44px] max-h-32"
            rows={1}
            disabled={isStreaming}
          />
          <Button size="icon" className="h-9 w-9 rounded-xl flex-shrink-0" disabled={!input.trim() || isStreaming} onClick={() => handleSend(input)}>
            <Send className="w-4 h-4" />
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground text-center mt-2">Click Report Assistant · Knows your campaigns, segments & reports</p>
      </div>
    </div>
  );
}
