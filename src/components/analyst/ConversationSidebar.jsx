import { useState, useEffect, useRef } from "react";
import { appClient } from "@/api/appClient";
import { Plus, MessageSquare, ChevronDown, ChevronRight, Check, Pencil, Trash2, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { format, isToday, isYesterday, isThisWeek } from "date-fns";
import { cn } from "@/lib/utils";

function groupConversations(conversations) {
  const groups = { Today: [], Yesterday: [], "This week": [], Older: [] };
  conversations.forEach(conv => {
    const date = new Date(conv.updated_date || conv.created_date);
    if (isToday(date)) groups["Today"].push(conv);
    else if (isYesterday(date)) groups["Yesterday"].push(conv);
    else if (isThisWeek(date)) groups["This week"].push(conv);
    else groups["Older"].push(conv);
  });
  return groups;
}

export default function ConversationSidebar({ activeConversationId, onSelect, onNew, onRename }) {
  const [conversations, setConversations] = useState([]);
  const [deletedIds, setDeletedIds] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState("");
  const editRef = useRef(null);

  const loadConversations = async () => {
    try {
      const convs = await appClient.agents.listConversations({ agent_name: "cdp_analyst" });
      const sorted = (convs || []).sort((a, b) =>
        new Date(b.updated_date || b.created_date) - new Date(a.updated_date || a.created_date)
      );
      setConversations(sorted);
    } catch {
      setConversations([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConversations();
  }, [activeConversationId]);

  useEffect(() => {
    if (editingId && editRef.current) {
      editRef.current.focus();
      editRef.current.select();
    }
  }, [editingId]);

  const getTitle = (conv) => {
    return conv.metadata?.name || `Chat - ${format(new Date(conv.created_date), "MMM d")}`;
  };

  const startEdit = (conv, e) => {
    e.stopPropagation();
    setEditingId(conv.id);
    setEditValue(getTitle(conv));
  };

  const commitEdit = async (convId) => {
    if (editValue.trim()) {
      await appClient.agents.updateConversation(convId, { metadata: { name: editValue.trim() } });
      onRename?.();
      await loadConversations();
    }
    setEditingId(null);
  };

  const handleDelete = async (convId, e) => {
    e.stopPropagation();
    setDeletedIds(prev => new Set([...prev, convId]));
    if (convId === activeConversationId) onNew?.();
    try {
      await appClient.functions.invoke('deleteConversation', { conversation_id: convId });
    } catch {
      // best-effort
    }
  };

  const visibleConversations = conversations.filter(c => !deletedIds.has(c.id));
  const groups = groupConversations(visibleConversations);

  return (
    <div className={cn(
      "flex flex-col h-full border-r border-border bg-secondary/20 transition-all duration-300 flex-shrink-0",
      collapsed ? "w-10" : "w-52"
    )}>
      {/* Header */}
      <div className={cn(
        "h-14 flex items-center border-b border-border flex-shrink-0",
        collapsed ? "justify-center px-0" : "justify-between px-3"
      )}>
        {!collapsed && (
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Chats</span>
        )}
        <div className="flex items-center gap-1">
          {!collapsed && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onNew} title="New chat">
              <Plus className="w-3.5 h-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setCollapsed(v => !v)}
            title={collapsed ? "Expand" : "Collapse"}
          >
            {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </Button>
        </div>
      </div>

      {/* List */}
      {!collapsed && (
        <div className="flex-1 overflow-auto py-2">
          {loading ? (
            <div className="space-y-1 px-2">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-8 bg-secondary animate-pulse rounded-md" />
              ))}
            </div>
          ) : visibleConversations.length === 0 ? (
            <div className="px-3 py-6 text-center">
              <MessageSquare className="w-6 h-6 text-muted-foreground mx-auto mb-2 opacity-40" />
              <p className="text-xs text-muted-foreground">No chats yet</p>
            </div>
          ) : (
            Object.entries(groups).map(([label, convs]) => {
              if (!convs.length) return null;
              return (
                <div key={label} className="mb-3">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-3 mb-1">
                    {label}
                  </p>
                  {convs.map(conv => (
                    <div
                      key={conv.id}
                      className={cn(
                        "group flex items-center gap-1 mx-1 rounded-md transition-colors",
                        conv.id === activeConversationId
                          ? "bg-foreground text-background"
                          : "hover:bg-secondary"
                      )}
                    >
                      {editingId === conv.id ? (
                        <div className="flex items-center flex-1 px-2 py-1">
                          <input
                            ref={editRef}
                            value={editValue}
                            onChange={e => setEditValue(e.target.value)}
                            onBlur={() => commitEdit(conv.id)}
                            onKeyDown={e => {
                              if (e.key === "Enter") commitEdit(conv.id);
                              if (e.key === "Escape") setEditingId(null);
                            }}
                            className="flex-1 text-xs bg-transparent outline-none border-b border-current min-w-0"
                          />
                          <button onClick={() => commitEdit(conv.id)} className="ml-1 flex-shrink-0">
                            <Check className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => onSelect(conv.id)}
                          className="flex items-center gap-2 flex-1 px-2 py-2 text-xs text-left truncate min-w-0"
                        >
                          <MessageSquare className="w-3 h-3 flex-shrink-0 opacity-60" />
                          <span className="truncate">{getTitle(conv)}</span>
                        </button>
                      )}
                      {editingId !== conv.id && (
                        <div className="opacity-0 group-hover:opacity-100 flex-shrink-0 pr-1">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                onClick={e => e.stopPropagation()}
                                className={cn("p-0.5 rounded hover:bg-black/10", conv.id === activeConversationId ? "text-background" : "text-foreground")}
                              >
                                <MoreHorizontal className="w-3 h-3" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="min-w-[120px]">
                              <DropdownMenuItem onClick={e => startEdit(conv, e)}>
                                <Pencil className="w-3 h-3 mr-2" /> Rename
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={e => handleDelete(conv.id, e)} className="text-destructive">
                                <Trash2 className="w-3 h-3 mr-2" /> Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* New chat button when collapsed */}
      {collapsed && (
        <div className="py-2 flex flex-col items-center gap-2">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onNew} title="New chat">
            <Plus className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}
