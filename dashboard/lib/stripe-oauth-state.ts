import { createHmac, timingSafeEqual } from "crypto"

const SECRET = process.env.PAYCRAFT_OAUTH_STATE_SECRET ?? "dev-secret-for-local-only"

export function makeState(tenantId: string): string {
  const ts = Date.now().toString()
  const payload = `${tenantId}:${ts}`
  const sig = createHmac("sha256", SECRET).update(payload).digest("hex")
  return Buffer.from(`${payload}:${sig}`).toString("base64url")
}

export function verifyState(state: string, maxAgeMs = 600_000): { tenantId: string } | null {
  try {
    const decoded = Buffer.from(state, "base64url").toString()
    const parts = decoded.split(":")
    if (parts.length !== 3) return null
    const [tenantId, ts, sig] = parts
    const expected = createHmac("sha256", SECRET).update(`${tenantId}:${ts}`).digest("hex")
    const sigBuf = Buffer.from(sig)
    const expBuf = Buffer.from(expected)
    if (sigBuf.length !== expBuf.length) return null
    if (!timingSafeEqual(sigBuf, expBuf)) return null
    if (Date.now() - parseInt(ts, 10) > maxAgeMs) return null
    return { tenantId }
  } catch {
    return null
  }
}
