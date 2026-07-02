import { ChevronDown, ChevronUp, Lightbulb, HelpCircle } from "lucide-react";
import { useStickyState } from "@/lib/useStickyState";
import { usePreferences } from "@/lib/PreferencesContext";

// Collapsible "How it works" guide shown at the top of a page.
//
// Unlike the empty-state guidance (which disappears once a page has data), this
// stays available so teammates who sign up later can still learn what a page is
// for. It defaults to collapsed (the user clicks to expand) and remembers a
// user's open/closed choice per browser via `storageKey`.
//
// Props:
//   storageKey - localStorage key for the open/closed state (required, unique per page)
//   title      - the guide heading (already translated)
//   intro      - one-paragraph "what this is" (already translated)
//   uses       - [{ icon, title, desc }]  "what you can do" cards (strings translated)
//   steps      - [{ title, desc }]  numbered "how to do it" walkthrough (strings translated)
//   stepsTitle - heading shown above the numbered steps (already translated)
//   sections   - [{ title, items: [{ icon, label, desc }] }]  extra explainer lists
//   footer     - optional closing note (already translated)
export default function PageGuide({ storageKey, title, intro, uses = [], steps = [], stepsTitle, sections = [], footer }) {
  const { t } = usePreferences();
  const [open, setOpen] = useStickyState(false, storageKey);

  return (
    <div className="border border-border rounded-lg mb-6 bg-secondary/10">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left"
      >
        <HelpCircle className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        <span className="text-sm font-semibold flex-1">{title}</span>
        <span className="text-[11px] text-muted-foreground mr-1">{open ? t("Hide") : t("Show")}</span>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4">
          {intro && (
            <p className="text-xs text-muted-foreground leading-relaxed max-w-2xl">{intro}</p>
          )}

          {steps.length > 0 && (
            <div className="space-y-2.5">
              {stepsTitle && <p className="text-xs font-semibold">{stepsTitle}</p>}
              <ol className="space-y-2.5">
                {steps.map((s, i) => (
                  <li key={s.title} className="flex gap-2.5">
                    <span className="w-5 h-5 rounded-full bg-foreground text-background text-[10px] font-semibold flex items-center justify-center flex-shrink-0 mt-0.5">
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-medium">{s.title}</p>
                      {s.desc && <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">{s.desc}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {uses.length > 0 && (
            <div className="rounded-lg bg-background border border-border p-4 space-y-3">
              <p className="text-xs font-semibold flex items-center gap-1.5">
                <Lightbulb className="w-3.5 h-3.5 text-muted-foreground" /> {t("What you can do")}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {uses.map((u) => (
                  <div key={u.title} className="space-y-1">
                    <u.icon className="w-4 h-4 text-muted-foreground" />
                    <p className="text-xs font-medium">{u.title}</p>
                    <p className="text-[11px] text-muted-foreground leading-snug">{u.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {sections.map((sec) => (
            <div key={sec.title} className="space-y-2">
              <p className="text-xs font-semibold">{sec.title}</p>
              <ul className="space-y-1.5 text-[11px] text-muted-foreground">
                {sec.items.map((it) => (
                  <li key={it.label} className="flex gap-2">
                    <it.icon className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                    <span><strong className="text-foreground">{it.label}</strong> {it.desc}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {footer && <p className="text-[11px] text-muted-foreground">{footer}</p>}
        </div>
      )}
    </div>
  );
}
