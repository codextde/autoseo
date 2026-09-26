import { renderOgImage } from "@/components/marketing/og/render";

export const alt = "Self-host AutoSEO with one command, Docker Compose or Coolify.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return renderOgImage({ eyebrow: "Self-hosting guide", title: "Self-host AutoSEO on your own server in minutes" });
}
