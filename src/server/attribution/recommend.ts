/**
 * Setup wizard recommendation: picks ONE install path from the wizard answers. Pure / isomorphic.
 */
import type { ConversionSource, FormsMode, PlatformId, TrackMode } from "./types";

export const PLATFORMS: Record<PlatformId, { label: string; snippetHint: string }> = {
  shopify: { label: "Shopify", snippetHint: "Online Store → Themes → Edit code → layout/theme.liquid, paste before </head>." },
  woocommerce: { label: "WooCommerce", snippetHint: "Use a header plugin (e.g. WPCode) → Header, or your child theme's header.php before </head>." },
  shopware: { label: "Shopware", snippetHint: "Theme → base.html.twig `{% block layout_head_javascript_tracking %}` or a tag-manager app." },
  wordpress: { label: "WordPress", snippetHint: "Use a header plugin (e.g. WPCode) → Header, or your theme's header.php before </head>." },
  webflow: { label: "Webflow", snippetHint: "Site settings → Custom code → Head code. Publish the site." },
  framer: { label: "Framer", snippetHint: "Site settings → General → Custom code → End of <head>. Publish." },
  wix: { label: "Wix", snippetHint: "Settings → Custom code → Add code → Head, apply to all pages." },
  squarespace: { label: "Squarespace", snippetHint: "Settings → Advanced → Code injection → Header." },
  hubspot_cms: { label: "HubSpot CMS", snippetHint: "Settings → Website → Pages → Templates → Site header HTML." },
  custom: { label: "Custom / other", snippetHint: "Paste the snippet into the <head> of every page (or load it via Google Tag Manager → Custom HTML tag, All Pages)." },
};

export const FORMS_MODE_LABELS: Record<FormsMode, { label: string; description: string }> = {
  existing_question: {
    label: "My forms already ask “How did you hear about us?”",
    description: "The snippet detects the question (EN/DE) and captures the answer on submit — no popup.",
  },
  popup: {
    label: "My forms don't ask yet",
    description: "Show a short survey popup after form submits, purchases or on page load.",
  },
  form_tool: {
    label: "I use a form tool",
    description: "Typeform, Tally, Jotform, Gravity Forms, Formstack … send submissions via webhook.",
  },
  crm: {
    label: "Leads land in my CRM",
    description: "HubSpot, Salesforce, Pipedrive, Attio, Close — send the lead source + deal value via webhook.",
  },
  checkout_only: {
    label: "No forms — checkout only",
    description: "Ask on the thank-you page / after purchase detection and merge with orders.",
  },
};

export type Recommendation = {
  key: string;
  title: string;
  description: string;
  conversionSource: ConversionSource;
  /** Provider keys to highlight in the Integrations tab. */
  providers: string[];
  useSnippet: boolean;
};

export function recommendInstallPath(input: {
  trackMode: TrackMode;
  platform: PlatformId | null;
  formsMode: FormsMode | null;
}): Recommendation {
  const { trackMode, platform, formsMode } = input;
  const wantsPurchases = trackMode !== "leads";
  const wantsLeads = trackMode !== "purchases";

  if (wantsPurchases && platform === "shopify") {
    return {
      key: "shopify",
      title: "Snippet + Shopify Custom Pixel",
      description: "The snippet asks visitors, the Custom Pixel reports every checkout (order id, value, hashed email) — merged automatically.",
      conversionSource: "shopify",
      providers: ["shopify"],
      useSnippet: true,
    };
  }
  if (wantsPurchases && platform === "woocommerce") {
    return {
      key: "woocommerce",
      title: "Snippet + WooCommerce webhook",
      description: "The snippet asks visitors, the signed WooCommerce order webhook delivers paid orders (and checkout answers).",
      conversionSource: "woocommerce",
      providers: ["woocommerce"],
      useSnippet: true,
    };
  }
  if (wantsPurchases && platform === "shopware") {
    return {
      key: "shopware",
      title: "Snippet + Shopware Flow Builder webhook",
      description: "The snippet asks visitors, a Flow Builder “Call webhook” action sends every placed order.",
      conversionSource: "shopware",
      providers: ["shopware"],
      useSnippet: true,
    };
  }
  if (formsMode === "crm") {
    return {
      key: "crm",
      title: "CRM webhook + field mapping",
      description: "Send the lead source and deal value from your CRM workflow; map fields once, future payloads parse automatically.",
      conversionSource: "webhook",
      providers: ["hubspot", "salesforce", "pipedrive", "attio", "close"],
      useSnippet: wantsPurchases,
    };
  }
  if (formsMode === "form_tool") {
    return {
      key: "form_tool",
      title: "Form tool webhook + field mapping",
      description: "Point your form tool's webhook to us — the “How did you hear about us?” field is detected and mapped once.",
      conversionSource: wantsPurchases ? "stripe" : "webhook",
      providers: ["typeform", "tally", "jotform", "gravity_forms", "formstack"],
      useSnippet: false,
    };
  }
  if (wantsPurchases && (platform === "custom" || platform === null)) {
    return {
      key: "stripe",
      title: "Snippet + Stripe webhook",
      description: "The snippet asks visitors after signup/checkout; the signed Stripe webhook delivers purchases, trials ($0) and renewals.",
      conversionSource: "stripe",
      providers: ["stripe"],
      useSnippet: true,
    };
  }
  return {
    key: formsMode === "existing_question" ? "snippet_detect" : "snippet_popup",
    title: formsMode === "existing_question" ? "Snippet (captures your existing question)" : "Snippet with survey popup",
    description:
      formsMode === "existing_question"
        ? "The snippet finds your “How did you hear about us?” field and records answers on submit; GA/Meta conversions are captured passively."
        : wantsLeads
          ? "The snippet shows a one-question survey after form submits and captures GA/Meta lead & purchase events passively."
          : "The snippet shows a one-question survey after purchases and captures GA/Meta purchase events passively.",
    conversionSource: "snippet",
    providers: [],
    useSnippet: true,
  };
}
