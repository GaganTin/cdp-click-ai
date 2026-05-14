import { useState, useEffect, useRef } from "react";
import { appClient } from "@/api/appClient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LayoutDashboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import ChatMessage from "../components/analyst/ChatMessage";
import ChatInput from "../components/analyst/ChatInput";
import SuggestedPrompts from "../components/analyst/SuggestedPrompts";
import DashboardPreviewPanel from "../components/dashboard/DashboardPreviewPanel";
import ConversationSidebar from "../components/analyst/ConversationSidebar";

export default function Analyst() {
  const [conversationId, setConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [lastPinnedChart, setLastPinnedChart] = useState(null);
  // Track whether the current conversation has had its context injected
  const contextInjectedRef = useRef(false);
  const scrollRef = useRef(null);
  const isNearBottom = useRef(true);
  const queryClient = useQueryClient();

  // Load cross-page context data
  const { data: segments = [] } = useQuery({
    queryKey: ["segments"],
    queryFn: () => appClient.entities.Segment.list("-created_date", 20),
  });
  const { data: campaigns = [] } = useQuery({
    queryKey: ["campaigns"],
    queryFn: () => appClient.entities.Campaign.list("-created_date", 20),
  });
  const { data: reports = [] } = useQuery({
    queryKey: ["reports"],
    queryFn: () => appClient.entities.SavedReport.list("-created_date", 10),
  });
  const { data: pinnedCharts = [] } = useQuery({
    queryKey: ["pinnedCharts"],
    queryFn: () => appClient.entities.PinnedChart.list("-created_date", 20),
  });

  const stripContextPrefix = (text) => {
    if (typeof text !== "string") return text;
    const marker = "[END APP CONTEXT — user question follows:]\n";
    const idx = text.indexOf(marker);
    return idx !== -1 ? text.slice(idx + marker.length) : text;
  };

  const cleanMessages = (msgs) =>
    (msgs || []).map(m => m.role === "user" ? { ...m, content: stripContextPrefix(m.content) } : m);

  // Subscribe to active conversation — poll until AI finishes (status: "idle")
  useEffect(() => {
    if (!conversationId) return;
    const unsubscribe = appClient.agents.subscribeToConversation(conversationId, (data) => {
      setMessages(cleanMessages(data.messages));
      setIsStreaming(data.status === "processing");
    });
    return () => unsubscribe();
  }, [conversationId]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    isNearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  useEffect(() => {
    if (isNearBottom.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Build context summary to inject into first message of a new conversation
  const buildContextPrefix = () => {
    const lines = ["[APP CONTEXT — available data across pages:]\n"];
    if (pinnedCharts.length > 0) {
      lines.push(`DASHBOARD CHARTS (${pinnedCharts.length}):`);
      pinnedCharts.slice(0, 8).forEach(c => {
        lines.push(`  - "${c.title}" (${c.chart_type}): ${c.description || "no description"}`);
      });
    }
    if (campaigns.length > 0) {
      lines.push(`\nUTM CAMPAIGNS (${campaigns.length}):`);
      campaigns.slice(0, 8).forEach(c => {
        lines.push(`  - "${c.name}" [${c.status}] source=${c.utm_source || "(none)"} medium=${c.utm_medium || "(none)"}`);
      });
    }
    if (segments.length > 0) {
      lines.push(`\nSEGMENTS (${segments.length}):`);
      segments.slice(0, 8).forEach(s => {
        lines.push(`  - "${s.name}": ${s.description || "no description"}${s.estimated_size ? ` (~${s.estimated_size.toLocaleString()} users)` : ""}`);
      });
    }
    if (reports.length > 0) {
      lines.push(`\nSAVED REPORTS (${reports.length}):`);
      reports.slice(0, 8).forEach(r => {
        lines.push(`  - "${r.title}" (${r.created_date?.slice(0, 10)})`);
      });
    }
    lines.push("\n[END APP CONTEXT — user question follows:]\n");
    return lines.join("\n");
  };

  const startNewConversation = async (name) => {
    const conv = await appClient.agents.createConversation({
      agent_name: "cdp_analyst",
      metadata: { name: name || `Analysis - ${new Date().toLocaleDateString()}` },
    });
    contextInjectedRef.current = false;
    setConversationId(conv.id);
    setMessages([]);
    return conv;
  };

  // Switch to an existing conversation
  const handleSelectConversation = async (id) => {
    if (id === conversationId) return;
    setIsStreaming(false);
    contextInjectedRef.current = true; // existing conv already had context injected
    const conv = await appClient.agents.getConversation(id);
    setConversationId(id);
    setMessages(cleanMessages(conv.messages));
  };

  const handleNewChat = async () => {
    contextInjectedRef.current = false;
    setConversationId(null);
    setMessages([]);
    setIsStreaming(false);
  };

  const handleSend = async (text, fileUrls) => {
    isNearBottom.current = true;
    let conv;
    const isNewConv = !conversationId;

    if (isNewConv) {
      const chatName = text.length > 50 ? text.slice(0, 50) + "…" : text;
      conv = await startNewConversation(chatName);
    } else {
      conv = await appClient.agents.getConversation(conversationId);
    }

    // Inject context on first message of a new conversation only
    const shouldInjectContext = isNewConv || !contextInjectedRef.current;
    const fullText = shouldInjectContext ? buildContextPrefix() + text : text;
    if (shouldInjectContext) contextInjectedRef.current = true;

    // Name the conversation after the first user message (set during creation)


    const msgPayload = { role: "user", content: text };
    if (fileUrls?.length) msgPayload.file_urls = fileUrls;

    setMessages((prev) => [...prev, msgPayload]);
    setIsStreaming(true);

    const sendPayload = { role: "user", content: fullText };
    if (fileUrls?.length) sendPayload.file_urls = fileUrls;
    await appClient.agents.addMessage(conv, sendPayload);
  };

  const handlePinChart = async (chartConfig) => {
    const created = await appClient.entities.PinnedChart.create({
      title: chartConfig.title || "Pinned Chart",
      chart_type: chartConfig.chart_type || "bar",
      chart_config: JSON.stringify(chartConfig),
      description: chartConfig.description || "",
      query: chartConfig.query || "",
      last_refreshed: new Date().toISOString(),
    });
    queryClient.invalidateQueries({ queryKey: ["pinnedCharts"] });
    toast.success("Chart pinned — dashboard preview opened");
    setLastPinnedChart({ ...created, chart_config: JSON.stringify(chartConfig) });
    setShowDashboard(true);
  };

  const handleDownloadCSV = (csvData) => {
    const blob = new Blob([csvData], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `click-export-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV downloaded");
  };

  const handleAddUTMLink = async (data) => {
    try {
      await appClient.entities.Campaign.create(data);
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      toast.success(`UTM link "${data.name}" added to UTM page`);
    } catch (err) {
      toast.error(err.message || "Failed to save UTM link");
    }
  };

  const handleAddSegment = async (data) => {
    try {
      await appClient.entities.Segment.create(data);
      queryClient.invalidateQueries({ queryKey: ["segments"] });
      toast.success(`Segment "${data.name}" added to Segments page`);
    } catch (err) {
      toast.error(err.message || "Failed to save segment");
    }
  };

  const handleEditChartRequest = async (item) => {
    let config = {};
    try { config = JSON.parse(item.chart_config); } catch {}
    const prompt = `Please update the chart titled "${item.title || config.title || "this chart"}". Here is the current configuration:\n\`\`\`json\n${JSON.stringify(config, null, 2)}\n\`\`\`\nWhat changes would you like? (e.g. add a date filter, change chart type, add a series, update the data)`;
    await handleSend(prompt);
  };

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Conversation history sidebar */}
      <ConversationSidebar
        activeConversationId={conversationId}
        onSelect={handleSelectConversation}
        onNew={handleNewChat}
        onRename={() => {}}
      />

      {/* Main chat area */}
      <div className="flex flex-col flex-1 min-w-0 h-full overflow-hidden">
        {/* Header */}
        <div className="h-14 border-b border-border flex items-center justify-between px-6 flex-shrink-0">
          <h1 className="text-sm font-semibold">AI Analyst</h1>
          <Button
            variant={showDashboard ? "default" : "ghost"}
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={() => setShowDashboard(v => !v)}
          >
            <LayoutDashboard className="w-3.5 h-3.5" />
            Dashboard
          </Button>
        </div>

        {/* Messages */}
        {messages.length === 0 ? (
          <SuggestedPrompts onSelect={handleSend} />
        ) : (
          <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-auto py-6">
            <div className="max-w-3xl mx-auto px-6 space-y-6">
              {messages.map((msg, i) => (
                <ChatMessage
                  key={i}
                  message={msg}
                  onPinChart={handlePinChart}
                  onDownloadCSV={handleDownloadCSV}
                  onAddUTMLink={handleAddUTMLink}
                  onAddSegment={handleAddSegment}
                />
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

        {/* Input */}
        <ChatInput onSend={handleSend} disabled={isStreaming} />
      </div>

      {/* Dashboard preview panel — right side */}
      {showDashboard && (
        <div className="w-[460px] flex-shrink-0 flex flex-col overflow-hidden">
          <DashboardPreviewPanel
            onClose={() => setShowDashboard(false)}
            pinnedChart={lastPinnedChart}
            pinnedCharts={pinnedCharts}
            onEditRequest={handleEditChartRequest}
          />
        </div>
      )}
    </div>
  );
}
