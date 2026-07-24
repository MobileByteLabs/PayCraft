// supabase/functions/__tests__/receipt-validate-canary/red/naive-receipt.ts
// The DEFECT under test: a receipt path with NO reuse guard. It binds a purchaseToken to a user
// but never rejects the token resurfacing under a DIFFERENT user — the replay/theft hole the real
// assertPlayTokenNotReused must close.

const bindings = new Map<string, string>(); // token → first-seen app_user_id

export function naiveAcceptToken(token: string, appUserId: string): Promise<void> {
  if (!bindings.has(token)) bindings.set(token, appUserId);
  // BUG: a different appUserId presenting the same token is silently accepted (no throw).
  return Promise.resolve();
}
