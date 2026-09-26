import "server-only";
import { getSetting } from "@/server/settings";

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

async function layout(opts: { preheader: string; heading: string; body: string; cta?: { label: string; url: string }; footer?: string }) {
  const general = await getSetting("general");
  const brand = escapeHtml(general.appName);
  const primary = general.primaryColor || "#0f0f0f";
  const cta = opts.cta
    ? `<tr><td style="padding:8px 0 24px"><a href="${opts.cta.url}" style="display:inline-block;background:${primary};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:10px">${escapeHtml(opts.cta.label)}</a></td></tr>
       <tr><td style="font-size:12px;color:#6b6b6b;padding-bottom:16px">Or paste this link into your browser:<br><span style="word-break:break-all;color:#3a3a3a">${escapeHtml(opts.cta.url)}</span></td></tr>`
    : "";
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><title>${escapeHtml(opts.heading)}</title></head>
<body style="margin:0;background:#f5f4f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#141414">
<span style="display:none;max-height:0;overflow:hidden">${escapeHtml(opts.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e7e5df;border-radius:16px;padding:32px">
<tr><td style="font-weight:700;font-size:15px;letter-spacing:-0.01em;padding-bottom:24px">${brand}</td></tr>
<tr><td style="font-size:22px;font-weight:650;letter-spacing:-0.02em;padding-bottom:12px">${escapeHtml(opts.heading)}</td></tr>
<tr><td style="font-size:15px;line-height:1.6;color:#3a3a3a;padding-bottom:20px">${opts.body}</td></tr>
${cta}
<tr><td style="border-top:1px solid #eeece6;padding-top:16px;font-size:12px;color:#8a8a8a">${opts.footer ?? `You received this email from ${brand}.`}</td></tr>
</table></td></tr></table></body></html>`;
}

export async function magicLinkEmail(opts: { url: string; code: string; minutes: number; ip?: string | null; userAgent?: string | null }) {
  const general = await getSetting("general");
  const html = await layout({
    preheader: `Your sign-in link and code ${opts.code}`,
    heading: `Sign in to ${general.appName}`,
    body: `Click the button below to sign in. The link is valid for ${opts.minutes} minutes and can only be used once.<br><br>
      Or enter this code on the sign-in page:<div style="font-size:28px;font-weight:700;letter-spacing:0.3em;margin:14px 0;font-family:ui-monospace,Menlo,monospace">${opts.code}</div>
      <span style="font-size:12px;color:#8a8a8a">Requested from ${escapeHtml(opts.userAgent ?? "unknown device")}${opts.ip ? ` (${escapeHtml(opts.ip)})` : ""}. If this wasn't you, you can ignore this email.</span>`,
    cta: { label: "Sign in", url: opts.url },
  });
  const text = `Sign in to ${general.appName}\n\nOpen this link (valid ${opts.minutes} minutes, single use):\n${opts.url}\n\nOr enter the code: ${opts.code}\n`;
  return { subject: `Your ${general.appName} sign-in link`, html, text };
}

export async function invitationEmail(opts: { url: string; inviterName: string; workspaceName: string; message?: string | null; days: number }) {
  const general = await getSetting("general");
  const html = await layout({
    preheader: `${opts.inviterName} invited you to ${opts.workspaceName}`,
    heading: `You're invited to ${escapeHtml(opts.workspaceName)}`,
    body: `${escapeHtml(opts.inviterName)} invited you to join <strong>${escapeHtml(opts.workspaceName)}</strong> on ${escapeHtml(general.appName)}.${
      opts.message ? `<blockquote style="margin:16px 0;padding:12px 16px;background:#f7f6f2;border-radius:10px;color:#3a3a3a">${escapeHtml(opts.message)}</blockquote>` : ""
    }<br>The invitation is valid for ${opts.days} days.`,
    cta: { label: "Accept invitation", url: opts.url },
  });
  const text = `${opts.inviterName} invited you to ${opts.workspaceName} on ${general.appName}.\n\nAccept: ${opts.url}\n`;
  return { subject: `${opts.inviterName} invited you to ${opts.workspaceName}`, html, text };
}

export async function simpleEmail(opts: { subject: string; heading: string; body: string; cta?: { label: string; url: string } }) {
  const html = await layout({ preheader: opts.heading, heading: opts.heading, body: escapeHtml(opts.body).replace(/\n/g, "<br>"), cta: opts.cta });
  const text = `${opts.heading}\n\n${opts.body}${opts.cta ? `\n\n${opts.cta.label}: ${opts.cta.url}` : ""}\n`;
  return { subject: opts.subject, html, text };
}
