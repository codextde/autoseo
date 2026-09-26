const INK = "#141413";
const ACCENT = "#22c55e";
const MUTED = "#6b6b66";
const SUPPORT_EMAIL = "info@codext.de";

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

type LayoutOptions = {
  preheader: string;
  heading: string;
  /** Trusted HTML (callers escape user input). */
  body: string;
  cta?: { label: string; url: string };
  footer?: string;
};

/** Table-based layout that renders in every client; no external images. */
function layout(opts: LayoutOptions): string {
  const cta = opts.cta
    ? `<tr><td style="padding:4px 0 24px"><a href="${escapeHtml(opts.cta.url)}" style="display:inline-block;background:${INK};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;line-height:20px;padding:13px 24px;border-radius:10px">${escapeHtml(opts.cta.label)}&nbsp;&rarr;</a></td></tr>
<tr><td style="font-size:12px;line-height:18px;color:${MUTED};padding-bottom:8px">Or paste this link into your browser:<br><span style="word-break:break-all;color:#3a3a36">${escapeHtml(opts.cta.url)}</span></td></tr>`
    : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${escapeHtml(opts.heading)}</title></head>
<body style="margin:0;padding:0;background:#f5f4f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${INK}">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(opts.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f4f0;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
<tr><td style="padding:0 4px 18px">
  <table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td style="width:28px;height:28px;background:${INK};border-radius:8px;text-align:center;vertical-align:middle;color:#ffffff;font-weight:700;font-size:15px;line-height:28px">A</td>
    <td style="padding-left:10px;font-weight:700;font-size:15px;letter-spacing:-0.01em;color:${INK}">AutoSEO <span style="color:${ACCENT}">Cloud</span></td>
  </tr></table>
</td></tr>
<tr><td style="background:#ffffff;border:1px solid #e7e5df;border-radius:16px;padding:32px 28px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr><td><div style="height:4px;width:40px;background:${ACCENT};border-radius:4px;font-size:0;line-height:0">&nbsp;</div></td></tr>
    <tr><td style="font-size:22px;line-height:28px;font-weight:650;letter-spacing:-0.02em;padding:18px 0 12px">${escapeHtml(opts.heading)}</td></tr>
    <tr><td style="font-size:15px;line-height:24px;color:#3a3a36;padding-bottom:20px">${opts.body}</td></tr>
    ${cta}
  </table>
</td></tr>
<tr><td style="padding:18px 4px 0;font-size:12px;line-height:18px;color:#8a8a84">${opts.footer ?? `AutoSEO Cloud · Codext GmbH · Questions? Reply to this email or write to <a href="mailto:${SUPPORT_EMAIL}" style="color:#8a8a84">${SUPPORT_EMAIL}</a>.`}</td></tr>
</table></td></tr></table></body></html>`;
}

export function magicLinkEmail(opts: { url: string; code: string; minutes: number; signup: boolean; ip?: string | null }) {
  const heading = opts.signup ? "Confirm your email" : "Sign in to AutoSEO Cloud";
  const html = layout({
    preheader: `Your sign-in code is ${opts.code}`,
    heading,
    body: `Click the button below to ${opts.signup ? "finish creating your account" : "sign in"}. The link is valid for ${opts.minutes} minutes and can only be used once.<br><br>
Or enter this code on the sign-in page:
<div style="font-size:30px;line-height:36px;font-weight:700;letter-spacing:0.28em;margin:14px 0 4px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:${INK}">${escapeHtml(opts.code)}</div>
<span style="font-size:12px;color:#8a8a84">Requested${opts.ip ? ` from ${escapeHtml(opts.ip)}` : ""}. If this wasn't you, you can safely ignore this email.</span>`,
    cta: { label: opts.signup ? "Confirm and continue" : "Sign in", url: opts.url },
  });
  const text = `${heading}\n\nOpen this link (valid ${opts.minutes} minutes, single use):\n${opts.url}\n\nOr enter the code: ${opts.code}\n\nIf this wasn't you, ignore this email.\n`;
  return { subject: opts.signup ? "Confirm your AutoSEO Cloud account" : "Your AutoSEO Cloud sign-in link", html, text };
}

export function instanceReadyEmail(opts: { instanceUrl: string; dashboardUrl: string; workspaceName: string }) {
  const host = opts.instanceUrl.replace(/^https?:\/\//, "");
  const html = layout({
    preheader: `${host} is up and running.`,
    heading: "Your AutoSEO instance is ready",
    body: `Your private AutoSEO instance for <strong>${escapeHtml(opts.workspaceName)}</strong> is up and running at
<a href="${escapeHtml(opts.instanceUrl)}" style="color:${INK};font-weight:600">${escapeHtml(host)}</a>.<br><br>
Sign in with one click from your AutoSEO Cloud dashboard. Inside, connect your AI provider keys (or a local Claude Code / Codex agent) under Settings to start tracking your AI visibility.`,
    cta: { label: "Open AutoSEO", url: opts.dashboardUrl },
  });
  const text = `Your AutoSEO instance is ready\n\n${opts.instanceUrl} is up and running.\n\nSign in with one click from your dashboard: ${opts.dashboardUrl}\n`;
  return { subject: "Your AutoSEO instance is ready", html, text };
}

export function paymentFailedEmail(opts: { billingUrl: string; host: string | null; amount: string | null }) {
  const html = layout({
    preheader: "We couldn't process your latest payment.",
    heading: "Your payment didn't go through",
    body: `We couldn't charge your payment method${opts.amount ? ` for <strong>${escapeHtml(opts.amount)}</strong>` : ""}${
      opts.host ? ` for your AutoSEO instance <strong>${escapeHtml(opts.host)}</strong>` : ""
    }. Stripe will retry automatically over the next days.<br><br>
To keep your instance running, please update your payment method. If the subscription stays unpaid, the instance is stopped — your data is kept and everything comes back when you pay.`,
    cta: { label: "Update payment method", url: opts.billingUrl },
  });
  const text = `Your payment didn't go through\n\nWe couldn't charge your payment method${opts.amount ? ` for ${opts.amount}` : ""}. Please update it to keep your instance running:\n${opts.billingUrl}\n`;
  return { subject: "Action needed: update your payment method", html, text };
}

export function testEmail() {
  const html = layout({
    preheader: "SMTP works.",
    heading: "SMTP is working",
    body: "This is a test email from the AutoSEO Cloud admin panel. Sign-in links, instance and billing emails will be delivered through this server.",
  });
  return { subject: "AutoSEO Cloud test email", html, text: "SMTP is working. This is a test email from the AutoSEO Cloud admin panel.\n" };
}
