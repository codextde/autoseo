/**
 * Builds the public attribution snippet (served from /api/public/attribution/snippet.js?k=<publicKey>).
 *
 * Runtime behaviour:
 *  - Detects existing "How did you hear about us?" questions in forms (EN/DE) and captures the answer
 *    on submit — no popup.
 *  - Otherwise shows a configurable survey popup (Shadow DOM, no global CSS) on: page load (opt-in),
 *    form submit, purchase detection, or `window.<ns>Attribution.show()`.
 *  - Ask once per visitor (localStorage, no cookies).
 *  - Passively captures GA / Google Ads (`purchase`, `generate_lead`) and Meta Pixel (`Purchase`,
 *    `Lead`) conversions — transaction id, value, currency, items — deduped by transaction id.
 *  - `trackConversion({transactionId, value, currency, email})`, `identify(email)` APIs.
 *  - Emails are SHA-256 hashed in the browser when possible (Web Crypto); only hash + masked preview are sent.
 * Pure module (string building only).
 */
import { AI_DETAILS, HDYHAU_PATTERN_SOURCE } from "./channels";
import type { SurveyConfig } from "./types";

export type SnippetConfig = {
  k: string;
  endpoint: string;
  ns: string;
  hd: string;
  survey: {
    enabled: boolean;
    language: "auto" | "en" | "de";
    q: { en: string; de: string };
    channels: Array<{ id: string; en: string; de: string }>;
    aiDetails: boolean;
    ai: Array<{ id: string; label: string }>;
    other: { en: string; de: string };
    thanks: { en: string; de: string };
    colors: { primary: string; bg: string; text: string; onPrimary: string };
    position: string;
    triggers: { pageLoad: boolean; delay: number; formSubmit: boolean; purchase: boolean };
    askOnce: boolean;
    detect: boolean;
    capture: boolean;
    exclude: string[];
  };
};

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
export function safeColor(v: string | undefined, fallback: string): string {
  return v && HEX.test(v) ? v : fallback;
}

/** Picks a readable text color (#fff / #111) for a background hex color. */
export function contrastOn(hex: string): string {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
  return L > 0.45 ? "#111111" : "#ffffff";
}

export function snippetConfig(opts: { publicKey: string; endpoint: string; ns: string; survey: SurveyConfig }): SnippetConfig {
  const s = opts.survey;
  const primary = safeColor(s.primaryColor, "#111111");
  return {
    k: opts.publicKey,
    endpoint: opts.endpoint,
    ns: opts.ns,
    hd: HDYHAU_PATTERN_SOURCE,
    survey: {
      enabled: s.enabled,
      language: s.language,
      q: { en: s.questionEn, de: s.questionDe },
      channels: s.channels.filter((c) => c.enabled).map((c) => ({ id: c.id, en: c.label, de: c.labelDe || c.label })),
      aiDetails: s.aiDetails,
      ai: s.aiOptions.map((id) => ({ id, label: AI_DETAILS[id]?.label ?? id })),
      other: { en: s.otherPlaceholderEn, de: s.otherPlaceholderDe },
      thanks: { en: s.thankYouEn, de: s.thankYouDe },
      colors: { primary, bg: safeColor(s.backgroundColor, "#ffffff"), text: safeColor(s.textColor, "#111111"), onPrimary: contrastOn(primary) },
      position: ["bottom-right", "bottom-left", "center"].includes(s.position) ? s.position : "bottom-right",
      triggers: {
        pageLoad: s.triggers.pageLoad,
        delay: Math.max(0, Math.min(600, s.triggers.pageLoadDelaySec)),
        formSubmit: s.triggers.formSubmit,
        purchase: s.triggers.purchase,
      },
      askOnce: s.askOnce,
      detect: s.detectExistingQuestions,
      capture: s.captureConversions,
      exclude: s.excludePaths.filter((p) => typeof p === "string" && p.startsWith("/")).slice(0, 30),
    },
  };
}

/** JSON safe for inlining into a <script>/JS file. */
function inlineJson(value: unknown): string {
  // split/join with fromCharCode: raw U+2028/2029 in regex literals break some bundlers.
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .split(String.fromCharCode(0x2028))
    .join("\\u2028")
    .split(String.fromCharCode(0x2029))
    .join("\\u2029");
}

export function buildSnippetJs(cfg: SnippetConfig): string {
  return RUNTIME.replace("__CFG__", () => inlineJson(cfg));
}

/** Snippet served for unknown / invalid keys (logs a console warning, does nothing else). */
export function invalidKeySnippet(message: string): string {
  return `/* attribution snippet */\n(function(){try{console.warn(${inlineJson(`[attribution] ${message}`)});}catch(e){}})();\n`;
}

/** Shopify Custom Pixel code (Settings → Customer events). */
export function buildShopifyPixel(opts: { publicKey: string; endpoint: string; ns: string; appName: string }): string {
  const storageKey = `__${opts.ns.toLowerCase()}_attr`;
  return `// ${opts.appName} Attribution — Shopify Custom Pixel
// Sends order id, value, currency, items and a SHA-256 hashed email (never the clear email).
const ENDPOINT = ${JSON.stringify(opts.endpoint)};
const KEY = ${JSON.stringify(opts.publicKey)};

async function sha256(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function mask(e) {
  const at = e.lastIndexOf("@"); if (at < 1) return null;
  const l = e.slice(0, at), d = e.slice(at + 1), dot = d.lastIndexOf(".");
  const host = dot > 0 ? d.slice(0, dot) : d, tld = dot > 0 ? d.slice(dot + 1) : "";
  return l.slice(0, l.length > 3 ? 2 : 1) + "***@" + host.slice(0, 2) + "***" + (tld ? "." + tld : "");
}

analytics.subscribe("checkout_completed", async (event) => {
  try {
    const c = event.data.checkout;
    const email = (c.email || "").trim().toLowerCase();
    let visitor = "shopify_" + String(event.clientId || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60);
    try {
      const raw = await browser.localStorage.getItem(${JSON.stringify(storageKey)});
      const st = raw ? JSON.parse(raw) : null;
      if (st && typeof st.v === "string") visitor = st.v;
    } catch (e) {}
    const body = {
      k: KEY,
      v: visitor,
      t: "conversion",
      u: (event.context && event.context.document && event.context.document.location && event.context.document.location.href) || null,
      c: {
        via: "shopify",
        kind: "purchase",
        transactionId: String((c.order && c.order.id) || c.token || ""),
        value: Number((c.totalPrice && c.totalPrice.amount) || 0),
        currency: c.currencyCode || null,
        emailHash: email ? await sha256(email) : null,
        emailMask: email ? mask(email) : null,
        items: (c.lineItems || []).slice(0, 50).map((li) => ({
          name: li.title,
          quantity: li.quantity,
          price: Number((li.variant && li.variant.price && li.variant.price.amount) || 0),
          sku: (li.variant && li.variant.sku) || null,
        })),
      },
    };
    await fetch(ENDPOINT, { method: "POST", body: JSON.stringify(body), keepalive: true, headers: { "Content-Type": "text/plain" } });
  } catch (e) {}
});
`;
}

/* The runtime is plain ES2017 (no transpilation, no dependencies). `__CFG__` is replaced with JSON. */
const RUNTIME = `/* attribution snippet v1 */
(function (w, d) {
  "use strict";
  var C = __CFG__;
  var NS = C.ns + "Attribution";
  var prev = w[NS];
  if (prev && prev.__loaded) return;
  var KEY = "__" + C.ns.toLowerCase() + "_attr";
  var S = C.survey;
  var HD = new RegExp(C.hd, "i");
  var EMAIL_RE = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/;

  function load() { try { return JSON.parse(w.localStorage.getItem(KEY) || "{}") || {}; } catch (e) { return {}; } }
  var st = load();
  function save() { try { w.localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} }
  function hexOf(bytes) { var s = ""; for (var i = 0; i < bytes.length; i++) s += ("0" + bytes[i].toString(16)).slice(-2); return s; }
  function rid() {
    var a = new Uint8Array(12);
    if (w.crypto && w.crypto.getRandomValues) w.crypto.getRandomValues(a); else for (var i = 0; i < 12; i++) a[i] = Math.floor(Math.random() * 256);
    return "v_" + hexOf(a);
  }
  if (!st.v || !/^[A-Za-z0-9_-]{6,80}$/.test(st.v)) { st.v = rid(); save(); }

  var lang = S.language !== "auto" ? S.language : (/^de/i.test((d.documentElement && d.documentElement.lang) || "") || (!(d.documentElement && d.documentElement.lang) && /^de/i.test(navigator.language || "")) ? "de" : "en");
  function T(o) { return (o && (o[lang] || o.en)) || ""; }

  function send(p) {
    p.k = C.k; p.v = st.v; p.u = location.origin + location.pathname;
    var body = JSON.stringify(p);
    try { if (navigator.sendBeacon && navigator.sendBeacon(C.endpoint, new Blob([body], { type: "text/plain" }))) return; } catch (e) {}
    try { w.fetch(C.endpoint, { method: "POST", body: body, keepalive: true, credentials: "omit", headers: { "Content-Type": "text/plain" } }); } catch (e) {}
  }

  function mask(e) {
    var at = e.lastIndexOf("@"); if (at < 1) return null;
    var l = e.slice(0, at), dm = e.slice(at + 1), dot = dm.lastIndexOf(".");
    var host = dot > 0 ? dm.slice(0, dot) : dm, tld = dot > 0 ? dm.slice(dot + 1) : "";
    return l.slice(0, l.length > 3 ? 2 : 1) + "***@" + host.slice(0, Math.min(2, host.length)) + "***" + (tld ? "." + tld : "");
  }
  function emailInfo(raw, cb) {
    var e = String(raw || "").trim().toLowerCase();
    if (!EMAIL_RE.test(e)) return cb(null);
    var m = mask(e);
    if (w.crypto && w.crypto.subtle && w.TextEncoder) {
      w.crypto.subtle.digest("SHA-256", new TextEncoder().encode(e)).then(function (h) { cb({ emailHash: hexOf(new Uint8Array(h)), emailMask: m }); }, function () { cb({ email: e }); });
    } else cb({ email: e });
  }
  function identify(email) { emailInfo(email, function (em) { if (em && em.emailHash) { st.em = em; save(); } }); }

  /* ───────── Existing question detection ───────── */
  function txt(el) { return el ? String(el.textContent || "").replace(/\\s+/g, " ").trim() : ""; }
  function esc(v) { return w.CSS && w.CSS.escape ? w.CSS.escape(v) : String(v).replace(/["\\\\]/g, "\\\\$&"); }
  function q1(root, sel, fallback) { try { return root.querySelector(sel); } catch (e) { try { return fallback ? root.querySelector(fallback) : null; } catch (e2) { return null; } } }
  function controls(root) { return root.querySelectorAll("input:not([type=hidden]):not([type=submit]):not([type=button]),select,textarea"); }
  function labelOf(el) {
    var parts = [], f;
    try { if (el.id) { f = d.querySelector('label[for="' + esc(el.id) + '"]'); if (f) parts.push(txt(f)); } } catch (e) {}
    if (el.closest) {
      f = el.closest("label"); if (f) parts.push(txt(f));
      f = el.closest("fieldset"); if (f) { var lg = f.querySelector("legend"); if (lg) parts.push(txt(lg)); }
    }
    ["aria-label", "placeholder", "name", "data-name", "title"].forEach(function (a) { var v = el.getAttribute(a); if (v) parts.push(v.replace(/[_-]+/g, " ")); });
    var lb = el.getAttribute("aria-labelledby");
    if (lb) { var le = d.getElementById(lb.split(" ")[0]); if (le) parts.push(txt(le)); }
    var p = el.parentElement;
    for (var i = 0; i < 3 && p && p.tagName !== "FORM"; i++, p = p.parentElement) {
      var ctrls = controls(p), same = true;
      for (var j = 0; j < ctrls.length; j++) if (ctrls[j] !== el && (!el.name || ctrls[j].name !== el.name)) { same = false; break; }
      if (!same) break;
      var c = q1(p, "label,legend,[class*='label' i],[class*='question' i],[class*='title' i]", "label,legend,[class*='label'],[class*='question'],[class*='title']");
      if (c && c !== el) { parts.push(txt(c)); break; }
    }
    return parts.join(" | ").slice(0, 600);
  }
  function findQuestion(form) {
    var els = controls(form);
    for (var i = 0; i < els.length; i++) {
      var t = String(els[i].type || "").toLowerCase();
      if (/^(password|email|reset|file|image|tel|number|date|datetime-local|time|range|color)$/.test(t)) continue;
      if (HD.test(labelOf(els[i]))) return els[i];
    }
    return null;
  }
  function optionLabel(inp) {
    var l = null;
    try { if (inp.id) l = d.querySelector('label[for="' + esc(inp.id) + '"]'); } catch (e) {}
    if (!l && inp.closest) l = inp.closest("label");
    return (l && txt(l)) || inp.value;
  }
  function answerOf(form, el) {
    var t = String(el.type || "").toLowerCase();
    if (t === "radio" || t === "checkbox") {
      var nodes = form.querySelectorAll("input[type=" + t + "]"), out = [];
      for (var i = 0; i < nodes.length; i++) if (nodes[i].name === el.name && nodes[i].checked) out.push(optionLabel(nodes[i]));
      return out.join(", ");
    }
    if (el.tagName === "SELECT") { var o = el.options[el.selectedIndex]; return o && o.value !== "" ? (txt(o) || o.value) : ""; }
    return String(el.value || "");
  }
  function emailOf(form) {
    var e = q1(form, "input[type=email],input[autocomplete=email],input[name*='email' i],input[name*='mail' i]", "input[type=email],input[autocomplete=email],input[name*='email'],input[name*='mail']");
    return e ? e.value : "";
  }
  function formName(form) {
    return String(form.getAttribute("data-name") || form.getAttribute("aria-label") || form.getAttribute("name") || form.id || d.title || "Form").slice(0, 120);
  }
  function onSubmit(ev) {
    var form = ev.target;
    if (!form || form.tagName !== "FORM" || form.hasAttribute("data-attribution-ignore")) return;
    var email = emailOf(form);
    var q = S.detect ? findQuestion(form) : null;
    if (q) {
      var ans = answerOf(form, q).trim();
      if (ans) {
        emailInfo(email, function (em) {
          var r = { mode: "form", answer: ans.slice(0, 300), question: labelOf(q).slice(0, 200), formId: String(form.id || form.getAttribute("name") || "").slice(0, 120), formName: formName(form) };
          if (em) { for (var k in em) r[k] = em[k]; if (em.emailHash) st.em = em; }
          st.a = Date.now(); save();
          send({ t: "response", r: r });
        });
        return;
      }
    }
    emailInfo(email, function (em) {
      if (em && em.emailHash) st.em = em;
      if (S.enabled && S.triggers.formSubmit && canAsk()) {
        st.pend = { t: Date.now(), fn: formName(form) };
        save();
        setTimeout(function () { maybeShow({ trigger: "form_submit" }); }, 600);
      } else save();
    });
  }
  d.addEventListener("submit", onSubmit, true);

  /* ───────── Survey popup ───────── */
  var host = null, isOpen = false;
  function excluded() { var p = location.pathname; for (var i = 0; i < S.exclude.length; i++) if (p.indexOf(S.exclude[i]) === 0) return true; return false; }
  function canAsk() { if (!S.enabled || excluded() || !S.channels.length) return false; if (S.askOnce && (st.a || st.x)) return false; return true; }
  function maybeShow(ctx, force) { if (isOpen || (!force && !canAsk())) return; if (!d.body) { d.addEventListener("DOMContentLoaded", function () { maybeShow(ctx, force); }); return; } render(ctx || {}); }
  function mk(tag, cls, text) { var e = d.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function css() {
    var c = S.colors;
    var pos = S.position === "bottom-left" ? "left:16px;bottom:16px;" : S.position === "center" ? "left:50%;top:50%;transform:translate(-50%,-50%);" : "right:16px;bottom:16px;";
    return ":host{all:initial}" +
      ".w{position:fixed;z-index:2147483646;" + pos + "max-width:380px;width:calc(100vw - 32px);box-sizing:border-box;font:14px/1.45 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:" + c.text + ";background:" + c.bg + ";border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.18),0 2px 8px rgba(0,0,0,.08);border:1px solid rgba(127,127,127,.2);padding:18px 18px 16px;animation:fi .2s ease-out}" +
      "@keyframes fi{from{opacity:0}to{opacity:1}}" +
      ".q{font-weight:600;font-size:15px;margin:0 28px 12px 0}" +
      ".x{position:absolute;top:10px;right:10px;width:28px;height:28px;border:0;background:transparent;color:inherit;opacity:.55;cursor:pointer;border-radius:8px;font-size:18px;line-height:1}" +
      ".x:hover,.x:focus-visible{opacity:1;background:rgba(127,127,127,.12);outline:none}" +
      ".o{display:grid;grid-template-columns:1fr 1fr;gap:8px}" +
      ".b{display:block;width:100%;text-align:left;padding:9px 11px;border-radius:10px;border:1px solid rgba(127,127,127,.3);background:transparent;color:inherit;font:inherit;cursor:pointer;transition:border-color .15s,background .15s}" +
      ".b:hover,.b:focus-visible{border-color:" + c.primary + ";outline:none;background:rgba(127,127,127,.08)}" +
      ".i{display:block;width:100%;box-sizing:border-box;padding:9px 11px;border-radius:10px;border:1px solid rgba(127,127,127,.4);font:inherit;color:inherit;background:transparent}" +
      ".i:focus{outline:2px solid " + c.primary + ";outline-offset:1px}" +
      ".p{margin-top:10px;display:flex;gap:8px;justify-content:flex-end;align-items:center}" +
      ".s{padding:8px 14px;border-radius:10px;border:0;background:" + c.primary + ";color:" + c.onPrimary + ";font:inherit;font-weight:600;cursor:pointer}" +
      ".l{background:transparent;border:0;color:inherit;opacity:.65;font:inherit;cursor:pointer;padding:8px}" +
      ".t{font-weight:600;font-size:15px;margin:4px 28px 4px 0}" +
      "@media (max-width:480px){.w{left:8px;right:8px;bottom:8px;top:auto;transform:none;width:auto;max-width:none}.o{grid-template-columns:1fr}}";
  }
  function render(ctx) {
    isOpen = true;
    host = mk("div");
    host.setAttribute("data-attribution-survey", "");
    var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
    var style = mk("style"); style.textContent = css(); root.appendChild(style);
    var box = mk("div", "w");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", T(S.q));
    root.appendChild(box);
    var x = mk("button", "x", "\\u00d7"); x.type = "button"; x.setAttribute("aria-label", lang === "de" ? "Schließen" : "Close");
    x.onclick = function () { st.x = Date.now(); st.pend = null; save(); close(); };
    box.appendChild(x);
    var body = mk("div"); box.appendChild(body);
    box.addEventListener("keydown", function (e) { if (e.key === "Escape") x.click(); });
    function focusFirst() { if (ctx.trigger === "page_load") return; setTimeout(function () { var b = root.querySelector(".b,.i"); if (b && b.focus) b.focus(); }, 30); }
    function submit(channel, detail, label, free) {
      var pend = st.pend && Date.now() - st.pend.t < 36e5 ? st.pend : null;
      var r = { mode: "popup", channel: channel, detail: detail, answer: label, freetext: free, trigger: ctx.trigger || "manual", transactionId: ctx.transactionId || null, formName: pend ? pend.fn : null };
      var em = st.em;
      if (em && em.emailHash) { r.emailHash = em.emailHash; r.emailMask = em.emailMask; }
      send({ t: "response", r: r });
      st.a = Date.now(); st.pend = null; save();
      body.textContent = ""; body.appendChild(mk("p", "t", T(S.thanks))); x.style.display = "none";
      setTimeout(close, 1800);
    }
    function step1() {
      body.textContent = "";
      body.appendChild(mk("p", "q", T(S.q)));
      var grid = mk("div", "o");
      S.channels.forEach(function (ch) {
        var label = lang === "de" ? ch.de : ch.en;
        var b = mk("button", "b", label); b.type = "button";
        b.onclick = function () {
          if (ch.id === "other") return other(label);
          if (ch.id === "ai_search" && S.aiDetails && S.ai.length) return aiStep(label);
          submit(ch.id, null, label, null);
        };
        grid.appendChild(b);
      });
      body.appendChild(grid);
      focusFirst();
    }
    function aiStep(label) {
      body.textContent = "";
      body.appendChild(mk("p", "q", lang === "de" ? "Welcher KI-Assistent?" : "Which AI assistant?"));
      var grid = mk("div", "o");
      S.ai.forEach(function (a) { var b = mk("button", "b", a.label); b.type = "button"; b.onclick = function () { submit("ai_search", a.id, a.label, null); }; grid.appendChild(b); });
      body.appendChild(grid);
      var p = mk("div", "p");
      var sk = mk("button", "l", lang === "de" ? "Überspringen" : "Skip"); sk.type = "button";
      sk.onclick = function () { submit("ai_search", null, label, null); };
      p.appendChild(sk); body.appendChild(p);
      focusFirst();
    }
    function other(label) {
      body.textContent = "";
      body.appendChild(mk("p", "q", T(S.q)));
      var inp = mk("input", "i"); inp.type = "text"; inp.maxLength = 300; inp.placeholder = T(S.other); inp.setAttribute("aria-label", T(S.q));
      body.appendChild(inp);
      var p = mk("div", "p");
      var back = mk("button", "l", lang === "de" ? "Zurück" : "Back"); back.type = "button"; back.onclick = step1;
      var s = mk("button", "s", lang === "de" ? "Senden" : "Send"); s.type = "button";
      s.onclick = function () { var v = inp.value.trim(); if (!v) { inp.focus(); return; } submit("other", null, label, v.slice(0, 300)); };
      inp.onkeydown = function (e) { if (e.key === "Enter") { e.preventDefault(); s.click(); } };
      p.appendChild(back); p.appendChild(s); body.appendChild(p);
      setTimeout(function () { inp.focus(); }, 30);
    }
    step1();
    d.body.appendChild(host);
  }
  function close() { if (host && host.parentNode) host.parentNode.removeChild(host); host = null; isOpen = false; }

  /* ───────── Conversions ───────── */
  function num(v) { if (v == null || v === "") return null; var n = typeof v === "string" ? parseFloat(v.replace(/[^0-9.-]/g, "")) : Number(v); return isFinite(n) ? n : null; }
  function items(list) {
    if (!list || !list.length) return null;
    var out = [];
    for (var i = 0; i < list.length && i < 50; i++) { var it = list[i] || {}; out.push({ id: String(it.item_id || it.id || it.sku || "").slice(0, 80), name: String(it.item_name || it.name || "").slice(0, 120), quantity: num(it.quantity), price: num(it.price) }); }
    return out;
  }
  function trackConversion(c) {
    if (!c || typeof c !== "object") return;
    var tx = c.transactionId != null && c.transactionId !== "" ? String(c.transactionId).slice(0, 120) : null;
    var kind = c.kind === "lead" ? "lead" : "purchase";
    var via = c.via || "api";
    var key = tx ? "t:" + tx : kind + ":" + via + ":" + Math.floor(Date.now() / 10000);
    st.cx = st.cx || [];
    if (st.cx.indexOf(key) >= 0) return;
    st.cx.push(key); if (st.cx.length > 40) st.cx = st.cx.slice(-40); save();
    function done(em) {
      var b = { transactionId: tx, value: num(c.value), currency: c.currency ? String(c.currency).slice(0, 3).toUpperCase() : null, items: c.items || null, kind: kind, via: via };
      var e = em || st.em;
      if (e) { if (e.email) b.email = e.email; else { b.emailHash = e.emailHash; b.emailMask = e.emailMask; } }
      send({ t: "conversion", c: b });
    }
    if (c.email) emailInfo(c.email, function (em) { if (em && em.emailHash) { st.em = em; save(); } done(em); }); else done(null);
    if (S.enabled && ((kind === "purchase" && S.triggers.purchase) || (kind === "lead" && S.triggers.formSubmit))) {
      setTimeout(function () { maybeShow({ trigger: kind, transactionId: tx }); }, 1200);
    }
  }
  function conv(kind, via, p) {
    p = p || {};
    var tx = p.transaction_id || p.transactionId || p.order_id || p.orderId || p.eventID || null;
    trackConversion({ transactionId: tx, value: p.value != null ? p.value : p.revenue, currency: p.currency || null, items: items(p.items || p.contents || p.products), kind: kind, via: via });
  }
  var seen = typeof WeakSet === "function" ? new WeakSet() : null;
  function mark(o) { if (!seen || !o || typeof o !== "object") return false; if (seen.has(o)) return true; seen.add(o); return false; }
  function onGtag(a) {
    if (a[0] === "event") {
      var name = a[1], p = a[2] || {};
      if (name === "purchase") conv("purchase", "ga", p);
      else if (name === "generate_lead") conv("lead", "ga", p);
      else if (name === "conversion" && (p.transaction_id || p.value)) conv(p.transaction_id ? "purchase" : "lead", "ga", p);
    } else if (a[0] === "set" && a[1] === "user_data" && a[2]) {
      var ud = a[2];
      if (typeof ud.sha256_email_address === "string" && /^[a-f0-9]{64}$/i.test(ud.sha256_email_address)) { st.em = { emailHash: ud.sha256_email_address.toLowerCase(), emailMask: null }; save(); }
      else if (ud.email || ud.email_address) identify(ud.email || ud.email_address);
    }
  }
  function onDl(item) {
    if (!item || typeof item !== "object" || mark(item)) return;
    if (typeof item.length === "number" && typeof item[0] === "string") return onGtag(item);
    var ev = item.event, ec = item.ecommerce || {};
    var ua = ec.purchase && ec.purchase.actionField ? { transaction_id: ec.purchase.actionField.id, value: ec.purchase.actionField.revenue, currency: ec.currencyCode, items: ec.purchase.products } : null;
    if (ev === "purchase") conv("purchase", "ga", ec.transaction_id ? ec : ua || item);
    else if (ev === "generate_lead") conv("lead", "ga", ec.value != null ? ec : item);
    else if (ua) conv("purchase", "ga", ua);
  }
  var dlIdx = 0, fbIdx = 0;
  function pollDl() { var dl = w.dataLayer; if (!dl || !dl.length) return; if (dlIdx > dl.length) dlIdx = 0; for (; dlIdx < dl.length; dlIdx++) { try { onDl(dl[dlIdx]); } catch (e) {} } }
  function onFb(a) {
    if (!a || (a[0] !== "track" && a[0] !== "trackSingle")) return;
    var o = a[0] === "trackSingle" ? 1 : 0;
    var name = a[1 + o], p = a[2 + o] || {}, opts = a[3 + o] || {};
    if (name === "Purchase") conv("purchase", "meta", { transaction_id: p.order_id || opts.eventID, value: p.value, currency: p.currency, items: p.contents });
    else if (name === "Lead") conv("lead", "meta", { transaction_id: p.order_id || opts.eventID, value: p.value, currency: p.currency });
  }
  function pollFb() {
    var f = w.fbq; if (!f) return;
    var q = f.queue;
    if (q && q.length) { if (fbIdx > q.length) fbIdx = 0; for (; fbIdx < q.length; fbIdx++) { var a = q[fbIdx]; if (!mark(a)) { try { onFb(a); } catch (e) {} } } }
    if (typeof f.callMethod === "function" && !f.callMethod.__attr) {
      var cm = f.callMethod;
      var wrapped = function () { try { if (!mark(arguments)) onFb(arguments); } catch (e) {} return cm.apply(this, arguments); };
      wrapped.__attr = true;
      f.callMethod = wrapped;
    }
  }
  if (S.capture) {
    var tick = function () { pollDl(); pollFb(); };
    tick();
    setInterval(tick, 1000);
  }

  /* ───────── API, queue, triggers ───────── */
  var api = {
    __loaded: true,
    version: "1",
    show: function (o) { o = o || {}; maybeShow({ trigger: "manual", transactionId: o.transactionId || null }, !!o.force); },
    trackConversion: function (c) { trackConversion(Object.assign({ via: "api" }, c || {})); },
    identify: identify,
    reset: function () { st = { v: st.v }; save(); }
  };
  w[NS] = api;
  if (prev && prev.q && prev.q.length) prev.q.forEach(function (c) { try { var fn = api[c[0]]; if (typeof fn === "function") fn.apply(api, Array.prototype.slice.call(c[1] || [])); } catch (e) {} });

  try { if (!w.sessionStorage.getItem(KEY + "_s")) { w.sessionStorage.setItem(KEY + "_s", "1"); send({ t: "seen" }); } } catch (e) {}

  if (st.pend && Date.now() - st.pend.t < 6e5) setTimeout(function () { maybeShow({ trigger: "form_submit" }); }, 800);
  else if (S.triggers.pageLoad) setTimeout(function () { maybeShow({ trigger: "page_load" }); }, S.triggers.delay * 1000);
})(window, document);
`;
