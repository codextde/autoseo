import "server-only";
import nodemailer from "nodemailer";
import { getSetting } from "@/server/settings";
import { env } from "@/server/env";

export type MailInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type MailResult = { delivered: boolean; transport: "smtp" | "log"; messageId?: string; error?: string };

async function buildTransport() {
  const smtp = await getSetting("smtp");
  if (!smtp.enabled) return null;
  const host = smtp.preset === "ses" ? `email-smtp.${smtp.sesRegion}.amazonaws.com` : smtp.host;
  if (!host || !smtp.fromEmail) return null;
  return {
    smtp,
    transporter: nodemailer.createTransport({
      host,
      port: smtp.port,
      secure: smtp.secure || smtp.port === 465,
      auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined,
      requireTLS: !smtp.secure && smtp.port === 587,
    }),
  };
}

/**
 * Sends an email via the configured SMTP server (Amazon SES SMTP supported out of the box).
 * Without SMTP configured the message is written to the server log so the instance still works.
 */
export async function sendMail(input: MailInput): Promise<MailResult> {
  const t = await buildTransport();
  if (!t) {
    console.info(
      `\n──── [email:log] SMTP not configured — message for ${input.to} ────\nSubject: ${input.subject}\n${input.text}\n────────────────────────────────────────\n`,
    );
    return { delivered: false, transport: "log" };
  }
  try {
    const info = await t.transporter.sendMail({
      from: t.smtp.fromName ? `"${t.smtp.fromName.replace(/"/g, "")}" <${t.smtp.fromEmail}>` : t.smtp.fromEmail,
      to: input.to,
      replyTo: t.smtp.replyTo || undefined,
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
  const t = await buildTransport();
  if (!t) return { ok: false, error: "SMTP is disabled or incomplete (host and from address are required)." };
  try {
    await t.transporter.verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function appUrl(path = "/"): string {
  return `${env.appUrl}${path.startsWith("/") ? path : `/${path}`}`;
}
