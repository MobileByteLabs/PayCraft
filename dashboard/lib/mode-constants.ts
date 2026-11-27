// The test/live mode cookie — shared by the server (lib/mode.ts, which reads it via next/headers) and the
// browser (the Vite shell), so neither carries the other's imports.
export type Mode = "test" | "live"

export const MODE_COOKIE = "pc_mode"
export const MODE_DEFAULT: Mode = "live"
