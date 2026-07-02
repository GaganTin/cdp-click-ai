import { Monitor, Smartphone } from "lucide-react";
import { usePreferences } from "@/lib/PreferencesContext";

// Shared device-preview primitives for rendered HTML (emails, email templates,
// pop-ups, pop-up templates). Desktop fills the available width; mobile clamps
// the rendered content to a phone-sized frame so you can see how it reflows.
// The toggle and the frame are separate exports so the toggle can live in a
// dialog header while the frame sits in the body.

export const PREVIEW_DEVICES = {
  desktop: { label: "Desktop", icon: Monitor,    width: null },
  mobile:  { label: "Mobile",  icon: Smartphone, width: 390 },
};

const EMPTY_HTML =
  "<p style='font-family:sans-serif;color:#aaa;padding:32px;text-align:center'>No content to preview.</p>";

export function DevicePreviewToggle({ device, onChange, className = "" }) {
  const { t } = usePreferences();
  return (
    <div className={`flex items-center border border-input rounded-md overflow-hidden h-8 ${className}`}>
      {Object.entries(PREVIEW_DEVICES).map(([key, d], i) => {
        const Icon = d.icon;
        const active = device === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            className={`h-8 px-2.5 flex items-center gap-1.5 text-xs transition-colors ${
              i > 0 ? "border-l border-input" : ""
            } ${active ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
          >
            <Icon className="w-3.5 h-3.5" /> {t(d.label)}
          </button>
        );
      })}
    </div>
  );
}

export function DevicePreviewFrame({ html, device = "desktop", title, height = 600, className = "" }) {
  const width = PREVIEW_DEVICES[device]?.width;
  return (
    <div className={`flex justify-center ${className}`}>
      <div
        className="bg-white border border-border rounded-xl overflow-hidden shadow-md transition-all duration-200"
        style={{ width: width ? `${width}px` : "100%", maxWidth: "100%" }}
      >
        <iframe
          srcDoc={html || EMPTY_HTML}
          className="w-full"
          style={{ height, display: "block", border: "none" }}
          title={title || "Preview"}
          sandbox="allow-same-origin"
        />
      </div>
    </div>
  );
}
