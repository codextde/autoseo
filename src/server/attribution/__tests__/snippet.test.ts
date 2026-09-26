import { afterEach, describe, expect, it } from "vitest";
import { Window } from "happy-dom";
import { DEFAULT_SURVEY } from "../channels";
import { buildShopifyPixel, buildSnippetJs, snippetConfig } from "../snippet";
import { collectSchema } from "../collect-schema";
import { csvToResponses, parseCsv } from "../csv";

type Sent = { k: string; v: string; t: string; r?: Record<string, unknown>; c?: Record<string, unknown> };

const running: Array<{ win: Window; timers: Array<ReturnType<typeof setInterval>> }> = [];

afterEach(async () => {
  for (const r of running.splice(0)) {
    r.timers.forEach((t) => clearInterval(t));
    await r.win.happyDOM.close();
  }
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Loads the snippet into a fresh happy-dom window and captures beacons. */
async function load(html: string, opts: { setup?: (w: Window) => void; survey?: Partial<typeof DEFAULT_SURVEY> } = {}) {
  const win = new Window({ url: "https://shop.example.com/kontakt" });
  win.document.body.innerHTML = html;
  const sent: Sent[] = [];
  const pending: Array<Promise<void>> = [];
  Object.defineProperty(win.navigator, "sendBeacon", {
    configurable: true,
    value: (_url: string, blob: Blob) => {
      pending.push(blob.text().then((t) => void sent.push(JSON.parse(t) as Sent)));
      return true;
    },
  });
  opts.setup?.(win);
  const timers: Array<ReturnType<typeof setInterval>> = [];
  const trackedInterval = (fn: () => void, ms: number) => {
    const t = setInterval(fn, ms);
    timers.push(t);
    return t;
  };
  running.push({ win, timers });
  const js = buildSnippetJs(
    snippetConfig({ publicKey: "atk_testkey000000001", endpoint: "https://app.test/api/public/attribution/collect", ns: "AutoSEO", survey: { ...DEFAULT_SURVEY, ...opts.survey } }),
  );
  const run = new Function("window", "document", "navigator", "location", "Blob", "setTimeout", "setInterval", js);
  run(win, win.document, win.navigator, win.location, win.Blob, setTimeout, trackedInterval);
  const flush = async (ms = 30) => {
    await sleep(ms);
    await Promise.all(pending);
  };
  return { win, sent, flush };
}

describe("snippet runtime", () => {
  it("is valid JavaScript and inlines config safely", () => {
    const js = buildSnippetJs(snippetConfig({ publicKey: "atk_x</script>", endpoint: "https://a.test/c", ns: "AutoSEO", survey: DEFAULT_SURVEY }));
    expect(() => new Function(js)).not.toThrow();
    expect(js).not.toContain("</script>");
    expect(() => new Function(buildShopifyPixel({ publicKey: "atk_x", endpoint: "https://a.test/c", ns: "AutoSEO", appName: "AutoSEO" }).replace("analytics.subscribe", "void"))).not.toThrow();
  });

  it("captures an existing German question on submit without a popup", async () => {
    const { win, sent, flush } = await load(`
      <form id="kontakt" data-name="Kontaktformular">
        <label for="em">E-Mail</label><input id="em" type="email" name="email" value="Max@Example.com">
        <label for="q">Wie bist du auf uns aufmerksam geworden?</label>
        <select id="q" name="quelle"><option value="">Bitte wählen</option><option value="chatgpt" selected>ChatGPT</option></select>
        <button type="submit">Senden</button>
      </form>`);
    const form = win.document.querySelector("form")!;
    form.addEventListener("submit", (e) => e.preventDefault());
    form.dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
    await flush(100);
    const resp = sent.find((s) => s.t === "response");
    expect(resp?.r?.mode).toBe("form");
    expect(resp?.r?.answer).toBe("ChatGPT");
    expect(resp?.r?.formName).toBe("Kontaktformular");
    // email is hashed in the browser (or sent for server-side hashing when WebCrypto is unavailable)
    expect(resp?.r?.emailHash ?? resp?.r?.email).toBeTruthy();
    if (resp?.r?.emailHash) expect(resp.r.emailMask).toBe("m***@ex***.com");
    expect(win.document.querySelector("[data-attribution-survey]")).toBeNull();
  });

  it("shows the popup after a form submit, supports the AI detail step and asks once", async () => {
    const { win, sent, flush } = await load(`<form id="lead"><input type="email" name="email" value="lead@example.com"><button>Go</button></form>`);
    const form = win.document.querySelector("form")!;
    form.addEventListener("submit", (e) => e.preventDefault());
    form.dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
    await flush(800);
    const host = win.document.querySelector("[data-attribution-survey]") as unknown as HTMLElement | null;
    expect(host).not.toBeNull();
    const root = (host as unknown as { shadowRoot: ShadowRoot }).shadowRoot;
    const buttons = [...root.querySelectorAll(".b")] as HTMLButtonElement[];
    expect(buttons.map((b) => b.textContent)).toContain("AI Search");
    buttons.find((b) => b.textContent === "AI Search")!.click();
    const ai = [...root.querySelectorAll(".b")] as HTMLButtonElement[];
    expect(ai.map((b) => b.textContent)).toEqual(["ChatGPT", "Perplexity", "Claude", "Gemini", "Copilot"]);
    ai[1]!.click();
    await flush(50);
    const resp = sent.find((s) => s.t === "response");
    expect(resp?.r).toMatchObject({ mode: "popup", channel: "ai_search", detail: "perplexity", trigger: "form_submit" });
    // Ask once: a later show() without force does nothing.
    await sleep(1900);
    (win as unknown as { AutoSEOAttribution: { show: () => void } }).AutoSEOAttribution.show();
    await flush(50);
    expect(win.document.querySelector("[data-attribution-survey]")).toBeNull();
  });

  it("captures GA purchases (dataLayer + gtag), Meta Pixel and trackConversion, deduped by transaction id", async () => {
    const { win, sent, flush } = await load("<p>Danke!</p>", {
      survey: { triggers: { ...DEFAULT_SURVEY.triggers, purchase: false } },
      setup: (w) => {
        const ww = w as unknown as Record<string, unknown>;
        ww.dataLayer = [{ event: "purchase", ecommerce: { transaction_id: "T-1", value: 99.5, currency: "EUR", items: [{ item_id: "sku1", item_name: "Kit", quantity: 1, price: 99.5 }] } }];
        const fbq = function () {} as unknown as { queue: unknown[] };
        fbq.queue = [["track", "Purchase", { value: 20, currency: "EUR" }, { eventID: "M-1" }]];
        ww.fbq = fbq;
        ww.AutoSEOAttribution = { q: [["trackConversion", [{ transactionId: "Q-1", value: 10, currency: "usd" }]]] };
      },
    });
    await flush(100);
    const dl = (win as unknown as { dataLayer: unknown[] }).dataLayer;
    dl.push({ event: "purchase", ecommerce: { transaction_id: "T-1", value: 99.5, currency: "EUR" } }); // duplicate
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    (function gtag(..._args: unknown[]) {
      // eslint-disable-next-line prefer-rest-params
      dl.push(arguments);
    })("event", "generate_lead", { value: 5, currency: "EUR" });
    await flush(1200);
    const conv = sent.filter((s) => s.t === "conversion").map((s) => s.c!);
    expect(conv.filter((c) => c.transactionId === "T-1")).toHaveLength(1);
    expect(conv.find((c) => c.transactionId === "T-1")).toMatchObject({ value: 99.5, currency: "EUR", kind: "purchase", via: "ga" });
    expect(conv.find((c) => c.transactionId === "M-1")).toMatchObject({ value: 20, via: "meta" });
    expect(conv.find((c) => c.transactionId === "Q-1")).toMatchObject({ value: 10, currency: "USD", via: "api" });
    expect(conv.find((c) => c.kind === "lead")).toMatchObject({ value: 5, via: "ga" });
    // every payload validates against the collect endpoint schema
    for (const s of sent) expect(collectSchema.safeParse({ ...s, u: "https://shop.example.com/kontakt" }).success).toBe(true);
  });
});

describe("snippet question detection & triggers", () => {
  it("reads radio groups labelled by a fieldset legend", async () => {
    const { win, sent, flush } = await load(`
      <form name="demo-request">
        <input type="text" name="company" placeholder="Company">
        <fieldset><legend>How did you hear about us?</legend>
          <label><input type="radio" name="src" value="g"> Google</label>
          <label><input type="radio" name="src" value="p" checked> Perplexity</label>
        </fieldset>
      </form>`);
    const form = win.document.querySelector("form")!;
    form.addEventListener("submit", (e) => e.preventDefault());
    form.dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
    await flush(80);
    const resp = sent.find((s) => s.t === "response");
    expect(resp?.r).toMatchObject({ mode: "form", answer: "Perplexity", formName: "demo-request" });
  });

  it("does not show the popup on excluded paths and respects page-load triggers", async () => {
    const { win, flush } = await load("<p>Konto</p>", {
      survey: { triggers: { ...DEFAULT_SURVEY.triggers, pageLoad: true, pageLoadDelaySec: 0 }, excludePaths: ["/kontakt"] },
    });
    await flush(100);
    expect(win.document.querySelector("[data-attribution-survey]")).toBeNull();
    const second = await load("<p>Home</p>", { survey: { triggers: { ...DEFAULT_SURVEY.triggers, pageLoad: true, pageLoadDelaySec: 0 } } });
    await second.flush(100);
    expect(second.win.document.querySelector("[data-attribution-survey]")).not.toBeNull();
  });
});

describe("csv import", () => {
  it("parses quoted CSV and filters to the HDYHAU question", () => {
    const csv = 'Id,Question,Response,Other Response,Order Number,Order Total,Customer Email,Response Date\n' +
      'r1,How did you hear about us?,ChatGPT,,1001,"1.299,00",a@b.de,2026-09-01T10:00:00Z\n' +
      'r2,What did you buy?,Kit,,1001,,a@b.de,2026-09-01T10:00:00Z\n' +
      'r3,How did you hear about us?,Other,"Podcast ""Solar Talk""",1002,50,c@d.de,2026-09-02T10:00:00Z\n';
    const rows = parseCsv(csv);
    expect(rows[3]![3]).toBe('Podcast "Solar Talk"');
    const { inputs, skipped } = csvToResponses(rows);
    expect(skipped).toBe(1);
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toMatchObject({ channel: "ChatGPT", transactionId: "1001", dealValue: 1299, email: "a@b.de", externalId: "r1" });
    expect(inputs[1]!.freetext).toBe('Podcast "Solar Talk"');
  });
  it("detects semicolon CSVs with the question as column header", () => {
    const { inputs } = csvToResponses(parseCsv("E-Mail;Wie bist du auf uns aufmerksam geworden?;Datum\nx@y.de;Perplexity;2026-09-03\n"));
    expect(inputs[0]).toMatchObject({ channel: "Perplexity", email: "x@y.de" });
  });
});
