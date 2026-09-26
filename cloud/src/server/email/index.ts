import "server-only";
import nodemailer from "nodemailer";
import { getSetting, isSmtpConfigured, type SmtpSettings } from "@/server/settings";
import { buildMailFrom } from "@/server/smtp-url";

export type MailInput = { to: string; subject: string; html: string; text: string };
export type MailResult = { delivered: boolean; transport: "smtp" | "log"; messageId?: string; error?: string };

function createTransport(smtp: SmtpSettings) {
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure || smtp.port === 465,
    auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined,
    requireTLS: !smtp.secure && smtp.port === 587,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
}

/**
 * Sends via the SMTP server configured in /admin. Until SMTP is configured the message (including any
 * sign-in link) is written to the server log, which is how the first admin signs in.
 */
export async function sendMail(input: MailInput): Promise<MailResult> {
  const smtp = await getSetting("smtp");
  if (!isSmtpConfigured(smtp)) {
    console.info(
      `\n──── [email:log] SMTP not configured — message for ${input.to} ────\nSubject: ${input.subject}\n\n${input.text}\n────────────────────────────────────────\n`,
    );
    return { delivered: false, transport: "log" };
  }
  try {
    const info = await createTransport(smtp).sendMail({
      from: buildMailFrom(smtp.fromName, smtp.fromEmail) ?? smtp.fromEmail,
      to: input.to,
      replyTo: smtp.replyTo || undefined,
      subject: input.subject,
      html: input.html,
      text: input.text,
    });
    return { delivered: true, transport: "smtp", messageId: info.messageId };
  } catch (err) {
    console.error("[email] send failed", err);
    return { delivered: false, transport: "smtp", error: err instanceof Error ? err.message : String(err) };
  }
}

export async function verifySmtp(): Promise<{ ok: boolean; error?: string }> {
  const smtp = await getSetting("smtp");
  if (!isSmtpConfigured(smtp)) return { ok: false, error: "SMTP is not configured (host and from email are required)." };
  try {
    await createTransport(smtp).verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
