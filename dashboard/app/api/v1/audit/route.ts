import { listResource } from "@/lib/api-v1-helpers"
export const dynamic = "force-dynamic"

/**
 * GET /v1/audit — who changed what.
 *
 * Includes this API's own actions (`actor_type = "api_key"`), so a key's activity is auditable by
 * the same mechanism it uses to act.
 */
export async function GET(req: Request) {
  return listResource(req, "audit:read", {
    table: "tenant_audit_log",
    columns: "id, actor_user_id, actor_type, action, resource, before_jsonb, after_jsonb, ts",
    orderBy: { column: "ts", ascending: false },
    filters: (q) => ({ action: q.get("action"), actor_type: q.get("actor_type") }),
  })
}
