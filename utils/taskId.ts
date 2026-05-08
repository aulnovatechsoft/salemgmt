/**
 * Derive a short, stable, human-readable Task ID from an event/task UUID.
 * Example: "f207bb75-f874-4b45-97cd-c98de9e22643" -> "TSK-F207BB75"
 *
 * Stable per row (first 8 hex chars of the UUID), case-insensitive,
 * uppercase for display. Falls back to a safe slug for non-UUID inputs.
 */
export function getDisplayTaskId(id: string | null | undefined): string {
  if (!id) return 'TSK-UNKNOWN';
  const hex = String(id).replace(/-/g, '').toUpperCase();
  const slug = hex.slice(0, 8) || 'UNKNOWN';
  return `TSK-${slug}`;
}
