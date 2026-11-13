/**
 * Tenant (and product) ids carried in a Razorpay event's notes.
 *
 * One org Razorpay account is attached to several apps (provider_account_id), and a Razorpay
 * webhook URL holds only one tenant — so the shared account's webhook is registered WITHOUT a
 * tenant segment. Until 2026-11-13 razorpay-webhook then fell through to the single-tenant env
 * secrets, failed signature verification, and answered 401 before logging anything: no Razorpay
 * delivery had ever reached webhook_logs, for any app.
 *
 * checkout-initiate stamps `notes.paycraft_tenant_id` on every subscription it creates (the same
 * shape stripe-shape.ts reads from Stripe metadata). A note is only a CLAIM: the caller must still
 * verify the signature with that tenant's resolved webhook secret, so a forged note cannot pass.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Notes = Record<string, unknown> | unknown[] | null | undefined;
// deno-lint-ignore no-explicit-any
type Envelope = any;

// Subscription first: it is the object PayCraft created, so its notes are authoritative.
const ENTITIES = ["subscription", "payment", "order", "payment_link", "invoice"] as const;

function noteValue(env: Envelope, key: string): string | null {
  for (const e of ENTITIES) {
    const notes: Notes = env?.payload?.[e]?.entity?.notes;
    // Razorpay sends an empty ARRAY when an entity has no notes.
    if (!notes || Array.isArray(notes)) continue;
    const v = (notes as Record<string, unknown>)[key];
    if (typeof v === "string" && UUID.test(v)) return v;
  }
  return null;
}

export function razorpayNotesTenantId(env: Envelope): string | null {
  return noteValue(env, "paycraft_tenant_id");
}

/** Payment Links for consumables carry the product UUID (razorpay-product-sync), not the tenant. */
export function razorpayNotesProductId(env: Envelope): string | null {
  return noteValue(env, "paycraft_product_id");
}
