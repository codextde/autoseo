import { renderOgImage } from "@/components/marketing/og/render";

export const alt = "AutoSEO pricing — free self-hosted or $50/month for a private managed instance.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return renderOgImage({ eyebrow: "Pricing", title: "Free to self-host. Fully managed for $50 a month." });
}
