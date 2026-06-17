import { Eye, LogOut } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";

// Shown when a platform owner is acting as another user (impersonation). The
// session cookie has been swapped, so "Exit" simply logs out — the owner then
// signs back into their own account.
export default function ImpersonationBanner() {
  const { user, logout } = useAuth();
  if (!user?.impersonated_by) return null;

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-yellow-500/15 border-b border-yellow-500/30 text-sm">
      <div className="flex items-center gap-2 text-yellow-800 dark:text-yellow-300 font-medium">
        <Eye className="w-4 h-4 flex-shrink-0" />
        Viewing as {user.full_name || user.email} — impersonated by {user.impersonated_by}.
      </div>
      <button
        onClick={logout}
        className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1 bg-yellow-600 text-white text-xs font-semibold rounded-md hover:bg-yellow-700 transition-colors"
      >
        <LogOut className="w-3 h-3" />
        Exit impersonation
      </button>
    </div>
  );
}
