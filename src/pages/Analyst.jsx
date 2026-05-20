import { useState, useEffect, useRef } from "react";
import { appClient } from "@/api/appClient";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { LayoutDashboard, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import PlanGate from "@/components/PlanGate";
import { usePlan } from "@/lib/usePlan";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import ChatMessage from "../components/analyst/ChatMessage";
import ChatInput from "../components/analyst/ChatInput";
import SuggestedPrompts from "../components/analyst/SuggestedPrompts";
import DashboardPreviewPanel from "../components/dashboard/DashboardPreviewPanel";
import ConversationSidebar from "../components/analyst/ConversationSidebar";
import CampaignEditor from "@/components/edm/CampaignEditor";

export default function Analyst() {
  const [conversationId, setConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [lastPinnedChart, setLastPinnedChart] = useState(null);
  const [campaignEditorOpen, setCampaignEditorOpen] = useState(false);
  const [campaignEditorInitial, setCampaignEditorInitial] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draftPrompt, setDraftPrompt] = useState("");
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
  const { data: edmCampaigns = [] } = useQuery({
    queryKey: ["edm-campaigns"],
    queryFn: () => appClient.edm.listCampaigns({ limit: 10, offset: 0 }).then(r => r.results || r),
  });

  const { data: allSettings = {} } = useQuery({
    queryKey: ["app-settings"],
    queryFn: () => appClient.settings.getAll(),
  });
  const savedPrompt = allSettings?.analyst_system_prompt?.value ?? "";

  const saveSettingsMutation = useMutation({
    mutationFn: (value) => appClient.settings.set("analyst_system_prompt", value, "AI Analyst - Company Context"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["app-settings"] });
      toast.success("Company context saved - will apply to new messages");
      setSettingsOpen(false);
    },
    onError: (err) => toast.error(err.message || "Failed to save"),
  });

  const stripContextPrefix = (text) => {
    if (typeof text !== "string") return text;
    const marker = "[END APP CONTEXT - user question follows:]\n";
    const idx = text.indexOf(marker);
    return idx !== -1 ? text.slice(idx + marker.length) : text;
  };

  const cleanMessages = (msgs) =>
    (msgs || []).map(m => m.role === "user" ? { ...m, content: stripContextPrefix(m.content) } : m);

  // Subscribe to active conversation - poll until AI finishes (status: "idle")
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
    const lines = ["[APP CONTEXT - available data across pages:]\n"];
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
    if (edmCampaigns.length > 0) {
      lines.push(`\nEDM CAMPAIGNS (${edmCampaigns.length}):`);
      edmCampaigns.slice(0, 8).forEach(c => {
        lines.push(`  - "${c.name}" [${c.status}] subject="${c.subject || ""}" sent=${c.sent_count ?? 0} opened=${c.opened_count ?? 0}`);
      });
    }
    lines.push("\n[END APP CONTEXT - user question follows:]\n");
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

  const { canUseFeatures } = usePlan();

  const handleSend = async (text, fileUrls) => {
    if (!canUseFeatures) return;
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
    toast.success("Chart pinned - dashboard preview opened");
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

  const resolveSegmentAndUTM = async (data) => {
    let segmentId = data.segment_id || null;
    let utmCampaignId = null;

    if (data._segment_choice === "create_new" && data._suggested_segment?.name) {
      try {
        const seg = await appClient.entities.Segment.create({
          name: data._suggested_segment.name,
          description: data._suggested_segment.description || "",
          segment_type: data._suggested_segment.segment_type || "customer",
          estimated_size: data._suggested_segment.estimated_size || null,
          status: "active",
          metadata: data._suggested_segment.metadata || {},
        });
        segmentId = seg.id;
        queryClient.invalidateQueries({ queryKey: ["segments"] });
        toast.success(`Segment "${data._suggested_segment.name}" created`);
      } catch {}
    } else if (data._segment_choice === "use_existing" && data._suggested_segment?.existing_segment_id) {
      segmentId = data._suggested_segment.existing_segment_id;
    }

    if (data._utm_choice === "create_new" && data._utm_choice !== "pending" && data._suggested_utm) {
      try {
        const slug = data._suggested_utm.utm_campaign || data.utm_campaign_name || data.name?.toLowerCase().replace(/\s+/g, "-");
        const utm = await appClient.entities.Campaign.create({
          name: data._suggested_utm.name || slug,
          utm_source: data._suggested_utm.utm_source || "email",
          utm_medium: data._suggested_utm.utm_medium || "email",
          utm_campaign: slug,
          utm_term: "",
          utm_content: "",
          status: "active",
        });
        utmCampaignId = utm.id;
        queryClient.invalidateQueries({ queryKey: ["campaigns"] });
        toast.success(`UTM link "${utm.name}" created`);
      } catch {}
    } else if (data._utm_choice === "use_existing" && data._suggested_utm?.existing_utm_id) {
      utmCampaignId = data._suggested_utm.existing_utm_id;
    }

    return { segmentId, utmCampaignId };
  };

  const handleAddEDM = async (data) => {
    try {
      const { segmentId, utmCampaignId } = await resolveSegmentAndUTM(data);
      await appClient.edm.createCampaign({
        name: data.name,
        subject: data.subject || "",
        preview_text: data.preview_text || null,
        from_name: data.from_name || "Click AI",
        from_email: data.from_email || "onboarding@resend.dev",
        html_body: data.html_body || null,
        segment_id: segmentId,
        utm_campaign_id: utmCampaignId,
        status: "draft",
      });
      queryClient.invalidateQueries({ queryKey: ["edm-campaigns"] });
      toast.success(`Email campaign "${data.name}" saved as draft - go to Email page to review and send`);
    } catch (err) {
      toast.error(err.message || "Failed to save email campaign");
    }
  };

  const handleOpenEDMInEditor = (data) => {
    setCampaignEditorInitial({
      name: data.name,
      subject: data.subject || "",
      preview_text: data.preview_text || "",
      from_name: data.from_name || "Click AI",
      from_email: data.from_email || "onboarding@resend.dev",
      reply_to: "",
      segment_id: data.segment_id || "",
      utm_campaign_id: "",
      html_body: data.html_body || "",
      ab_test_config: {
        _blocks: data._blocks || [],
        _html_mode: !data._blocks || data._blocks.length === 0,
        _trigger_type: data._trigger_type || data.trigger_type || "manual",
        _schedules: [],
        _events: data.trigger_event
          ? [{ id: "ai_event_1", event: data.trigger_event, delay_hours: 24 }]
          : [],
      },
    });
    setCampaignEditorOpen(true);
  };

  const handleSaveEDMFromEditor = async (formData) => {
    try {
      // Resolve segment/UTM from the original AI suggestion stored in initial
      const { segmentId, utmCampaignId } = await resolveSegmentAndUTM(campaignEditorInitial || {});
      await appClient.edm.createCampaign({
        ...formData,
        segment_id: formData.segment_id || segmentId || null,
        utm_campaign_id: formData.utm_campaign_id || utmCampaignId || null,
      });
      queryClient.invalidateQueries({ queryKey: ["edm-campaigns"] });
      toast.success(`Email campaign "${formData.name}" saved - go to Email page to send`);
      setCampaignEditorOpen(false);
      setCampaignEditorInitial(null);
    } catch (err) {
      toast.error(err.message || "Failed to save email campaign");
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
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-semibold">AI Analyst</h1>
            {savedPrompt && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-secondary border border-border text-muted-foreground">
                Company context active
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost" size="sm" className="h-8 text-xs gap-1.5"
              onClick={() => { setDraftPrompt(savedPrompt); setSettingsOpen(true); }}
            >
              <Settings className="w-3.5 h-3.5" />
              Context
            </Button>
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
        </div>

        {/* Messages / gate */}
        {!canUseFeatures ? (
          <div className="flex-1 overflow-auto">
            <PlanGate feature="the AI Analyst" />
          </div>
        ) : messages.length === 0 ? (
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
                  onAddEDM={handleAddEDM}
                  onOpenEDMInEditor={handleOpenEDMInEditor}
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

        {/* Input - hidden when trial expired */}
        {canUseFeatures && <ChatInput onSend={handleSend} disabled={isStreaming} />}
      </div>

      {/* Dashboard preview panel - right side */}
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

      {/* Campaign editor opened from AI suggestion */}
      <CampaignEditor
        open={campaignEditorOpen}
        onClose={() => { setCampaignEditorOpen(false); setCampaignEditorInitial(null); }}
        onSave={handleSaveEDMFromEditor}
        initial={campaignEditorInitial}
      />

      {/* Company context settings dialog */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-heading">Company Context</DialogTitle>
            <DialogDescription>
              Tell the AI analyst about your company - industry, goals, audience, tone, or anything it should always keep in mind.
              This context is injected into every conversation automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-1">
            <div>
              <Label className="text-xs">System prompt</Label>
              <Textarea
                value={draftPrompt}
                onChange={e => setDraftPrompt(e.target.value)}
                placeholder={`e.g. We are LinkedU, an education consultancy based in Hong Kong. Our members are mostly families exploring overseas study options for their children (ages 10–18). Our tone should be professional but warm. When suggesting campaigns, prioritise members registered via Seminar as they have the highest conversion rate. Our peak season is September–November.`}
                className="mt-1 min-h-[180px] text-xs font-mono resize-y"
              />
              <p className="text-[10px] text-muted-foreground mt-1.5">
                Leave empty to use no company context. Changes apply to the next message sent - not to existing conversations.
              </p>
            </div>
            <div className="flex items-center justify-between gap-3">
              {savedPrompt && (
                <Button
                  variant="ghost" size="sm" className="text-xs text-muted-foreground h-8"
                  onClick={() => { setDraftPrompt(""); saveSettingsMutation.mutate(""); }}
                  disabled={saveSettingsMutation.isPending}
                >
                  Clear context
                </Button>
              )}
              <div className="flex gap-2 ml-auto">
                <Button variant="outline" size="sm" className="h-8" onClick={() => setSettingsOpen(false)}>Cancel</Button>
                <Button
                  size="sm" className="h-8"
                  disabled={saveSettingsMutation.isPending || draftPrompt === savedPrompt}
                  onClick={() => saveSettingsMutation.mutate(draftPrompt)}
                >
                  {saveSettingsMutation.isPending ? "Saving…" : "Save"}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
