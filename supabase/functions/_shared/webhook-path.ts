/**
 * Tenant id from a per-tenant webhook URL: `/functions/v1/{fn}/{tenant_id}`.
 *
 * Reads the segment AFTER the function name instead of counting from the root. The hosted edge
 * runtime hands the function `/{fn}/{tenant_id}` (no `/functions/v1` prefix), while the local
 * gateway keeps the prefix — a fixed `pathParts[3]` only ever matched the local shape, so in
 * production every per-tenant webhook arrived tenant-less and fell into the ambiguous-tenant 500.
 */
export function tenantIdFromPath(url: string, fn: string): string | null {
  const parts = new URL(url).pathname.split("/").filter(Boolean);
  const i = parts.indexOf(fn);
  return i >= 0 && parts[i + 1] ? parts[i + 1] : null;
}
