import { renderOgImage } from "@/components/marketing/og/render";

export const alt = "AutoSEO — see how AI search talks about your brand. Open source, self-host free, Cloud $50/month.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return renderOgImage({ title: "See how AI search talks about your brand — and fix it" });
}
