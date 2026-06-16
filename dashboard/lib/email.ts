import { ServerClient } from "postmark"

const pm = new ServerClient(process.env.POSTMARK_SERVER_TOKEN!)

export async function sendTransactional(
  templateAlias: string,
  to: string,
  vars: Record<string, unknown>
): Promise<void> {
  await pm.sendEmailWithTemplate({
    From: "PayCraft <no-reply@paycraft.cloud>",
    To: to,
    TemplateAlias: templateAlias,
    TemplateModel: vars,
  })
}
