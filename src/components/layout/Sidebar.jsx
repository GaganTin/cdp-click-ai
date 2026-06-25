import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, MessageSquare, Target, Users,
  ChevronLeft, ChevronRight, ContactRound, Mail, Plug,
  ChevronDown, Building2, LogOut,
  Check, Plus, Settings, MousePointer2, Tag, Rocket, Upload, ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/lib/AuthContext";
import { usePreferences } from "@/lib/PreferencesContext";
import NotificationBell from "./NotificationBell";

const navGroups = [
  {
    items: [
      { path: "/",         label: "AI Analyst", icon: MessageSquare },
      { path: "/dashboard",label: "Dashboard",  icon: LayoutDashboard },
    ],
  },
  {
    label: "Campaigns",
    items: [
      { path: "/edm",      label: "Email",  icon: Mail },
      { path: "/popup",    label: "Pop Up", icon: MousePointer2 },
      { path: "/utm",      label: "UTM",    icon: Target },
    ],
  },
  {
    label: "Audience",
    items: [
      { path: "/profiles",   label: "Profiles",    icon: ContactRound },
      { path: "/segments",   label: "Segments",    icon: Users },
      { path: "/attributes", label: "Attributes",  icon: Tag },
    ],
  },
  {
    label: "Tools",
    items: [
      { path: "/integrations", label: "Integrations", icon: Plug },
      { path: "/import-export",  label: "Import / Export",  icon: Upload },
    ],
  },
];

function Avatar({ name, url, size = "sm" }) {
  const sz = size === "sm" ? "w-7 h-7 text-xs" : "w-8 h-8 text-sm";
  if (url) {
    return <img src={url} alt={name} className={`${sz} rounded-full object-cover flex-shrink-0`} />;
  }
  return (
    <div className={`${sz} rounded-full bg-primary/20 text-primary font-medium flex items-center justify-center flex-shrink-0`}>
      {(name || "?")[0].toUpperCase()}
    </div>
  );
}

function Dropdown({ children, trigger, align = "left" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <div onClick={() => setOpen(o => !o)}>{trigger}</div>
      {open && (
        <div
          className={cn(
            "absolute z-50 bottom-full mb-1 bg-popover border border-border rounded-lg shadow-lg py-1 min-w-[180px]",
            align === "left" ? "left-0" : "right-0"
          )}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function DropdownItem({ icon: Icon, label, onClick, destructive, active }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left hover:bg-secondary transition-colors",
        destructive && "text-destructive hover:text-destructive",
        active && "font-medium"
      )}
    >
      {Icon && <Icon className="w-3.5 h-3.5 flex-shrink-0" />}
      <span className="flex-1">{label}</span>
      {active && <Check className="w-3 h-3" />}
    </button>
  );
}

export default function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, currentCompany, logout, switchCompany } = useAuth();
  const queryClient = useQueryClient();
  const { t } = usePreferences();
  const isAnalyst = location.pathname === "/";
  const [collapsed, setCollapsed] = useState(isAnalyst);

  const companies = user?.companies || [];

  return (
    <aside className={cn(
      "h-full border-r border-border flex flex-col transition-all duration-300 bg-background",
      collapsed ? "w-16" : "w-60"
    )}>
      {/* Top: Meritma branding */}
      <div className={cn(
        "h-14 flex items-center border-b border-border px-3 gap-2 flex-shrink-0",
        collapsed && "justify-center"
      )}>
        {!collapsed && (
          <span className="font-heading font-bold text-base tracking-tight flex-1 select-none">
            Meritma
          </span>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1.5 rounded-md hover:bg-secondary transition-colors text-muted-foreground flex-shrink-0"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 min-h-0 py-3 px-2 overflow-y-auto">
        {navGroups.map((group, gi) => (
          <div key={gi} className={cn("space-y-0.5", gi > 0 && "mt-4")}>
            {group.label && !collapsed && (
              <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 select-none">
                {t(group.label)}
              </p>
            )}
            {group.label && collapsed && gi > 0 && (
              <div className="border-t border-border/50 my-2 mx-1" />
            )}
            {group.items.map((item) => {
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                  )}
                  title={collapsed ? item.label : undefined}
                >
                  <item.icon className="w-4 h-4 flex-shrink-0" />
                  {!collapsed && <span className="font-medium">{t(item.label)}</span>}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Footer: notifications + company switcher + user menu */}
      <div className="border-t border-border p-2 space-y-0.5 flex-shrink-0">
        {/* Notifications bell */}
        <NotificationBell collapsed={collapsed} />

        {/* Company switcher */}
        {!collapsed ? (
          <Dropdown
            trigger={
              <button className="w-full flex items-center gap-2 px-3 py-2.5 rounded-md hover:bg-secondary transition-colors">
                {currentCompany?.logo_url ? (
                  <img src={currentCompany.logo_url} alt="" className="w-4 h-4 rounded flex-shrink-0 object-cover" />
                ) : (
                  <Building2 className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                )}
                <span className="text-sm font-medium truncate flex-1 text-left text-muted-foreground">
                  {currentCompany?.name || "Select workspace"}
                </span>
                <ChevronDown className="w-3 h-3 text-muted-foreground flex-shrink-0" />
              </button>
            }
          >
            <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {t("Workspaces")}
            </div>
            {companies.map(c => (
              <DropdownItem
                key={c.id}
                icon={Building2}
                label={c.name}
                active={c.id === currentCompany?.id}
                onClick={() => { switchCompany(c); queryClient.clear(); }}
              />
            ))}
            <div className="border-t border-border mt-1 pt-1">
              <DropdownItem
                icon={Plus}
                label={t("Add workspace")}
                onClick={() => navigate("/companies")}
              />
            </div>
          </Dropdown>
        ) : (
          <button
            onClick={() => navigate("/companies")}
            className="flex items-center justify-center p-2.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors w-full"
            title={currentCompany?.name || "Switch workspace"}
          >
            {currentCompany?.logo_url ? (
              <img src={currentCompany.logo_url} alt="" className="w-4 h-4 rounded object-cover" />
            ) : (
              <Building2 className="w-4 h-4" />
            )}
          </button>
        )}

        {/* User profile menu */}
        {!collapsed ? (
          <Dropdown
            trigger={
              <button className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md hover:bg-secondary transition-colors">
                <Avatar name={user?.full_name || user?.email} url={user?.avatar_url} />
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-sm font-medium truncate">{user?.full_name || user?.email}</p>
                  <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
                </div>
                <ChevronDown className="w-3 h-3 text-muted-foreground flex-shrink-0" />
              </button>
            }
          >
            <div className="px-3 py-1.5 border-b border-border">
              <p className="text-sm font-medium truncate">{user?.full_name}</p>
              <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
            </div>
            <DropdownItem icon={Settings} label={t("Settings")} onClick={() => navigate("/settings")} />
            <DropdownItem icon={Rocket} label={t("Get Started")} onClick={() => navigate("/get-started")} />
            {user?.is_platform_admin && (
              <DropdownItem icon={ShieldCheck} label={t("Studio")} onClick={() => navigate("/studio")} />
            )}
            <div className="border-t border-border mt-1 pt-1">
              <DropdownItem icon={LogOut} label={t("Sign out")} destructive onClick={logout} />
            </div>
          </Dropdown>
        ) : (
          <button
            onClick={logout}
            className="flex items-center justify-center p-2.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors w-full"
            title="Sign out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        )}
      </div>
    </aside>
  );
}
