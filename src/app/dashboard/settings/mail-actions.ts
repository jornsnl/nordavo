"use server";

import { z } from "zod";
import { type ActionState, fieldErrorsFrom, formValues } from "@/lib/action-state";
import { requireAdmin } from "@/lib/auth";
import { testMail } from "@/lib/notify/layout";
import { deliverMail, recruitmentFrom } from "@/lib/notify/mail";

const testMailSchema = z.object({
  to: z.email({ error: "Enter a valid email address" }),
  sender: z.enum(["default", "recruitment"]).default("default"),
});

/** Admins send a test mail in the house style to any address, to check Resend and the sender domain. */
export async function sendTestMail(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireAdmin();
  const parsed = testMailSchema.safeParse(formValues(formData));
  if (!parsed.success) {
    return { error: "Check the address.", fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const from = parsed.data.sender === "recruitment" ? recruitmentFrom() : process.env.MAIL_FROM;
  const mail = testMail({ sentBy: user.name || user.email, sentAt: new Date() });
  const result = await deliverMail({ to: parsed.data.to, from, replyTo: user.email || undefined, ...mail });

  if (!result.ok) {
    if (result.reason === "not_configured") {
      return { error: `No mail sent. ${result.detail} Set it as an environment variable and redeploy.` };
    }
    return { error: `No mail sent. ${result.detail}` };
  }
  console.info(`[mail] test mail sent by ${user.email} to ${parsed.data.to} (${result.id ?? "no id"})`);
  return {
    ok: true,
    message: `Test mail sent to ${parsed.data.to} from ${from}. Not in the inbox within a minute? Check spam and the logs in Resend.`,
  };
}
