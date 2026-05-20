import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { appClient } from "@/api/appClient";
import {
  MessageSquare, LayoutDashboard, Mail, Users,
  Target, Zap, Shield, ArrowRight, Check, ChevronRight,
  BarChart2, Brain, Globe, Loader2,
} from "lucide-react";

// ── Shared ────────────────────────────────────────────────────────────────────

function Logo() {
  return (
    <div className="flex items-center gap-2">
      <span className="font-bold text-lg tracking-tight">Click CDP</span>
    </div>
  );
}

// ── Nav ───────────────────────────────────────────────────────────────────────

function Nav() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/80 backdrop-blur-sm">
      <div className="max-w-7xl mx-auto px-6 sm:px-10 h-16 grid grid-cols-3 items-center">
        {/* Left - logo */}
        <Logo />

        {/* Center - nav links, always exactly centered */}
        <nav className="hidden md:flex items-center justify-center gap-8 text-sm text-muted-foreground">
          <a href="#features" className="hover:text-foreground transition-colors">Features</a>
          <a href="#how-it-works" className="hover:text-foreground transition-colors">How it works</a>
          <a href="#pricing" className="hover:text-foreground transition-colors">Pricing</a>
        </nav>

        {/* Right - auth buttons */}
        <div className="flex items-center justify-end gap-3">
          <Link
            to="/login"
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Sign in
          </Link>
          <Link
            to="/register"
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors"
          >
            Get started free
            <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </header>
  );
}

// ── Hero ──────────────────────────────────────────────────────────────────────

function Hero() {
  return (
    <section className="relative pt-24 pb-20 px-4 sm:px-6 overflow-hidden">
      {/* Background gradients */}
      <div className="absolute inset-0 -z-10 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] rounded-full bg-primary/5 blur-3xl" />
      </div>

      <div className="max-w-4xl mx-auto text-center">

        <h1 className="text-5xl sm:text-6xl font-bold tracking-tight leading-tight">
          Know your customers.
          <br />
          <span className="text-primary">Grow your business.</span>
        </h1>

        <p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
          Click is the AI-powered Customer Data Platform that unifies profiles,
          automates email campaigns, and lets you ask questions about your data in plain English.
        </p>

        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            to="/register"
            className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:bg-primary/90 transition-colors w-full sm:w-auto justify-center"
          >
            Start for free
            <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            to="/login"
            className="inline-flex items-center gap-2 px-6 py-3 border border-border text-sm font-medium rounded-lg hover:bg-secondary transition-colors w-full sm:w-auto justify-center"
          >
            Sign in to workspace
          </Link>
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          No credit card required
        </p>
      </div>

      {/* Dashboard preview */}
      <div className="mt-16 max-w-5xl mx-auto">
        <div className="relative rounded-xl border border-border bg-card shadow-2xl overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-background/60 pointer-events-none z-10" />
          {/* Fake browser chrome */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-secondary/30">
            <div className="w-3 h-3 rounded-full bg-red-400/70" />
            <div className="w-3 h-3 rounded-full bg-yellow-400/70" />
            <div className="w-3 h-3 rounded-full bg-green-400/70" />
            <div className="flex-1 mx-4 h-6 rounded-md bg-background/80 border border-border" />
          </div>
          {/* Mock app UI */}
          <div className="p-6 grid grid-cols-12 gap-4 h-64">
            {/* Sidebar */}
            <div className="col-span-2 space-y-2">
              {["AI Analyst", "Dashboard", "Campaigns", "Email", "Profiles"].map(l => (
                <div key={l} className={`h-7 rounded-md text-xs flex items-center px-2 ${l === "AI Analyst" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
                  {l}
                </div>
              ))}
            </div>
            {/* Main content */}
            <div className="col-span-10 space-y-3">
              {/* Chat */}
              <div className="flex gap-3">
                <div className="flex-1 h-10 rounded-lg border border-border bg-secondary/30 px-4 flex items-center text-xs text-muted-foreground">
                  How many customers signed up this month?
                </div>
              </div>
              <div className="h-24 rounded-lg border border-border bg-secondary/30 p-3">
                <div className="h-3 w-1/2 rounded bg-border mb-2" />
                <div className="h-3 w-3/4 rounded bg-border mb-2" />
                <div className="h-3 w-2/5 rounded bg-border" />
              </div>
              {/* Stats */}
              <div className="grid grid-cols-3 gap-3">
                {[["2,847", "Active customers"], ["94.2%", "Email open rate"], ["$48K", "Revenue tracked"]].map(([v, l]) => (
                  <div key={l} className="rounded-lg border border-border bg-secondary/30 p-3">
                    <div className="text-sm font-bold">{v}</div>
                    <div className="text-xs text-muted-foreground">{l}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Features ──────────────────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: Brain,
    title: "AI Analyst",
    description: "Ask questions about your customers in plain English. No SQL, no dashboards to configure - just answers.",
    tag: "Popular",
  },
  {
    icon: BarChart2,
    title: "Unified Dashboard",
    description: "Pin the charts that matter to you. Track KPIs, segment performance, and campaign ROI at a glance.",
  },
  {
    icon: Mail,
    title: "Email Campaigns",
    description: "Build, schedule, and track email campaigns with open rates, clicks, and unsubscribes in real time.",
  },
  {
    icon: Users,
    title: "Audience Segments",
    description: "Create dynamic audience segments from customer attributes, behaviour, and web activity. Always up to date.",
  },
  {
    icon: Target,
    title: "UTM Tracking",
    description: "Build UTM links, track campaign performance, and see which channels drive conversions.",
  },
  {
    icon: Globe,
    title: "Integrations",
    description: "Connect your existing tools - CRM, GA4, email providers - and let Click stitch them together.",
  },
];

function Features() {
  return (
    <section id="features" className="py-24 px-4 sm:px-6 bg-secondary/20">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">Everything in one place</h2>
          <p className="mt-4 text-muted-foreground max-w-xl mx-auto">
            From raw data to customer insights, Click handles the entire journey so your team can focus on growth.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {FEATURES.map((f) => (
            <div key={f.title} className="relative p-6 rounded-xl border border-border bg-background hover:border-primary/30 transition-colors group">
              {f.tag && (
                <span className="absolute top-4 right-4 px-2 py-0.5 text-xs font-medium bg-primary/10 text-primary rounded-full">
                  {f.tag}
                </span>
              )}
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                <f.icon className="w-5 h-5 text-primary" />
              </div>
              <h3 className="font-semibold mb-2">{f.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{f.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── How it works ──────────────────────────────────────────────────────────────

const STEPS = [
  {
    n: "01",
    title: "Connect your data",
    desc: "Plug in your CRM, GA4, or import a CSV. Click builds unified customer profiles automatically.",
  },
  {
    n: "02",
    title: "Explore with AI",
    desc: "Ask the AI Analyst anything - \"Which customers haven't purchased in 90 days?\" - and get instant answers.",
  },
  {
    n: "03",
    title: "Act on insights",
    desc: "Launch targeted email campaigns, build segments, and track UTM performance - all from one platform.",
  },
];

function HowItWorks() {
  return (
    <section id="how-it-works" className="py-24 px-4 sm:px-6">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">Up and running in minutes</h2>
          <p className="mt-4 text-muted-foreground">No data engineering degree required.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {STEPS.map((s, i) => (
            <div key={s.n} className="relative">
              {i < STEPS.length - 1 && (
                <div className="hidden md:block absolute top-6 left-full w-full h-px border-t border-dashed border-border" style={{ width: "calc(100% - 3rem)", left: "100%" }} />
              )}
              <div className="text-4xl font-bold text-primary/20 mb-4 font-mono">{s.n}</div>
              <h3 className="font-semibold text-lg mb-2">{s.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Pricing ───────────────────────────────────────────────────────────────────

function Pricing() {
  const { data: plans = [], isLoading } = useQuery({
    queryKey: ["plans"],
    queryFn: appClient.plans.list,
    staleTime: 10 * 60 * 1000,
  });

  return (
    <section id="pricing" className="py-24 px-4 sm:px-6 bg-secondary/20">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">Simple, transparent pricing</h2>
          <p className="mt-4 text-muted-foreground">Start free, scale when you need to.</p>
        </div>
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {plans.map((p) => (
              <div
                key={p.id}
                className={`relative p-6 rounded-xl border flex flex-col ${
                  p.is_highlighted
                    ? "border-primary bg-primary text-primary-foreground shadow-xl"
                    : "border-border bg-background"
                }`}
              >
                {p.is_highlighted && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-primary-foreground text-primary text-xs font-bold rounded-full border border-primary/20">
                    Most popular
                  </div>
                )}
                <div className="mb-6">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className={`font-semibold text-lg ${p.is_highlighted ? "text-primary-foreground" : ""}`}>{p.name}</h3>
                    {p.badge && (
                      <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                        {p.badge}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex items-baseline gap-1">
                    <span className="text-3xl font-bold">{p.price_display}</span>
                    {p.period && (
                      <span className={`text-sm ${p.is_highlighted ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                        {p.period}
                      </span>
                    )}
                  </div>
                  <p className={`mt-2 text-sm ${p.is_highlighted ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
                    {p.description}
                  </p>
                </div>
                <ul className="space-y-2.5 flex-1 mb-6">
                  {(p.features ?? []).map(f => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <Check className={`w-4 h-4 mt-0.5 flex-shrink-0 ${p.is_highlighted ? "text-primary-foreground" : "text-primary"}`} />
                      <span className={p.is_highlighted ? "text-primary-foreground/90" : ""}>{f}</span>
                    </li>
                  ))}
                </ul>
                {p.cta_external ? (
                  <a
                    href={p.cta_href}
                    className={`block text-center py-2.5 rounded-lg text-sm font-semibold transition-colors ${
                      p.is_highlighted
                        ? "bg-primary-foreground text-primary hover:bg-primary-foreground/90"
                        : "bg-primary text-primary-foreground hover:bg-primary/90"
                    }`}
                  >
                    {p.cta_label}
                  </a>
                ) : (
                  <Link
                    to={p.cta_href}
                    className={`block text-center py-2.5 rounded-lg text-sm font-semibold transition-colors ${
                      p.is_highlighted
                        ? "bg-primary-foreground text-primary hover:bg-primary-foreground/90"
                        : "bg-primary text-primary-foreground hover:bg-primary/90"
                    }`}
                  >
                    {p.cta_label}
                  </Link>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// ── CTA Banner ────────────────────────────────────────────────────────────────

function CTABanner() {
  return (
    <section className="py-24 px-4 sm:px-6">
      <div className="max-w-3xl mx-auto text-center">
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
          Ready to understand your customers?
        </h2>
        <p className="mt-4 text-muted-foreground">
          Join teams using Click to turn raw data into revenue. Free to start, no engineers required.
        </p>
        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            to="/register"
            className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:bg-primary/90 transition-colors"
          >
            Create free account
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}

// ── Footer ────────────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer className="border-t border-border py-12 px-6 sm:px-10">
      <div className="max-w-7xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8">
        <div className="col-span-2 md:col-span-1">
          <Logo />
          <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
            Customer Data Platform for modern marketing teams.
          </p>
        </div>
        {[
          {
            title: "Product",
            links: [
              { label: "Features", href: "#features" },
              { label: "How it works", href: "#how-it-works" },
              { label: "Pricing", href: "#pricing" },
            ],
          },
          {
            title: "Account",
            links: [
              { label: "Sign in", href: "/login", isLink: true },
              { label: "Create account", href: "/register", isLink: true },
            ],
          },
          {
            title: "Legal",
            links: [
              { label: "Privacy", href: "/privacy" },
              { label: "Terms", href: "/terms" },
            ],
          },
        ].map(col => (
          <div key={col.title}>
            <h4 className="text-sm font-semibold mb-3">{col.title}</h4>
            <ul className="space-y-2">
              {col.links.map(l => (
                <li key={l.label}>
                  {l.isLink ? (
                    <Link to={l.href} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                      {l.label}
                    </Link>
                  ) : (
                    <a href={l.href} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                      {l.label}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="max-w-7xl mx-auto mt-8 pt-8 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>© {new Date().getFullYear()} Click CDP. All rights reserved.</span>
      </div>
    </footer>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <Nav />
      <main>
        <Hero />
        <Features />
        <HowItWorks />
        <Pricing />
        <CTABanner />
      </main>
      <Footer />
    </div>
  );
}
