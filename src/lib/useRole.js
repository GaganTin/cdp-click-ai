import { useAuth } from "@/lib/AuthContext";

/**
 * Centralised role / permission helper for the current workspace.
 *
 * The role lives on the user's membership of the current company
 * (`user.companies[].role`); the account owner is an `admin` with
 * `is_account_owner` set. Roles: viewer | contributor | admin (+ owner flag).
 *
 * Only "viewer" is read-only — a viewer may search, filter and view everything
 * but must not create, update or delete anything, and can't see billing.
 * Every other role (contributor, admin, owner) can write.
 *
 * Returns:
 *  - role      : the raw role string (or null while unknown)
 *  - isViewer  : true when the user is a read-only viewer
 *  - isAdmin   : admin or account owner
 *  - isOwner   : account owner
 *  - canWrite  : may perform create/update/delete actions
 *  - canBill   : may see the billing page (admins / the account owner only)
 */
export function useRole() {
  const { user, currentCompany } = useAuth();
  const membership = user?.companies?.find(c => c.id === currentCompany?.id) ?? null;
  const role = membership?.role ?? null;
  const isOwner = !!membership?.is_account_owner;
  const isAdmin = role === "admin" || isOwner;
  const isViewer = role === "viewer";
  // Optimistic while the role is still unknown (first paint / loading) so editors
  // don't see a flash of disabled UI — only an explicit "viewer" is locked out.
  const canWrite = role ? role !== "viewer" : true;

  return { role, isViewer, isAdmin, isOwner, canWrite, canBill: isAdmin };
}
