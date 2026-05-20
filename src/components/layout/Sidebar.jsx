import { Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  MessageSquare,
  Target,
  Users,
  ChevronLeft,
  ChevronRight,
  ContactRound,
  Mail,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";

const navItems = [
  { path: "/", label: "AI Analyst", icon: MessageSquare },
  { path: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { path: "/campaigns", label: "UTM", icon: Target },
  { path: "/edm", label: "Email", icon: Mail },
  { path: "/profiles", label: "Profiles", icon: ContactRound },
  { path: "/segments", label: "Segments", icon: Users },
];

export default function Sidebar() {
  const location = useLocation();
  const isAnalyst = location.pathname === "/";
  const [collapsed, setCollapsed] = useState(isAnalyst);

  return (
    <aside className={cn(
      "h-screen border-r border-border flex flex-col transition-all duration-300 bg-background",
      collapsed ? "w-16" : "w-60"
    )}>
      <div className={cn(
        "h-16 flex items-center border-b border-border px-4",
        collapsed ? "justify-center" : "justify-between"
      )}>
        {!collapsed && (
          <span className="font-heading text-lg font-semibold tracking-tight">
            Click
          </span>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1.5 rounded-md hover:bg-secondary transition-colors text-muted-foreground"
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      <nav className="flex-1 py-4 px-2 space-y-0.5">
        {navItems.map((item) => {
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
            >
              <item.icon className="w-4 h-4 flex-shrink-0" />
              {!collapsed && <span className="font-medium">{item.label}</span>}
            </Link>
          );
        })}
      </nav>

    </aside>
  );
}
