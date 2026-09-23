// @public-endpoint the API contract — documents how to authenticate, grants nothing
import { NextResponse } from "next/server"
import { DOCS_HEADERS } from "@/lib/api-security"
import { OPENAPI_SPEC } from "@/lib/openapi-spec"

export const dynamic = "force-static"

/**
 * GET /v1/openapi.json — the machine-readable contract.
 *
 * PUBLIC, and deliberately so. It documents how to authenticate; it grants nothing. Requiring a key
 * to read the docs would mean a developer needs a credential before they can find out what the
 * credential is for, and every client generator would need one too.
 */
export async function GET() {
  return NextResponse.json(OPENAPI_SPEC, {
    headers: {
      ...DOCS_HEADERS,
      "Cache-Control": "public, max-age=300",
      // The spec alone is CORS-open so browser-based tools (Swagger UI on another origin, client
      // generators) can read it. It describes the API; it grants nothing. No other endpoint sets
      // this, so a page on another origin still cannot read tenant data.
      "Access-Control-Allow-Origin": "*",
    },
  })
}
