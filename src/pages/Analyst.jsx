import { useState, useEffect, useRef } from "react";
import { appClient } from "@/api/appClient";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { LayoutDashboard, Settings, Wand2, Plus, Trash2, Pencil, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import PlanGate from "@/components/PlanGate";
import { usePlan } from "@/lib/usePlan";
import { parseChartConfig } from "@/lib/utils";
import { useAuth } from "@/lib/AuthContext";
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
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [skillsView, setSkillsView] = useState("list"); // "list" | "create" | "edit"
  const [editingSkill, setEditingSkill] = useState(null);
  const [skillDraft, setSkillDraft] = useState({ name: "", description: "", content: "", type: "context" });
  const [activeSkillIds, setActiveSkillIds] = useState([]);
  const [tokenUsage, setTokenUsage] = useState({ input: 0, output: 0, total: 0 });
  // Track whether the current conversation has had its context injected
  const contextInjectedRef = useRef(false);
  const scrollRef = useRef(null);
  const isNearBottom = useRef(true);
  const queryClient = useQueryClient();
  const { user } = useAuth();

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

  const { data: allSkills = [], refetch: refetchSkills } = useQuery({
    queryKey: ["skills"],
    queryFn: () => appClient.skills.list(),
  });
  const contextSkills = allSkills.filter((s) => s.type === "context" && s.is_active !== false);
  const templateSkills = allSkills.filter((s) => s.type === "template" && s.is_active !== false);

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
    return idx !== - 1 ? text.slice(idx + marker.length) : text;
  };

  const cleanMessages = (msgs) =>
    (msgs || []).map(m => m.role === "user" ? { ...m, content: stripContextPrefix(m.content) } : m);

  // Subscribe to active conversation - poll until AI finishes (status: "idle")
  useEffect(() => {
    if (!conversationId) return;
    const unsubscribe = appClient.agents.subscribeToConversation(conversationId, (data) => {
      setMessages(cleanMessages(data.messages));
      setIsStreaming(data.status === "processing");
      if (data.metadata?.token_usage) setTokenUsage(data.metadata.token_usage);
      if (data.metadata?.active_skill_ids) setActiveSkillIds(data.metadata.active_skill_ids);
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
    setTokenUsage({ input: 0, output: 0, total: 0 });
    setActiveSkillIds([]);
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
    setTokenUsage(conv.metadata?.token_usage || { input: 0, output: 0, total: 0 });
    setActiveSkillIds(conv.metadata?.active_skill_ids || []);
  };

  const handleNewChat = async () => {
    contextInjectedRef.current = false;
    setConversationId(null);
    setMessages([]);
    setIsStreaming(false);
    setTokenUsage({ input: 0, output: 0, total: 0 });
    setActiveSkillIds([]);
  };

  const { canUseFeatures } = usePlan();

  const handleToggleSkill = async (skillId) => {
    const next = activeSkillIds.includes(skillId)
      ? activeSkillIds.filter((id) => id !== skillId)
      : [...activeSkillIds, skillId];
    setActiveSkillIds(next);
    if (conversationId) {
      await appClient.agents.updateConversation(conversationId, {
        metadata: { active_skill_ids: next },
      });
    }
  };

  const handleUseTemplate = async (skill) => {
    setSkillsOpen(false);
    await handleSend(skill.content);
  };

  const handleSaveSkill = async () => {
    if (!skillDraft.name.trim()) return toast.error("Name is required");
    try {
      if (editingSkill) {
        await appClient.skills.update(editingSkill.id, skillDraft);
        toast.success("Skill updated");
      } else {
        await appClient.skills.create(skillDraft);
        toast.success("Skill created");
      }
      refetchSkills();
      setSkillsView("list");
      setEditingSkill(null);
      setSkillDraft({ name: "", description: "", content: "", type: "context" });
    } catch (err) {
      toast.error(err.message || "Failed to save skill");
    }
  };

  const handleDeleteSkill = async (id) => {
    try {
      await appClient.skills.remove(id);
      refetchSkills();
      if (activeSkillIds.includes(id)) {
        const next = activeSkillIds.filter((sid) => sid !== id);
        setActiveSkillIds(next);
        if (conversationId) {
          await appClient.agents.updateConversation(conversationId, { metadata: { active_skill_ids: next } });
        }
      }
      toast.success("Skill deleted");
    } catch (err) {
      toast.error(err.message || "Failed to delete skill");
    }
  };

  const openEditSkill = (skill) => {
    setEditingSkill(skill);
    setSkillDraft({ name: skill.name, description: skill.description || "", content: skill.content || "", type: skill.type });
    setSkillsView("edit");
  };

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
        from_name: data.from_name || "Meritma",
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
      from_name: data.from_name || "Meritma",
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
    const config = parseChartConfig(item.chart_config);
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
            {activeSkillIds.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-secondary border border-border text-muted-foreground">
                {activeSkillIds.length} skill{activeSkillIds.length !== 1 ? "s" : ""} active
              </span>
            )}
            {tokenUsage.total > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-secondary border border-border text-muted-foreground font-mono">
                {tokenUsage.total.toLocaleString()} tokens
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost" size="sm" className="h-8 text-xs gap-1.5"
              onClick={() => { setSkillsView("list"); setSkillsOpen(true); }}
            >
              <Wand2 className="w-3.5 h-3.5" />
              Tools
            </Button>
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
        {canUseFeatures && (
          <ChatInput
            onSend={handleSend}
            disabled={isStreaming}
            contextSkills={contextSkills}
            templateSkills={templateSkills}
            activeSkillIds={activeSkillIds}
            onToggleSkill={handleToggleSkill}
          />
        )}
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

      {/* Manage Skills dialog */}
      <Dialog open={skillsOpen} onOpenChange={(v) => {
        setSkillsOpen(v);
        if (!v) { setSkillsView("list"); setEditingSkill(null); setSkillDraft({ name: "", description: "", content: "", type: "context" }); }
      }}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
          {skillsView === "list" ? (
            <>
              <DialogHeader>
                <div className="flex items-center justify-between">
                  <DialogTitle className="font-heading">
                    Skills &amp; Templates
                  </DialogTitle>
                  <div className="flex items-center gap-2 mr-6">
                    <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5"
                      onClick={() => { setSkillDraft({ name: "", description: "", content: "", type: "context" }); setSkillsView("create"); }}>
                      <Plus className="w-3.5 h-3.5" /> New skill
                    </Button>
                    <Button size="sm" className="h-8 text-xs gap-1.5"
                      onClick={() => { setSkillDraft({ name: "", description: "", content: "", type: "template" }); setSkillsView("create"); }}>
                      <Plus className="w-3.5 h-3.5" /> New template
                    </Button>
                  </div>
                </div>
                <DialogDescription>
                  Shared across your workspace. Skills inject AI instructions per session - Templates are one-click conversation starters.
                  Use the <strong>+</strong> button in the chat input to add them to a session.
                </DialogDescription>
              </DialogHeader>

              <div className="flex-1 overflow-y-auto min-h-0 mt-2 space-y-6 pr-1">
                {/* Skills section */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Skills</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground border border-border">
                      injected into system prompt
                    </span>
                  </div>
                  {contextSkills.length === 0 ? (
                    <div className="py-6 text-center border border-dashed border-border rounded-lg">
                      <p className="text-sm text-muted-foreground">No skills yet</p>
                      <p className="text-xs text-muted-foreground/70 mt-1">Create one to inject persistent instructions into any chat session</p>
                      <Button variant="outline" size="sm" className="mt-3 h-7 text-xs gap-1"
                        onClick={() => { setSkillDraft({ name: "", description: "", content: "", type: "context" }); setSkillsView("create"); }}>
                        <Plus className="w-3 h-3" /> Create skill
                      </Button>
                    </div>
                  ) : (
                    <div className="border border-border rounded-lg overflow-hidden divide-y divide-border">
                      {contextSkills.map((skill) => {
                        const isOwn = skill.created_by === user?.id;
                        const creatorLabel = isOwn ? "You" : (skill.creator_name || skill.creator_email || "Team member");
                        const canEdit = isOwn;
                        return (
                          <div key={skill.id} className="flex items-start gap-3 px-4 py-3 hover:bg-secondary/30 transition-colors group">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-sm font-medium">{skill.name}</p>
                              </div>
                              {skill.description && (
                                <p className="text-xs text-muted-foreground mt-0.5">{skill.description}</p>
                              )}
                              {skill.content && (
                                <p className="text-[11px] text-muted-foreground/60 mt-1.5 font-mono bg-secondary/60 px-2 py-1 rounded line-clamp-2">{skill.content}</p>
                              )}
                              <div className="flex items-center gap-2 mt-1.5">
                                <span className="text-[10px] text-muted-foreground/60">
                                  by {creatorLabel}
                                </span>
                                {skill.created_date && (
                                  <span className="text-[10px] text-muted-foreground/40">
                                    · {new Date(skill.created_date).toLocaleDateString()}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button variant="ghost" size="icon" className="h-7 w-7"
                                title={canEdit ? "Edit" : "Only the creator or an admin can edit"}
                                disabled={!canEdit}
                                onClick={() => openEditSkill(skill)}>
                                <Pencil className="w-3 h-3" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
                                onClick={() => handleDeleteSkill(skill.id)}>
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Templates section */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Templates</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-secondary border border-border text-muted-foreground">
                      one-click starters
                    </span>
                  </div>
                  {templateSkills.length === 0 ? (
                    <div className="py-6 text-center border border-dashed border-border rounded-lg">
                      <p className="text-sm text-muted-foreground">No templates yet</p>
                      <p className="text-xs text-muted-foreground/70 mt-1">Save reusable prompts your whole team can launch with one click</p>
                      <Button variant="outline" size="sm" className="mt-3 h-7 text-xs gap-1"
                        onClick={() => { setSkillDraft({ name: "", description: "", content: "", type: "template" }); setSkillsView("create"); }}>
                        <Plus className="w-3 h-3" /> Create template
                      </Button>
                    </div>
                  ) : (
                    <div className="border border-border rounded-lg overflow-hidden divide-y divide-border">
                      {templateSkills.map((skill) => {
                        const isOwn = skill.created_by === user?.id;
                        const creatorLabel = isOwn ? "You" : (skill.creator_name || skill.creator_email || "Team member");
                        const canEdit = isOwn;
                        return (
                          <div key={skill.id} className="flex items-start gap-3 px-4 py-3 hover:bg-secondary/30 transition-colors group">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium">{skill.name}</p>
                              {skill.description && (
                                <p className="text-xs text-muted-foreground mt-0.5">{skill.description}</p>
                              )}
                              {skill.content && (
                                <p className="text-[11px] text-muted-foreground/60 mt-1.5 font-mono bg-secondary/60 px-2 py-1 rounded line-clamp-2">{skill.content}</p>
                              )}
                              <div className="flex items-center gap-2 mt-1.5">
                                <span className="text-[10px] text-muted-foreground/60">by {creatorLabel}</span>
                                {skill.created_date && (
                                  <span className="text-[10px] text-muted-foreground/40">· {new Date(skill.created_date).toLocaleDateString()}</span>
                                )}
                              </div>
                            </div>
                            <div className="flex gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button variant="ghost" size="icon" className="h-7 w-7"
                                disabled={!canEdit}
                                title={canEdit ? "Edit" : "Only the creator or an admin can edit"}
                                onClick={() => openEditSkill(skill)}>
                                <Pencil className="w-3 h-3" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
                                onClick={() => handleDeleteSkill(skill.id)}>
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="font-heading flex items-center gap-2">
                  <button onClick={() => { setSkillsView("list"); setEditingSkill(null); }}
                    className="text-muted-foreground hover:text-foreground transition-colors">
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                  {skillsView === "edit" ? "Edit Skill" : "New Skill"}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-1">
                <div className="flex gap-2">
                  {["context", "template"].map((t) => (
                    <button key={t}
                      disabled={skillsView === "edit"}
                      onClick={() => setSkillDraft((d) => ({ ...d, type: t }))}
                      className={`flex-1 py-1.5 text-xs rounded-md border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${skillDraft.type === t ? "bg-foreground text-background border-foreground" : "border-border hover:bg-secondary/50"}`}>
                      {t === "context" ? "Skill" : "Template"}
                    </button>
                  ))}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Name</Label>
                  <Input className="h-8 text-sm"
                    placeholder={skillDraft.type === "context" ? "e.g. UK Market Focus" : "e.g. Weekly Retention Report"}
                    value={skillDraft.name}
                    onChange={(e) => setSkillDraft((d) => ({ ...d, name: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Description <span className="text-muted-foreground font-normal">(optional)</span></Label>
                  <Input className="h-8 text-sm" placeholder="Short description shown to teammates"
                    value={skillDraft.description}
                    onChange={(e) => setSkillDraft((d) => ({ ...d, description: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{skillDraft.type === "context" ? "Instructions" : "Prompt"}</Label>
                  <Textarea className="text-xs font-mono min-h-[140px] resize-y"
                    placeholder={skillDraft.type === "context"
                      ? "e.g. Always focus on the UK market. When comparing metrics, show YoY change. Use GBP for monetary values."
                      : "e.g. Show me a weekly retention report broken down by member type, compared to last week."}
                    value={skillDraft.content}
                    onChange={(e) => setSkillDraft((d) => ({ ...d, content: e.target.value }))} />
                  <p className="text-[10px] text-muted-foreground">
                    {skillDraft.type === "context"
                      ? "Injected into the AI system prompt whenever a team member activates this skill in a chat."
                      : "Sent as the opening message when a team member clicks Use from the + menu in chat."}
                  </p>
                </div>
                <div className="flex gap-2 justify-end pt-1">
                  <Button variant="outline" size="sm" className="h-8"
                    onClick={() => { setSkillsView("list"); setEditingSkill(null); setSkillDraft({ name: "", description: "", content: "", type: "context" }); }}>
                    Cancel
                  </Button>
                  <Button size="sm" className="h-8" onClick={handleSaveSkill}>
                    {skillsView === "edit" ? "Save changes" : "Create skill"}
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

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
                placeholder={`e.g. We are a [industry] business based in [location]. Our customers are mostly [who they are and what they care about]. Our tone should be [e.g. professional but warm]. When suggesting campaigns, prioritise [the segment or channel that converts best]. Our peak season is [months].`}
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
