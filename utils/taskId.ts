/**
 * Human-friendly Task ID display.
 *
 * Prefers the persisted, year-scoped sequential ID stored in
 * `events.display_id` (e.g. "TSK-2026-0001"). Falls back to a stable slug
 * derived from the row UUID if a row hasn't been backfilled yet.
 *
 * Pass either an event object ({ displayId?, id }) or a UUID string.
 */
export function getDisplayTaskId(
  arg: string | null | undefined | { displayId?: string | null; id?: string | null }
): string {
  if (!arg) return 'TSK-UNKNOWN';
  if (typeof arg === 'object') {
    if (arg.displayId && arg.displayId.trim()) return arg.displayId;
    return getDisplayTaskId(arg.id ?? null);
  }
  const hex = String(arg).replace(/-/g, '').toUpperCase();
  const slug = hex.slice(0, 8) || 'UNKNOWN';
  return `TSK-${slug}`;
}
