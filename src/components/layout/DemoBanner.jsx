import { Sparkles } from "lucide-react";
import { useRole } from "@/lib/useRole";

// Persistent (non-dismissable) banner shown whenever the active workspace is the
// shared demo. It reassures users that they're in a fully-mocked, read-only space
// and points them at the one thing they CAN do here: chat with the AI analyst.
export default function DemoBanner() {
  const { isDemo } = useRole();
  if (!isDemo) return null;

  return (
    <div className="flex items-center gap-2 px-4 py-2.5 border-b text-sm bg-violet-50 border-violet-200 text-violet-800 dark:bg-violet-950/30 dark:border-violet-800 dark:text-violet-300">
      <Sparkles className="w-4 h-4 flex-shrink-0" />
      <span>
        <span className="font-medium">Demo workspace.</span>{" "}
        Everything here is sample data so you can explore the platform. It's read-only —
        you can browse every page and chat with the AI analyst, but changes aren't saved.
      </span>
    </div>
  );
}
