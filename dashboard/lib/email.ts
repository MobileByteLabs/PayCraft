import { ServerClient } from "postmark"

const pm = new ServerClient(process.env.POSTMARK_SERVER_TOKEN!)

// Canonical PayCraft sender. RESEARCH.md D1 — production domain is
// paycraft.mobilebytesensei.com. The PAYCRAFT_EMAIL_FROM env-var override
// lets staging / preview environments use a different sender without a
// code change.
const DEFAULT_FROM = "PayCraft <no-reply@paycraft.mobilebytesensei.com>"

export async function sendTransactional(
  templateAlias: string,
  to: string,
  vars: Record<string, unknown>
): Promise<void> {
  await pm.sendEmailWithTemplate({
    From: process.env.PAYCRAFT_EMAIL_FROM ?? DEFAULT_FROM,
    To: to,
    TemplateAlias: templateAlias,
    TemplateModel: vars,
  })
}
