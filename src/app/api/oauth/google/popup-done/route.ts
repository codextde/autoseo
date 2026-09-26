import type { NextRequest } from "next/server";

/**
 * Landing page for OAuth flows opened in a popup (e.g. "Connect Google" from the export menu):
 * reports the outcome to the opener window (same origin only) and closes itself.
 */
export function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const payload = {
    type: "autoseo:google-oauth",
    ok: !sp.get("google_error"),
    intent: sp.get("google_connected") ?? sp.get("google_product") ?? null,
    error: sp.get("google_error"),
    message: sp.get("google_message"),
    accountId: sp.get("google_account"),
  };
  // JSON inside a script tag: escape "<" so the payload can never close the tag.
  const json = JSON.stringify(payload).replace(/</g, "\\u003c");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Google connection</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font:14px system-ui,sans-serif;display:flex;min-height:90vh;align-items:center;justify-content:center;color:#444}</style></head>
<body><p id="m">${payload.ok ? "Google connected — you can close this window." : "The Google connection did not finish. You can close this window and try again."}</p>
<script>(function(){var d=${json};try{if(window.opener&&!window.opener.closed){window.opener.postMessage(d,window.location.origin);window.close();}}catch(e){}})();</script>
</body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
