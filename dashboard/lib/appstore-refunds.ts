// Apple's refundPreference values (migration 207's CHECK 0..3), as the App Store refund-request card offers them.
export const REFUND_PREFERENCES = [
  { value: 0, label: "No answer", hint: "Send the facts only; Apple decides." },
  { value: 2, label: "Decline the refund", hint: "The purchase was delivered and used." },
  { value: 1, label: "Grant the refund", hint: "You'd rather the customer got their money back." },
  { value: 3, label: "No preference", hint: "Tell Apple you have no preference." },
] as const

export const isRefundPreference = (v: unknown): v is 0 | 1 | 2 | 3 =>
  typeof v === "number" && [0, 1, 2, 3].includes(v)
