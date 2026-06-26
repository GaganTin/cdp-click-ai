// Client-side mirror of the server password policy in server/routes/auth.js
// (passwordError). Keep the two in sync. Enforced on sign-up, password reset,
// and password change.

export const PASSWORD_HINT =
  "At least 8 characters, including a capital letter, a number and a symbol.";

// Returns an error string when the password fails the policy, or null when valid.
export function passwordError(pw) {
  const s = String(pw ?? "");
  if (s.length < 8)            return "Password must be at least 8 characters";
  if (!/[A-Z]/.test(s))        return "Password must include at least one capital letter";
  if (!/[0-9]/.test(s))        return "Password must include at least one number";
  if (!/[^A-Za-z0-9]/.test(s)) return "Password must include at least one symbol";
  return null;
}
