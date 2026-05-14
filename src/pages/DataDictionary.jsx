import { useState } from "react";
import { appClient } from "@/api/appClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, BookOpen, ChevronDown, ChevronRight, MoreHorizontal, Trash2, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "sonner";

export default function DataDictionary() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ table_name: "", schema_name: "public", description: "" });
  const [expandedTable, setExpandedTable] = useState(null);
  const queryClient = useQueryClient();

  const { data: tables = [], isLoading } = useQuery({
    queryKey: ["dataDictionary"],
    queryFn: () => appClient.entities.DataDictionary.list("table_name"),
  });

  const createMutation = useMutation({
    mutationFn: (data) => appClient.entities.DataDictionary.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dataDictionary"] });
      setOpen(false);
      setForm({ table_name: "", schema_name: "public", description: "" });
      toast.success("Table added");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => appClient.entities.DataDictionary.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dataDictionary"] }),
  });

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-heading text-3xl font-semibold tracking-tight">Data Dictionary</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Document your database schema to help the AI Analyst understand your data.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5 h-9">
              <Plus className="w-3.5 h-3.5" /> Add Table
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="font-heading">Add Table</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-2">
              <div>
                <Label className="text-xs">Table Name</Label>
                <Input value={form.table_name} onChange={(e) => setForm({ ...form, table_name: e.target.value })} placeholder="ga_sessions" className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">Schema</Label>
                <Input value={form.schema_name} onChange={(e) => setForm({ ...form, schema_name: e.target.value })} className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">Description</Label>
                <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Describe what this table contains..." className="mt-1" rows={3} />
              </div>
              <Button onClick={() => createMutation.mutate(form)} disabled={!form.table_name || createMutation.isPending} className="w-full">
                Add Table
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-16 bg-secondary animate-pulse rounded-lg" />)}
        </div>
      ) : tables.length === 0 ? (
        <div className="border border-dashed border-border rounded-lg p-12 text-center">
          <Database className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm font-medium mb-1">No tables documented</p>
          <p className="text-xs text-muted-foreground">Add your database tables to help the AI Analyst understand your data structure.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {tables.map((table) => (
            <Collapsible
              key={table.id}
              open={expandedTable === table.id}
              onOpenChange={() => setExpandedTable(expandedTable === table.id ? null : table.id)}
            >
              <div className="border border-border rounded-lg overflow-hidden">
                <CollapsibleTrigger className="w-full flex items-center justify-between p-4 hover:bg-secondary/50 transition-colors">
                  <div className="flex items-center gap-3">
                    {expandedTable === table.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    <div className="text-left">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-mono font-semibold">{table.schema_name}.{table.table_name}</span>
                        {table.columns?.length > 0 && (
                          <Badge variant="secondary" className="text-[10px] h-5">{table.columns.length} columns</Badge>
                        )}
                      </div>
                      {table.description && (
                        <p className="text-xs text-muted-foreground mt-0.5">{table.description}</p>
                      )}
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => e.stopPropagation()}>
                        <MoreHorizontal className="w-3.5 h-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => deleteMutation.mutate(table.id)} className="text-destructive">
                        <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="border-t border-border p-4">
                    {table.columns?.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-left text-muted-foreground border-b border-border">
                              <th className="pb-2 pr-4 font-medium">Column</th>
                              <th className="pb-2 pr-4 font-medium">Type</th>
                              <th className="pb-2 pr-4 font-medium">Nullable</th>
                              <th className="pb-2 font-medium">Description</th>
                            </tr>
                          </thead>
                          <tbody>
                            {table.columns.map((col, i) => (
                              <tr key={i} className="border-b border-border/50 last:border-0">
                                <td className="py-2 pr-4 font-mono font-medium">
                                  {col.is_primary_key && <span className="text-muted-foreground mr-1">🔑</span>}
                                  {col.name}
                                </td>
                                <td className="py-2 pr-4 text-muted-foreground font-mono">{col.data_type}</td>
                                <td className="py-2 pr-4 text-muted-foreground">{col.is_nullable ? "Yes" : "No"}</td>
                                <td className="py-2 text-muted-foreground">{col.description || "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">No columns documented yet. The AI Analyst can auto-detect columns from your database.</p>
                    )}
                    {table.sample_queries?.length > 0 && (
                      <div className="mt-4">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Sample Queries</p>
                        {table.sample_queries.map((q, i) => (
                          <pre key={i} className="bg-secondary rounded-md p-2 text-[10px] font-mono mb-1 overflow-x-auto">{q}</pre>
                        ))}
                      </div>
                    )}
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          ))}
        </div>
      )}
    </div>
  );
}
