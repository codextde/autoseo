import { describe, expect, it } from "vitest";
import { normalizeChannel, HDYHAU_PATTERN, withSurveyDefaults } from "../channels";
import { hashEmail, maskEmail, resolveEmail, redactEmails } from "../email";
import {
  applyMapping,
  detectProvider,
  flattenPaths,
  getPath,
  isMappingUsable,
  payloadFingerprint,
  preprocessPayload,
  redactPayload,
  suggestMapping,
  valueToNumber,
} from "../mapping";
import { matchConversionForResponse, matchResponseForConversion, mergedDealValue, type ConversionCandidate, type ResponseCandidate } from "../merge";
import { mappedToInput, parseDefaultPayload } from "../payloads";
import { parseStripeEvent, signStripePayload, verifyStripeSignature } from "../stripe";
import { parseWooOrder, signWooPayload, verifyWooSignature } from "../woocommerce";
import { recommendInstallPath } from "../recommend";

describe("channel normalization", () => {
  it.each([
    ["ChatGPT", "ai_search", "chatgpt"],
    ["I asked chatgpt for a solar provider", "ai_search", "chatgpt"],
    ["OpenAI", "ai_search", "chatgpt"],
    ["Claude", "ai_search", "claude"],
    ["perplexity.ai", "ai_search", "perplexity"],
    ["Google Gemini", "ai_search", "gemini"],
    ["Microsoft Copilot", "ai_search", "copilot"],
    ["AI Search", "ai_search", null],
    ["ai_search", "ai_search", null],
    ["KI-Suche", "ai_search", null],
    ["Google Ads", "ads", null],
    ["Instagram", "social", null],
    ["google", "search", null],
    ["Google / Bing", "search", null],
    ["Empfehlung von einem Freund", "referral", null],
    ["A friend told me", "referral", null],
    ["Podcast", "content", null],
    ["Messe", "other", null],
    ["", "other", null],
  ])("%s → %s", (input, channel, detail) => {
    const r = normalizeChannel(input);
    expect(r.channel).toBe(channel);
    expect(r.detail).toBe(detail);
  });

  it("maps AI detail ids directly", () => {
    expect(normalizeChannel("perplexity")).toEqual({ channel: "ai_search", detail: "perplexity" });
  });

  it("detects EN/DE HDYHAU questions", () => {
    expect(HDYHAU_PATTERN.test("How did you hear about us?")).toBe(true);
    expect(HDYHAU_PATTERN.test("Wie bist du auf uns aufmerksam geworden?")).toBe(true);
    expect(HDYHAU_PATTERN.test("Wie sind Sie auf uns aufmerksam geworden?")).toBe(true);
    expect(HDYHAU_PATTERN.test("Your email address")).toBe(false);
  });

  it("fills survey defaults", () => {
    const s = withSurveyDefaults({ questionEn: "Where from?", triggers: { pageLoad: true } as never });
    expect(s.questionEn).toBe("Where from?");
    expect(s.triggers.pageLoad).toBe(true);
    expect(s.triggers.formSubmit).toBe(true);
    expect(s.channels.length).toBe(7);
  });
});

describe("email hashing", () => {
  it("hashes normalized emails with SHA-256", () => {
    expect(hashEmail(" Jane.Doe@Example.com ")).toBe(hashEmail("jane.doe@example.com"));
    expect(hashEmail("a@b.co")).toMatch(/^[a-f0-9]{64}$/);
  });
  it("masks emails", () => {
    expect(maskEmail("jane.doe@example.com")).toBe("ja***@ex***.com");
    expect(maskEmail("jo@x.de")).toBe("j***@x***.de");
  });
  it("resolves clear / hashed / invalid input", () => {
    const clear = resolveEmail({ email: "jane@example.com" });
    expect(clear.emailHash).toBe(hashEmail("jane@example.com"));
    expect(clear.emailMask).toBe("ja***@ex***.com");
    const pre = resolveEmail({ emailHash: clear.emailHash, emailMask: "ja***@ex***.com" });
    expect(pre).toEqual(clear);
    expect(resolveEmail({ emailHash: "nothex", email: "not-an-email" })).toEqual({ emailHash: null, emailMask: null });
    expect(resolveEmail({ emailHash: clear.emailHash, emailMask: "<script>" }).emailMask).toBeNull();
  });
  it("redacts emails in text", () => {
    expect(redactEmails("contact jane.doe@example.com now")).toBe("contact ja***@ex***.com now");
  });
});

const typeformPayload = {
  event_id: "01H",
  event_type: "form_response",
  form_response: {
    form_id: "lT4Z3j",
    token: "a3a12ec67a1365927098a606107fac15",
    submitted_at: "2026-09-20T10:15:00Z",
    hidden: { page_url: "https://solakon.de/kontakt" },
    definition: {
      id: "lT4Z3j",
      title: "Contact Form",
      fields: [
        { id: "f1", ref: "email_ref", title: "Your email", type: "email" },
        { id: "f2", ref: "hdyhau_ref", title: "How did you hear about us?", type: "multiple_choice" },
        { id: "f3", ref: "budget_ref", title: "Budget", type: "number" },
      ],
    },
    answers: [
      { type: "email", email: "lead@example.com", field: { id: "f1", ref: "email_ref", type: "email" } },
      { type: "choice", choice: { label: "ChatGPT" }, field: { id: "f2", ref: "hdyhau_ref", type: "multiple_choice" } },
      { type: "number", number: 4200, field: { id: "f3", ref: "budget_ref", type: "number" } },
    ],
  },
};

describe("mapping engine", () => {
  it("resolves nested / selector paths", () => {
    expect(getPath(typeformPayload, "form_response.answers[field.ref=hdyhau_ref].choice.label")).toBe("ChatGPT");
    expect(getPath(typeformPayload, "form_response.answers[1].choice.label")).toBe("ChatGPT");
    expect(getPath(typeformPayload, "form_response.answers[type=email].email")).toBe("lead@example.com");
    expect(getPath(typeformPayload, "form_response.answers[*].number")).toBe(4200);
    expect(getPath({ "a.b": { c: 1 } }, '["a.b"].c')).toBe(1);
    expect(getPath(typeformPayload, "missing.path")).toBeUndefined();
  });

  it("flattens with stable selectors and redacts emails", () => {
    const fields = flattenPaths(typeformPayload);
    const email = fields.find((f) => f.path.endsWith(".email") && f.path.includes("answers"));
    expect(email?.path).toBe("form_response.answers[field.ref=email_ref].email");
    expect(email?.sample).toBe("le***@ex***.com");
    expect(fields.some((f) => f.path === "form_response.answers[field.ref=hdyhau_ref].choice.label")).toBe(true);
  });

  it("suggests a Typeform mapping including the HDYHAU answer", () => {
    const m = suggestMapping(typeformPayload);
    expect(m.channel?.path).toBe("form_response.answers[field.ref=hdyhau_ref].choice.label");
    expect(m.email?.path).toBe("form_response.answers[field.ref=email_ref].email");
    const mapped = applyMapping(typeformPayload, m);
    expect(mapped.channel).toBe("ChatGPT");
    expect(mapped.email).toBe("lead@example.com");
    expect(isMappingUsable(m, "response")).toBe(true);
    const input = mappedToInput(mapped, "auto");
    expect(input.type).toBe("response");
  });

  it("applies constants and metadata", () => {
    const mapped = applyMapping(typeformPayload, {
      channel: { path: "form_response.answers[field.ref=hdyhau_ref].choice.label" },
      formName: { constant: "Typeform — Contact" },
      metadata: ["form_response.hidden.page_url"],
    });
    expect(mapped.formName).toBe("Typeform — Contact");
    expect(mapped.metadata).toEqual({ "form_response.hidden.page_url": "https://solakon.de/kontakt" });
  });

  it("detects providers and builds stable fingerprints", () => {
    expect(detectProvider(typeformPayload)).toBe("typeform");
    expect(detectProvider({ object: "event", type: "checkout.session.completed", data: {} })).toBe("stripe");
    expect(detectProvider({ order_key: "wc_1", line_items: [] })).toBe("woocommerce");
    const a = payloadFingerprint(typeformPayload, "typeform");
    const b = payloadFingerprint({ ...typeformPayload, event_id: "other" }, "typeform");
    expect(a).toBe(b);
    expect(payloadFingerprint({ x: 1 }, null)).not.toBe(a);
  });

  it("preprocesses Tally option ids and Jotform pretty strings", () => {
    const tally = preprocessPayload({
      eventType: "FORM_RESPONSE",
      data: {
        formId: "w4",
        fields: [
          { key: "q1", label: "Wie bist du auf uns aufmerksam geworden?", type: "MULTIPLE_CHOICE", value: ["o2"], options: [{ id: "o1", text: "Google" }, { id: "o2", text: "Perplexity" }] },
          { key: "q2", label: "E-Mail", type: "INPUT_EMAIL", value: "x@y.de" },
        ],
      },
    });
    expect(getPath(tally, "data.fields[key=q1].answer")).toBe("Perplexity");
    const sug = suggestMapping(tally);
    expect(applyMapping(tally, sug).channel).toBe("Perplexity");

    const jot = preprocessPayload({ formID: "1", submissionID: "9", pretty: "Name:Max Muster, How did you hear about us?:Claude, E-Mail:max@example.com" });
    expect(applyMapping(jot, suggestMapping(jot)).channel).toBe("Claude");
  });

  it("parses amounts", () => {
    expect(valueToNumber("1.234,56 €")).toBe(1234.56);
    expect(valueToNumber("1,234.56")).toBe(1234.56);
    expect(valueToNumber(4990, true)).toBe(49.9);
    expect(valueToNumber("abc")).toBeNull();
  });

  it("redacts secrets and emails in stored samples", () => {
    const r = redactPayload({ api_key: "sk_live_1", nested: { email: "a.b@example.com" } }) as Record<string, unknown>;
    expect(r.api_key).toBe("[redacted]");
    expect((r.nested as { email: string }).email).toBe("a***@ex***.com");
  });
});

describe("default webhook schema", () => {
  it("parses a response", () => {
    const r = parseDefaultPayload({ channelId: "ChatGPT", respondentEmail: "a@b.de", dealValue: "1.200,00", dealCurrency: "eur", metadata: { utm: "x" } });
    expect(r.type).toBe("response");
    if (r.type === "response") {
      expect(r.response.dealValue).toBe(1200);
      expect(r.response.dealCurrency).toBe("EUR");
    }
  });
  it("stores order-only payloads as conversions", () => {
    const r = parseDefaultPayload({ transactionId: "SO-1001", dealValue: 499, dealCurrency: "EUR", respondentEmail: "a@b.de" });
    expect(r.type).toBe("conversion");
  });
  it("rejects invalid values", () => {
    expect(parseDefaultPayload({ channelId: "x", dealValue: -5 }).type).toBe("invalid");
    expect(parseDefaultPayload({ channelId: "x", dealCurrency: "euro" }).type).toBe("invalid");
    expect(parseDefaultPayload({ respondentEmail: "a@b.de" }).type).toBe("invalid");
  });
  it("leaves unknown shapes to field mapping", () => {
    expect(parseDefaultPayload(typeformPayload).type).toBe("unrecognized");
  });
});

describe("merge logic", () => {
  const now = new Date("2026-09-20T12:00:00Z");
  const day = 86_400_000;
  const resp = (over: Partial<ResponseCandidate>): ResponseCandidate => ({
    id: "r1",
    transactionId: null,
    emailHash: null,
    visitorId: null,
    respondedAt: now,
    conversionId: null,
    ...over,
  });
  const conv = (over: Partial<ConversionCandidate>): ConversionCandidate => ({
    id: "c1",
    transactionId: null,
    emailHash: null,
    visitorId: null,
    occurredAt: now,
    responseId: null,
    kind: "purchase",
    ...over,
  });

  it("prefers transaction id over email", () => {
    const m = matchResponseForConversion(conv({ transactionId: "T1", emailHash: "h" }), [
      resp({ id: "byEmail", emailHash: "h", respondedAt: new Date(now.getTime() - 1000) }),
      resp({ id: "byTx", transactionId: "T1", respondedAt: new Date(now.getTime() - 10 * day) }),
    ]);
    expect(m?.response.id).toBe("byTx");
    expect(m?.via).toBe("transaction");
  });

  it("conversions look back 90 days for answers", () => {
    const within = matchResponseForConversion(conv({ emailHash: "h" }), [resp({ emailHash: "h", respondedAt: new Date(now.getTime() - 89 * day) })]);
    expect(within?.via).toBe("email");
    const outside = matchResponseForConversion(conv({ emailHash: "h" }), [resp({ emailHash: "h", respondedAt: new Date(now.getTime() - 91 * day) })]);
    expect(outside).toBeNull();
  });

  it("new answers look back 48h for unmatched conversions", () => {
    const r = { transactionId: null, emailHash: "h", visitorId: null, respondedAt: now };
    expect(matchConversionForResponse(r, [conv({ emailHash: "h", occurredAt: new Date(now.getTime() - 47 * 3_600_000) })])?.via).toBe("email");
    expect(matchConversionForResponse(r, [conv({ emailHash: "h", occurredAt: new Date(now.getTime() - 49 * 3_600_000) })])).toBeNull();
    // already matched conversions are skipped
    expect(matchConversionForResponse(r, [conv({ emailHash: "h", responseId: "other" })])).toBeNull();
  });

  it("never merges renewals and skips matched responses", () => {
    expect(matchResponseForConversion(conv({ emailHash: "h", kind: "renewal" }), [resp({ emailHash: "h" })])).toBeNull();
    expect(matchResponseForConversion(conv({ emailHash: "h" }), [resp({ emailHash: "h", conversionId: "x" })])).toBeNull();
  });

  it("falls back to the snippet visitor id", () => {
    const m = matchResponseForConversion(conv({ visitorId: "v1" }), [resp({ visitorId: "v1" })]);
    expect(m?.via).toBe("visitor");
  });

  it("fills empty deal value from the conversion, never double counts", () => {
    expect(mergedDealValue({ dealValue: null, dealCurrency: null }, { value: 99, currency: "EUR" })).toEqual({ dealValue: 99, dealCurrency: "EUR", valueSource: "conversion" });
    expect(mergedDealValue({ dealValue: 1200, dealCurrency: "EUR" }, { value: 99, currency: "EUR" })).toEqual({ dealValue: 1200, dealCurrency: "EUR", valueSource: "response" });
  });
});

describe("stripe", () => {
  const secret = "whsec_test_123";
  it("verifies signatures", () => {
    const body = JSON.stringify({ id: "evt_1" });
    const header = signStripePayload(body, secret, 1_700_000_000);
    expect(verifyStripeSignature(body, header, secret, { now: 1_700_000_010 }).ok).toBe(true);
    expect(verifyStripeSignature(body + " ", header, secret, { now: 1_700_000_010 }).ok).toBe(false);
    expect(verifyStripeSignature(body, header, secret, { now: 1_700_001_000 }).ok).toBe(false);
    expect(verifyStripeSignature(body, header, "whsec_other", { now: 1_700_000_010 }).ok).toBe(false);
  });
  it("classifies trials, purchases and renewals", () => {
    const checkout = (amount: number) => ({
      type: "checkout.session.completed",
      created: 1_700_000_000,
      data: { object: { id: "cs_1", amount_total: amount, currency: "eur", mode: "subscription", subscription: "sub_1", payment_status: "paid", customer_details: { email: "a@b.de" } } },
    });
    const trial = parseStripeEvent(checkout(0));
    expect(trial.type === "conversion" && trial.conversion.kind).toBe("trial");
    const purchase = parseStripeEvent(checkout(4900));
    expect(purchase.type === "conversion" && purchase.conversion.value).toBe(49);
    expect(purchase.type === "conversion" && purchase.conversion.transactionId).toBe("sub_1");
    const withOrderMeta = parseStripeEvent({
      type: "checkout.session.completed",
      data: { object: { id: "cs_9", amount_total: 100, currency: "eur", mode: "subscription", subscription: "sub_9", payment_status: "paid", metadata: { order_id: "O-9" } } },
    });
    expect(withOrderMeta.type === "conversion" && withOrderMeta.conversion.transactionId).toBe("sub_9");
    const firstInvoice = parseStripeEvent({ type: "invoice.paid", data: { object: { id: "in_9", billing_reason: "subscription_create", amount_paid: 100, currency: "eur", subscription: "sub_9" } } });
    expect(firstInvoice.type === "conversion" && firstInvoice.conversion.transactionId).toBe("sub_9");
    const renewal = parseStripeEvent({ type: "invoice.paid", data: { object: { id: "in_2", billing_reason: "subscription_cycle", amount_paid: 4900, currency: "eur", customer_email: "a@b.de" } } });
    expect(renewal.type === "conversion" && renewal.conversion.kind).toBe("renewal");
    expect(parseStripeEvent({ type: "customer.created", data: { object: {} } }).type).toBe("ignored");
    const jpy = parseStripeEvent({ type: "checkout.session.completed", data: { object: { id: "cs_2", amount_total: 5000, currency: "jpy", mode: "payment", payment_status: "paid" } } });
    expect(jpy.type === "conversion" && jpy.conversion.value).toBe(5000);
  });
});

describe("woocommerce", () => {
  it("verifies signatures and parses paid orders with checkout answers", () => {
    const order = {
      id: 77,
      number: "1077",
      order_key: "wc_order_x",
      status: "processing",
      currency: "EUR",
      total: "1299.00",
      date_created_gmt: "2026-09-20T10:00:00",
      billing: { email: "buyer@example.com" },
      line_items: [{ name: "Solar kit", quantity: 1, total: "1299.00", sku: "SK-1" }],
      meta_data: [{ id: 1, key: "_how_did_you_hear", value: "Perplexity" }],
    };
    const body = JSON.stringify(order);
    const sig = signWooPayload(body, "s3cret");
    expect(verifyWooSignature(body, sig, "s3cret")).toBe(true);
    expect(verifyWooSignature(body, sig, "wrong")).toBe(false);
    const r = parseWooOrder(order);
    expect(r.type).toBe("order");
    if (r.type === "order") {
      expect(r.conversion.transactionId).toBe("1077");
      expect(r.conversion.value).toBe(1299);
      expect(r.response?.rawAnswer).toBe("Perplexity");
    }
    expect(parseWooOrder({ ...order, status: "pending" }).type).toBe("ignored");
  });
});

describe("setup recommendation", () => {
  it("recommends one path per answer set", () => {
    expect(recommendInstallPath({ trackMode: "purchases", platform: "shopify", formsMode: "popup" }).key).toBe("shopify");
    expect(recommendInstallPath({ trackMode: "leads", platform: "webflow", formsMode: "crm" }).key).toBe("crm");
    expect(recommendInstallPath({ trackMode: "leads", platform: "wordpress", formsMode: "existing_question" }).key).toBe("snippet_detect");
    expect(recommendInstallPath({ trackMode: "purchases", platform: "custom", formsMode: "popup" }).key).toBe("stripe");
  });
});
