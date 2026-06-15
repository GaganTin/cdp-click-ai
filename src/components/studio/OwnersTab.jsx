import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { appClient } from "@/api/appClient";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Crown, Search, ShieldCheck, Users, UserPlus, Clock, X } from "lucide-react";
import { fmtRelative } from "./helpers.jsx";

// One table of users with a promote/demote toggle. Reused for both the platform
// owners group and the everyone-else group.
function UserTable({ users, loading, currentUserId, onToggle, pending, emptyText }) {
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-secondary/40 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="text-left font-medium px-4 py-2.5">User</th>
            <th className="text-left font-medium px-4 py-2.5">Account</th>
            <th className="text-left font-medium px-4 py-2.5">Last action</th>
            <th className="text-left font-medium px-4 py-2.5">Last login</th>
            <th className="text-right font-medium px-4 py-2.5">Platform owner</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={5} className="px-4 py-6 text-muted-foreground">Loading…</td></tr>
          ) : !users.length ? (
            <tr><td colSpan={5} className="px-4 py-6 text-muted-foreground">{emptyText}</td></tr>
          ) : users.map((u) => {
            const isSelf = u.id === currentUserId;
            return (
              <tr key={u.id} className="border-t border-border hover:bg-secondary/20">
                <td className="px-4 py-2.5">
                  <div className="font-medium flex items-center gap-1.5">
                    {u.full_name || u.email}
                    {u.is_platform_admin && <Crown className="w-3 h-3 text-foreground" />}
                    {isSelf && <span className="text-[10px] text-muted-foreground">(you)</span>}
                  </div>
                  <div className="text-xs text-muted-foreground">{u.email}</div>
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">{u.account_name || "-"}</td>
                <td className="px-4 py-2.5 text-muted-foreground">
                  {u.last_action ? <span>{u.last_action} · {fmtRelative(u.last_action_at)}</span> : "-"}
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">{fmtRelative(u.last_login_at)}</td>
                <td className="px-4 py-2.5 text-right">
                  <Switch
                    checked={!!u.is_platform_admin}
                    disabled={isSelf || pending}
                    onCheckedChange={(v) => onToggle(u, v)}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Manage platform owners: invite by email, promote/demote existing users. Server
// enforces you can't demote yourself or the last remaining owner. Owners are
// grouped at the top; everyone else sits in a separate table below.
export default function OwnersTab({ currentUserId }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");

  const { data: users, isLoading } = useQuery({
    queryKey: ["admin", "users", search],
    queryFn: () => appClient.admin.listUsers(search),
  });
  const { data: invites } = useQuery({
    queryKey: ["admin", "owner-invites"],
    queryFn: () => appClient.admin.listOwnerInvites(),
  });

  const toggle = useMutation({
    mutationFn: ({ id, is_platform_admin }) => appClient.admin.updateUser(id, { is_platform_admin }),
    onSuccess: (u) => {
      toast.success(`${u.email} is ${u.is_platform_admin ? "now a platform owner" : "no longer an owner"}`);
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onError: (e) => toast.error(e.message || "Update failed"),
  });

  const invite = useMutation({
    mutationFn: (email) => appClient.admin.inviteOwner(email),
    onSuccess: (r) => {
      const msg = {
        already_owner: "That user is already an owner",
        promoted: "User promoted to platform owner",
        invited: "Invite saved — they'll become an owner when they sign up",
      }[r.status] || "Done";
      toast.success(msg);
      setInviteEmail("");
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
      qc.invalidateQueries({ queryKey: ["admin", "owner-invites"] });
    },
    onError: (e) => toast.error(e.message || "Invite failed"),
  });

  const cancelInvite = useMutation({
    mutationFn: (email) => appClient.admin.cancelOwnerInvite(email),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "owner-invites"] }),
    onError: (e) => toast.error(e.message || "Failed"),
  });

  const list = users || [];
  const owners = list.filter((u) => u.is_platform_admin);
  const others = list.filter((u) => !u.is_platform_admin);
  const onToggle = (u, v) => toggle.mutate({ id: u.id, is_platform_admin: v });

  return (
    <div className="space-y-8">
      {/* Invite by email */}
      <section className="space-y-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><UserPlus className="w-4 h-4" /> Invite an owner</h3>
        <form
          onSubmit={(e) => { e.preventDefault(); if (inviteEmail.trim()) invite.mutate(inviteEmail.trim()); }}
          className="flex items-center gap-2 max-w-lg"
        >
          <Input type="email" placeholder="name@company.com" value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)} className="h-9" />
          <Button type="submit" disabled={!inviteEmail.trim() || invite.isPending} className="h-9 whitespace-nowrap">
            {invite.isPending ? "Inviting…" : "Invite owner"}
          </Button>
        </form>
        <p className="text-xs text-muted-foreground">
          Existing users are promoted immediately. New emails are saved and promoted automatically when they sign up.
        </p>

        {invites?.length > 0 && (
          <div className="space-y-1.5 pt-1">
            <p className="text-xs font-medium text-muted-foreground">Pending invites</p>
            {invites.map((iv) => (
              <div key={iv.email} className="flex items-center justify-between border border-border rounded-lg px-3 py-2 max-w-lg">
                <span className="text-sm flex items-center gap-2"><Clock className="w-3.5 h-3.5 text-muted-foreground" /> {iv.email}</span>
                <button onClick={() => cancelInvite.mutate(iv.email)}
                  className="p-1 rounded-md hover:bg-secondary text-muted-foreground" title="Cancel invite">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* search */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Owners can manage every client, plan and other owners. Toggle the switch to promote or demote.
        </p>
        <div className="relative w-64">
          <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search users…" value={search}
            onChange={(e) => setSearch(e.target.value)} className="pl-8 h-9" />
        </div>
      </div>

      {/* Platform owners */}
      <section className="space-y-2.5">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck className="w-4 h-4" /> Platform owners
          {!isLoading && <span className="text-muted-foreground font-normal">({owners.length})</span>}
        </h3>
        <UserTable users={owners} loading={isLoading} currentUserId={currentUserId}
          onToggle={onToggle} pending={toggle.isPending}
          emptyText={search ? "No platform owners match your search." : "No platform owners yet."} />
      </section>

      {/* Everyone else */}
      <section className="space-y-2.5">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Users className="w-4 h-4" /> All other users
          {!isLoading && <span className="text-muted-foreground font-normal">({others.length})</span>}
        </h3>
        <UserTable users={others} loading={isLoading} currentUserId={currentUserId}
          onToggle={onToggle} pending={toggle.isPending} emptyText="No users found." />
      </section>
    </div>
  );
}
