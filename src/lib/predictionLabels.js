// User-facing labels for product-prediction enum values (replenishment status).
// The stored/queried value stays the raw token (overdue|due_now|due_soon|not_due);
// these are display-only. Shared by the Segments filter UI and the rule builder.

export const REPLENISHMENT_STATUS_LABELS = {
  overdue: "Overdue",
  due_now: "Due now",
  due_soon: "Due soon",
  not_due: "On track",
};

// Friendly label for one raw status value (falls back to a de-underscored token).
export const replenishmentStatusLabel = (v) =>
  REPLENISHMENT_STATUS_LABELS[v] || String(v || "").replace(/_/g, " ");

// Map a list of raw status values to { value, label } options for a picker.
export const replenishmentStatusOptions = (values) =>
  (values || []).map((v) => ({ value: v, label: replenishmentStatusLabel(v) }));
