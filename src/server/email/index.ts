import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { getSetting } from "@/server/settings";
import { env } from "@/server/env";

export type MailInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type MailResult = { delivered: boolean; transport: "smtp" | "log"; messageId?: string; error?: string };

type Transport = { from: string; replyTo?: string; transporter: Transporter };

async function buildTransport(): Promise<Transport | null> {
  const smtp = await getSetting("smtp");
  const host = smtp.preset === "ses" ? `email-smtp.${smtp.sesRegion}.amazonaws.com` : smtp.host;
  if (smtp.enabled && host && smtp.fromEmail) {
    return {
      from: smtp.fromName ? `"${smtp.fromName.replace(/"/g, "")}" <${smtp.fromEmail}>` : smtp.fromEmail,
      replyTo: smtp.replyTo || undefined,
      transporter: nodemailer.createTransport({
        host,
        port: smtp.port,
        secure: smtp.secure || smtp.port === 465,
        auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined,
        requireTLS: !smtp.secure && smtp.port === 587,
      }),
    };
  }
  return defaultTransport();
}

/** Platform default from AUTOSEO_SMTP_URL / AUTOSEO_MAIL_FROM, used until Admin → Email is configured. */
function defaultTransport(): Transport | null {
  const { smtpUrl, mailFrom } = env.bootstrap;
  if (!smtpUrl || !mailFrom) return null;
  return { from: mailFrom, transporter: nodemailer.createTransport(smtpUrl) };
}

/** True when mail goes out through the AUTOSEO_SMTP_URL default instead of the admin panel settings. */
export async function usesDefaultMailServer(): Promise<boolean> {
  const smtp = await getSetting("smtp");
  return !smtp.enabled && defaultTransport() !== null;
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
      from: t.from,
      to: input.to,
      replyTo: t.replyTo,
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
