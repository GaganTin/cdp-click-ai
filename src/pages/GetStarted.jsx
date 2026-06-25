import { Link } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import {
  Plug, ContactRound, Mail, MessageSquare, ArrowRight,
  LayoutDashboard, MousePointer2, Target, Users, Tag, Upload, Megaphone,
} from "lucide-react";

// ── Onboarding flow - each step links to the pages that complete it ─────────
const STEPS = [
  {
    icon: Plug,
    title: "Connect your data",
    desc: "Bring customer and visitor data into Meritma. Sync it automatically from a connected source like Google Analytics or Shopify, upload it yourself from a file, or do both.",
    links: [
      { to: "/integrations",  icon: Plug,   label: "Integrations" },
      { to: "/import-export", icon: Upload, label: "Manual upload" },
    ],
  },
  {
    icon: ContactRound,
    title: "Know your audience",
    desc: "Explore unified profiles that merge every touchpoint per person, then enrich them with custom attributes for sharper targeting.",
    links: [
      { to: "/profiles",   icon: ContactRound, label: "Profiles" },
      { to: "/attributes", icon: Tag,          label: "Attributes" },
    ],
  },
  {
    icon: Users,
    title: "Segment your audience",
    desc: "Group profiles into targeted segments by behaviour, attributes, or source - these are the audiences you'll send campaigns to.",
    links: [
      { to: "/segments", icon: Users, label: "Segments" },
    ],
  },
  {
    icon: Megaphone,
    title: "Engage your audience",
    desc: "Reach a segment in two ways: show on-site pop ups to visitors as they browse, or send targeted email campaigns. Add UTM links to either so you can measure exactly what's working.",
    links: [
      { to: "/popup", icon: MousePointer2, label: "Pop Up" },
      { to: "/edm",   icon: Mail,          label: "Email" },
      { to: "/utm",   icon: Target,        label: "UTM tracking" },
    ],
  },
  {
    icon: MessageSquare,
    title: "Ask the AI Analyst",
    desc: "Your data AI Assistant - just ask in plain language. Generate graphs and pin them to your dashboard, build segments, draft pop ups and email campaigns, and dig through all of your data. No SQL or spreadsheets needed.",
    links: [
      { to: "/", icon: MessageSquare, label: "Open AI Analyst" },
    ],
  },
];

// ── Compact directory of every workspace area ──────────────────────────────
const FEATURES = [
  { to: "/",             icon: MessageSquare,    label: "AI Analyst",  hint: "Chat with your data" },
  { to: "/dashboard",    icon: LayoutDashboard,  label: "Dashboard",   hint: "Pinned charts & KPIs" },
  { to: "/edm",          icon: Mail,             label: "Email",       hint: "Build & send campaigns" },
  { to: "/popup",        icon: MousePointer2,    label: "Pop Up",      hint: "On-site messages" },
  { to: "/utm",          icon: Target,           label: "UTM",         hint: "Track link performance" },
  { to: "/profiles",     icon: ContactRound,     label: "Profiles",    hint: "Unified customer records" },
  { to: "/segments",     icon: Users,            label: "Segments",    hint: "Group your audience" },
  { to: "/attributes",   icon: Tag,              label: "Attributes",  hint: "Custom targeting tags" },
  { to: "/integrations", icon: Plug,             label: "Integrations",hint: "Connect data sources" },
  { to: "/import-export",icon: Upload,           label: "Import / Export", hint: "Move data in & out" },
];

export default function GetStarted() {
  const { user } = useAuth();
  const firstName = (user?.full_name || "").trim().split(" ")[0];

  return (
    <div className="flex flex-col h-full">
      <div className="px-8 pt-8 pb-0 flex-shrink-0">
        <div className="mb-5">
          <h1 className="font-heading text-3xl font-semibold tracking-tight">Get Started</h1>
          <p className="text-sm text-muted-foreground mt-1">Your onboarding guide to Meritma.</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-8 pb-10">
        <div className="max-w-3xl space-y-8">
          {/* Welcome */}
          <div className="rounded-xl border border-border bg-secondary/20 p-6">
            <div className="space-y-1">
              <h2 className="font-heading text-lg font-semibold tracking-tight">
                Welcome{firstName ? `, ${firstName}` : ""} 
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Meritma brings every customer touchpoint into one place - so you can understand
                your audience and reach them with the right message. Follow the steps below to
                get up and running in minutes.
              </p>
            </div>
          </div>

          {/* Quick-start steps */}
          <div className="space-y-3">
            <h2 className="font-heading text-lg font-semibold tracking-tight">Quick start</h2>
            <div className="space-y-2.5">
              {STEPS.map((step, i) => (
                <div
                  key={step.title}
                  className="rounded-xl border border-border bg-background p-4 flex items-start gap-4"
                >
                  <div className="flex flex-col items-center gap-2 flex-shrink-0">
                    <span className="w-7 h-7 rounded-full bg-primary text-primary-foreground text-sm font-semibold flex items-center justify-center">
                      {i + 1}
                    </span>
                    {i < STEPS.length - 1 && <span className="w-px flex-1 min-h-4 bg-border" />}
                  </div>
                  <div className="flex-1 min-w-0 space-y-2.5">
                    <div className="flex items-center gap-2">
                      <step.icon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      <p className="text-sm font-semibold">{step.title}</p>
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed">{step.desc}</p>
                    <div className="flex flex-wrap gap-2 pt-0.5">
                      {step.links.map((link) => (
                        <Link
                          key={link.to + link.label}
                          to={link.to}
                          className="group inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/40 px-2.5 py-1 text-xs font-medium transition-colors hover:border-primary/40 hover:bg-secondary"
                        >
                          <link.icon className="w-3.5 h-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
                          {link.label}
                          <ArrowRight className="w-3 h-3 text-muted-foreground/50 group-hover:text-foreground group-hover:translate-x-0.5 transition-all" />
                        </Link>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Feature directory */}
          <div className="space-y-3">
            <h2 className="font-heading text-lg font-semibold tracking-tight">Explore everything</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {FEATURES.map((f) => (
                <Link
                  key={f.to + f.label}
                  to={f.to}
                  className="group flex items-center gap-3 rounded-lg border border-border bg-background px-3.5 py-3 transition-colors hover:border-primary/40 hover:bg-secondary/30"
                >
                  <div className="w-8 h-8 rounded-md bg-secondary flex items-center justify-center flex-shrink-0">
                    <f.icon className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{f.label}</p>
                    <p className="text-xs text-muted-foreground truncate">{f.hint}</p>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/40 group-hover:text-foreground transition-colors flex-shrink-0" />
                </Link>
              ))}
            </div>
          </div>

          {/* Help footer */}
          <p className="text-xs text-muted-foreground">
            Need a hand? Visit{" "}
            <Link to="/settings" className="text-foreground font-medium underline-offset-2 hover:underline">
              Settings
            </Link>{" "}
            to manage your workspace and team, or reach out to support any time.
          </p>
        </div>
      </div>
    </div>
  );
}
