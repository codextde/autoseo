import "server-only";
import crypto from "node:crypto";
import * as cheerio from "cheerio";

/*
 * Serves agent-written HTML reports inside a CSP sandbox (no scripts, no network, no forms), like
 * open-seo's reportDocumentResponse. Print mode allows exactly one hashed inline script that opens
 * <details> and triggers the print dialog.
 */

const PRINT_SCRIPT = 'addEventListener("load",()=>{for(const d of document.querySelectorAll("details"))d.open=true;setTimeout(()=>print(),150)})';
const PRINT_HASH = crypto.createHash("sha256").update(PRINT_SCRIPT).digest("base64");

const BASE_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'self'";

const REMOVE_TAGS = "script, noscript, iframe, frame, frameset, object, embed, applet, portal, base, form, link, meta[http-equiv], template";
const URL_ATTRS = ["href", "src", "action", "formaction", "xlink:href", "poster", "background", "srcset"];

/**
 * Defense in depth on top of the sandbox CSP: removes active/navigating content an agent (or a
 * prompt-injected answer) could smuggle into a report — scripts, frames, forms, <base>,
 * <meta http-equiv=refresh>, event handlers and javascript:/data:text URLs.
 */
export function sanitizeReportHtml(html: string): string {
  const $ = cheerio.load(html);
  $(REMOVE_TAGS).remove();
  $("*").each((_i, el) => {
    const attribs = (el as { attribs?: Record<string, string> }).attribs;
    if (!attribs) return;
    for (const name of Object.keys(attribs)) {
      const lower = name.toLowerCase();
      if (lower.startsWith("on") || lower === "formaction" || lower === "http-equiv") {
        $(el).removeAttr(name);
        continue;
      }
      if (URL_ATTRS.includes(lower)) {
        const v = (attribs[name] ?? "").replace(/[\u0000-\u0020]/g, "").toLowerCase();
        if (v.startsWith("javascript:") || v.startsWith("vbscript:") || (v.startsWith("data:") && !v.startsWith("data:image/") && !v.startsWith("data:font/"))) $(el).removeAttr(name);
      }
    }
  });
  return $.html();
}

export function reportDocumentResponse(html: string, opts: { print?: boolean; shared?: boolean } = {}): Response {
  let body = sanitizeReportHtml(html);
  let csp = `sandbox allow-popups allow-popups-to-escape-sandbox; ${BASE_CSP}`;
  if (opts.print) {
    csp = `sandbox allow-popups allow-popups-to-escape-sandbox allow-scripts allow-modals; ${BASE_CSP}; script-src 'sha256-${PRINT_HASH}'`;
    const tag = `<script>${PRINT_SCRIPT}</script>`;
    const idx = body.toLowerCase().lastIndexOf("</body>");
    body = idx >= 0 ? body.slice(0, idx) + tag + body.slice(idx) : body + tag;
  }
  return new Response(body, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": csp,
      "Cross-Origin-Opener-Policy": "same-origin",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": opts.shared ? "public, max-age=0, s-maxage=60" : "private, no-store",
      ...(opts.shared ? { "X-Robots-Tag": "noindex, nofollow" } : {}),
    },
  });
}
