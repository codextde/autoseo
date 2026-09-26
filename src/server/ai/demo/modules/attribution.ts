import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import {
  attributionConversions,
  attributionResponses,
  attributionSettings,
  attributionWebhookLogs,
  attributionWorkflows,
  integrations,
} from "@/server/db/schema";
import { newId } from "@/server/db/schema/_helpers";
import { CHANNELS, withSurveyDefaults } from "@/server/attribution/channels";
import { hashEmail, maskEmail } from "@/server/attribution/email";
import type { AiDetailId, ChannelId, FieldMapping } from "@/server/attribution/types";
import type { Rng } from "../random";
import { chunks, type DemoModule, type DemoModuleCtx } from "./context";

/**
 * Attribution demo data: completed setup (Shopify store + survey widget + Typeform + website form
 * detection), ~260 "How did you hear about us?" responses over the window (AI Search ≈ 54%, growing),
 * Shopify orders merged by transaction id (plus orders without a survey answer), a Typeform field-mapping
 * workflow and its webhook delivery log. Insert-only, deterministic, no providers.
 */

const DAY = 86_400_000;
const SOURCE_PROVIDERS = ["shopify", "typeform"] as const;

type Source = "widget_purchase" | "widget_signup" | "typeform" | "form";

const SOURCE_WEIGHTS: Record<Source, number> = { widget_purchase: 0.54, widget_signup: 0.1, typeform: 0.2, form: 0.16 };

const CHANNEL_WEIGHTS: Record<Exclude<ChannelId, "ai_search">, number> = {
  search: 0.33,
  social: 0.26,
  referral: 0.17,
  ads: 0.11,
  content: 0.09,
  other: 0.04,
};

const AI_WEIGHTS: Partial<Record<AiDetailId, number>> = {
  chatgpt: 0.47,
  perplexity: 0.19,
  gemini: 0.12,
  claude: 0.1,
  copilot: 0.06,
  ai_overview: 0.06,
};

const AI_PHRASES: Record<string, string[]> = {
  chatgpt: [
    "Asked ChatGPT for the best cushioned running shoes",
    "ChatGPT recommended Stridewell for marathon training",
    "ChatGPT listed you as a top sustainable running brand",
  ],
  perplexity: ["Found you through Perplexity", "Perplexity compared you with Velocita and picked you", "Perplexity answer about recycled running shoes"],
  gemini: ["Gemini suggested Stridewell for wide feet", "Google Gemini recommendation"],
  claude: ["Claude listed you as a sustainable option", "Asked Claude which running club shoes to buy"],
  copilot: ["Microsoft Copilot answer", "Copilot in Edge recommended you"],
  ai_overview: ["Google AI overview at the top of the search results", "The AI summary on Google mentioned you"],
};

const CHANNEL_PHRASES: Record<Exclude<ChannelId, "ai_search">, string[]> = {
  search: ["Google search", "Googled recycled running shoes", "Bing search for trail shoes"],
  social: ["Instagram", "Saw a TikTok review", "Strava club post", "YouTube review"],
  referral: ["My running club coach", "A friend recommended you", "Physio recommendation"],
  ads: ["Facebook ad", "YouTube ad", "Instagram ad"],
  content: ["Runner's World article", "Podcast mention", "Newsletter"],
  other: ["Boston Marathon expo", "Saw someone wearing them at parkrun", "Pop-up store"],
};

const PRODUCTS = [
  { name: "Stridewell Cloudrun 3", price: 149 },
  { name: "Stridewell Tempo Glide", price: 129 },
  { name: "Stridewell Trail Pact", price: 159 },
  { name: "Stridewell Eco Knit Tee", price: 39 },
  { name: "Stridewell Race Shorts", price: 45 },
  { name: "Stridewell Merino Crew Socks (3-pack)", price: 28 },
  { name: "Stridewell Aero Racer", price: 189 },
];

const FIRST = ["alex", "sam", "jordan", "taylor", "maria", "lena", "chris", "noah", "emma", "liam", "mia", "lucas", "zoe", "ben", "ava", "leo", "nina", "max"];
const LAST = ["miller", "garcia", "nguyen", "schmidt", "kim", "rossi", "brown", "lopez", "novak", "silva", "walsh", "berg"];
const MAIL = ["gmail.com", "outlook.com", "icloud.com", "proton.me", "yahoo.com"];
const CLUBS = ["riverside-running", "northside-striders", "harbor-track", "valley-trail-club", "city-marathon-team", "campus-athletics"];
const RETAIL = ["peak-sports", "fleetfoot-store", "run-lab", "trailhead-outfitters", "metro-athletic", "summit-running-co"];

function pickWeighted<K extends string>(rng: Rng, weights: Partial<Record<K, number>>): K {
  const entries = Object.entries(weights) as [K, number][];
  return rng.weighted(entries, ([, w]) => w)[0];
}

function stableKey(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    h1 = Math.imul(h1 ^ input.charCodeAt(i), 16777619) >>> 0;
    h2 = Math.imul(h2 ^ input.charCodeAt(i), 2246822519) >>> 0;
  }
  return `${h1.toString(36)}${h2.toString(36)}`;
}

async function clear(ctx: DemoModuleCtx) {
  const { tx, projectId } = ctx;
  await tx.delete(attributionWebhookLogs).where(eq(attributionWebhookLogs.projectId, projectId));
  await tx.delete(attributionWorkflows).where(eq(attributionWorkflows.projectId, projectId));
  await tx.delete(attributionConversions).where(eq(attributionConversions.projectId, projectId));
  await tx.delete(attributionResponses).where(eq(attributionResponses.projectId, projectId));
  await tx.delete(attributionSettings).where(eq(attributionSettings.projectId, projectId));
  await tx.delete(integrations).where(and(eq(integrations.projectId, projectId), inArray(integrations.provider, [...SOURCE_PROVIDERS])));
}

async function insert(ctx: DemoModuleCtx): Promise<Record<string, number>> {
  const { tx, projectId, now, days } = ctx;
  const rng = ctx.rng("attribution.responses");
  const orderRng = ctx.rng("attribution.orders");
  const nowMs = now.getTime();
  const startMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - (days - 1) * DAY;
  const site = `https://${ctx.domain}`;
  const currency = "USD";

  /* ── Settings (setup completed, snippet live) ── */
  const survey = withSurveyDefaults({ primaryColor: "#16a34a", triggers: { pageLoad: false, pageLoadDelaySec: 20, formSubmit: true, purchase: true } });
  await tx.insert(attributionSettings).values({
    projectId,
    publicKey: `atk_demo${stableKey(`${projectId}:${ctx.seed}`)}`.slice(0, 40),
    trackMode: "both",
    platform: "shopify",
    formsMode: "form_tool",
    conversionSource: "shopify",
    survey,
    allowedDomains: [ctx.domain],
    reportingCurrency: currency,
    wizardStep: 7,
    setupCompletedAt: new Date(startMs - 3 * DAY),
    snippetFirstSeenAt: new Date(startMs - 2 * DAY),
    snippetLastSeenAt: new Date(nowMs - 2 * 3_600_000),
    snippetLastOrigin: site,
    updatedBy: ctx.userId,
  });

  /* ── Responses (+ merged Shopify orders) ── */
  const target = Math.max(60, Math.round((days / 90) * 260));
  type Resp = typeof attributionResponses.$inferInsert;
  type Conv = typeof attributionConversions.$inferInsert;
  const responses: Resp[] = [];
  const conversions: Conv[] = [];
  let orderNo = 18_400;
  const workflowId = newId("awf");

  // Growth: later days get more responses; AI share rises over the window.
  const dayWeights = Array.from({ length: days }, (_, i) => 0.55 + (0.9 * i) / Math.max(1, days - 1));
  const dayIdx = Array.from({ length: days }, (_, i) => i);

  for (let n = 0; n < target; n++) {
    const d = rng.weighted(dayIdx, (i) => dayWeights[i]!);
    const t = d / Math.max(1, days - 1);
    let at = startMs + d * DAY + rng.int(6 * 3600, 23 * 3600) * 1000;
    if (at > nowMs - 60_000) at = nowMs - rng.int(5, 240) * 60_000;
    const respondedAt = new Date(at);
    const source = pickWeighted(rng, SOURCE_WEIGHTS);
    const aiShare = 0.44 + 0.2 * t;
    const channel: ChannelId = rng.bool(aiShare) ? "ai_search" : pickWeighted(rng, CHANNEL_WEIGHTS);
    const detail: AiDetailId | null = channel === "ai_search" ? pickWeighted(rng, AI_WEIGHTS) : null;
    const phrase = channel === "ai_search" ? rng.pick(AI_PHRASES[detail!] ?? ["AI assistant"]) : rng.pick(CHANNEL_PHRASES[channel]);

    const b2b = source === "typeform" || source === "form";
    const local = b2b
      ? `${rng.pick(["coach", "orders", "team", "buying", "info"])}${n}`
      : `${rng.pick(FIRST)}.${rng.pick(LAST)}${rng.int(1, 99)}`;
    const domain = b2b ? `${rng.pick(source === "typeform" ? CLUBS : RETAIL)}.example` : rng.pick(MAIL);
    const email = `${local}@${domain}`;
    const emailHash = hashEmail(email);
    const emailMask = maskEmail(email);
    const id = newId("atr");
    const base: Omit<Resp, "provider" | "sourceType"> = {
      id,
      projectId,
      channel,
      channelDetail: detail,
      emailHash,
      emailMask,
      status: rng.bool(0.012) ? "dismissed" : "active",
      dedupeKey: `demo:${n}`,
      respondedAt,
      createdAt: new Date(at + rng.int(1, 40) * 1000),
      metadata: { demo: true },
    };

    if (source === "widget_purchase") {
      const items = rng.weightedSample(PRODUCTS, rng.int(1, 3), (p) => (p.price > 100 ? 3 : 1)).map((p) => ({ name: p.name, quantity: rng.bool(0.15) ? 2 : 1, price: p.price }));
      const value = Math.round(items.reduce((s, i) => s + i.price * i.quantity, 0) * (rng.bool(0.25) ? 0.85 : 1) * 100) / 100;
      const transactionId = `#${orderNo++}`;
      const convId = newId("atc");
      const visitorId = `v_${stableKey(`${projectId}:${n}`)}`;
      conversions.push({
        id: convId,
        projectId,
        source: "shopify",
        kind: "purchase",
        transactionId,
        value,
        currency,
        emailHash,
        emailMask,
        visitorId,
        pageUrl: `${site}/checkouts/thank-you`,
        items,
        metadata: { demo: true },
        responseId: id,
        occurredAt: new Date(at - rng.int(20, 180) * 1000),
        createdAt: new Date(at - rng.int(10, 120) * 1000),
      });
      responses.push({
        ...base,
        sourceType: "snippet",
        provider: "website_widget",
        rawAnswer: CHANNELS[channel].label,
        freetext: channel === "other" || rng.bool(0.18) ? phrase : null,
        dealValue: value,
        dealCurrency: currency,
        valueSource: "conversion",
        transactionId,
        conversionId: convId,
        // Snippet answers link to the order through the same-browser visitor id (like the real merge).
        matchedVia: "visitor",
        visitorId,
        pageUrl: `${site}/checkouts/thank-you`,
        metadata: { demo: true, trigger: "purchase" },
      });
    } else if (source === "widget_signup") {
      responses.push({
        ...base,
        sourceType: "snippet",
        provider: "website_widget",
        rawAnswer: CHANNELS[channel].label,
        freetext: channel === "other" ? phrase : null,
        visitorId: `v_${stableKey(`${projectId}:s${n}`)}`,
        pageUrl: `${site}/${rng.pick(["newsletter", "account/register", "running-club"])}`,
        metadata: { demo: true, trigger: "form_submit" },
      });
    } else if (source === "typeform") {
      const value = Math.round(rng.float(1200, 14_000) / 50) * 50;
      responses.push({
        ...base,
        sourceType: "webhook",
        provider: "typeform",
        formId: "Tx7Kd2",
        formName: "Team & Club Orders",
        rawAnswer: phrase,
        freetext: phrase,
        externalId: `tf_${stableKey(`${projectId}:tf${n}`)}`,
        dealValue: value,
        dealCurrency: currency,
        valueSource: "response",
        pageUrl: `${site}/teams`,
        workflowId,
        metadata: { demo: true, team_size: rng.int(8, 60) },
      });
    } else {
      const value = Math.round(rng.float(3000, 18_000) / 100) * 100;
      responses.push({
        ...base,
        sourceType: "form",
        provider: "form_detect",
        formId: "wholesale",
        formName: "Wholesale Inquiry",
        rawAnswer: phrase,
        freetext: phrase,
        dealValue: value,
        dealCurrency: currency,
        valueSource: "response",
        visitorId: `v_${stableKey(`${projectId}:w${n}`)}`,
        pageUrl: `${site}/wholesale`,
        metadata: { demo: true, detected_field: "How did you hear about us?" },
      });
    }
  }

  /* ── Orders without a survey answer (Shopify pixel) ── */
  const unmatched = Math.round(target * 0.75);
  for (let n = 0; n < unmatched; n++) {
    const d = orderRng.weighted(dayIdx, (i) => dayWeights[i]!);
    let at = startMs + d * DAY + orderRng.int(6 * 3600, 23 * 3600) * 1000;
    if (at > nowMs - 60_000) at = nowMs - orderRng.int(5, 240) * 60_000;
    const items = orderRng.weightedSample(PRODUCTS, orderRng.int(1, 2), (p) => (p.price > 100 ? 3 : 1)).map((p) => ({ name: p.name, quantity: 1, price: p.price }));
    const value = items.reduce((s, i) => s + i.price, 0);
    const email = `${orderRng.pick(FIRST)}.${orderRng.pick(LAST)}${orderRng.int(100, 999)}@${orderRng.pick(MAIL)}`;
    conversions.push({
      id: newId("atc"),
      projectId,
      source: "shopify",
      kind: "purchase",
      transactionId: `#${orderNo++}`,
      value,
      currency,
      emailHash: hashEmail(email),
      emailMask: maskEmail(email),
      visitorId: `v_${stableKey(`${projectId}:o${n}`)}`,
      pageUrl: `${site}/checkouts/thank-you`,
      items,
      metadata: { demo: true },
      occurredAt: new Date(at),
      createdAt: new Date(at + 30_000),
    });
  }

  for (const part of chunks(responses, 500)) await tx.insert(attributionResponses).values(part);
  for (const part of chunks(conversions, 500)) await tx.insert(attributionConversions).values(part);

  /* ── Typeform field-mapping workflow + webhook delivery log ── */
  const typeform = responses.filter((r) => r.provider === "typeform").sort((a, b) => a.respondedAt!.getTime() - b.respondedAt!.getTime());
  const lastTf = typeform[typeform.length - 1];
  const mapping: FieldMapping = {
    email: { path: "form_response.answers[type=email].email" },
    externalId: { path: "form_response.token" },
    formId: { path: "form_response.form_id" },
    formName: { path: "form_response.definition.title" },
    occurredAt: { path: "form_response.submitted_at" },
    pageUrl: { path: "form_response.hidden.page_url" },
    channel: { path: "form_response.answers[field.ref=hear_about_us].text" },
    dealValue: { path: "form_response.hidden.deal_value" },
    dealCurrency: { constant: currency },
    metadata: ["form_response.hidden.team_size"],
  };
  await tx.insert(attributionWorkflows).values({
    id: workflowId,
    projectId,
    name: "Typeform — Team & Club Orders",
    provider: "typeform",
    fingerprint: `demo:typeform:${stableKey(projectId)}`,
    kind: "response",
    status: "active",
    mapping,
    samplePayload: {
      event_id: "01J9DEMO",
      event_type: "form_response",
      form_response: {
        form_id: "Tx7Kd2",
        token: "tf_demo_sample",
        submitted_at: lastTf?.respondedAt?.toISOString() ?? now.toISOString(),
        definition: { title: "Team & Club Orders" },
        hidden: { page_url: `${site}/teams`, deal_value: "4800", team_size: "24" },
        answers: [
          { type: "email", email: "co***@ri***.example" },
          { type: "text", field: { ref: "hear_about_us" }, text: "ChatGPT recommended Stridewell for our club" },
        ],
      },
    },
    sampleReceivedAt: typeform[0]?.respondedAt ?? now,
    lastPayloadAt: lastTf?.respondedAt ?? now,
    processedCount: typeform.length,
    failedCount: 1,
    createdAt: typeform[0]?.respondedAt ?? now,
  });
  const logs: (typeof attributionWebhookLogs.$inferInsert)[] = typeform.slice(-60).map((r) => ({
    projectId,
    status: "stored",
    provider: "typeform",
    workflowId,
    responseId: r.id!,
    message: "Response stored via field mapping.",
    payloadBytes: 1500 + (r.dedupeKey!.length * 37) % 700,
    payloadKeys: ["event_id", "event_type", "form_response"],
    createdAt: new Date(r.respondedAt!.getTime() + 2_000),
  }));
  if (typeform.length > 3) {
    logs.push({
      projectId,
      status: "parse_failed",
      provider: "typeform",
      workflowId,
      message: "Test request without answers — nothing to store.",
      payloadBytes: 412,
      payloadKeys: ["event_id", "event_type"],
      createdAt: new Date(typeform[0]!.respondedAt!.getTime() - 3_600_000),
    });
  }
  for (const part of chunks(logs, 500)) await tx.insert(attributionWebhookLogs).values(part);

  /* ── Connected sources (Integrations tab) — never synced (no tokens / secrets) ── */
  const lastOrder = conversions.reduce((m, c) => Math.max(m, c.occurredAt!.getTime()), 0);
  await tx.insert(integrations).values([
    {
      projectId,
      provider: "shopify",
      status: "connected",
      config: { attribution: true, demo: true, eventCount: conversions.length, lastEventAt: new Date(lastOrder).toISOString() },
      connectedBy: ctx.userId,
      createdAt: new Date(startMs - 3 * DAY),
    },
    {
      projectId,
      provider: "typeform",
      status: "connected",
      config: { demo: true, eventCount: typeform.length + 1, lastEventAt: (lastTf?.respondedAt ?? now).toISOString() },
      connectedBy: ctx.userId,
      createdAt: new Date(startMs - 3 * DAY),
    },
  ]);

  return {
    attributionResponses: responses.length,
    attributionAiResponses: responses.filter((r) => r.channel === "ai_search").length,
    attributionConversions: conversions.length,
    attributionWebhookLogs: logs.length,
  };
}

export default { name: "attribution", clear, insert } satisfies DemoModule;
