import "server-only";
import { cache } from "react";
import { getSetting } from "@/server/settings";

export type Branding = {
  appName: string;
  tagline: string;
  logoUrl: string;
  faviconUrl: string;
  primaryColor: string;
  accentColor: string;
  defaultLocale: "en" | "de";
  docsUrl: string;
  demoBookingUrl: string;
  supportEmail: string;
  showProductTour: boolean;
};

/** Public branding for layouts (safe to pass to the client). Falls back to defaults if the DB is unreachable. */
export const getBranding = cache(async (): Promise<Branding> => {
  try {
    const g = await getSetting("general");
    return {
      appName: g.appName,
      tagline: g.tagline,
      logoUrl: g.logoUrl,
      faviconUrl: g.faviconUrl,
      primaryColor: g.primaryColor,
      accentColor: g.accentColor,
      defaultLocale: g.defaultLocale,
      docsUrl: g.docsUrl,
      demoBookingUrl: g.demoBookingUrl,
      supportEmail: g.supportEmail,
      showProductTour: g.showProductTour,
    };
  } catch {
    return {
      appName: "AutoSEO",
      tagline: "AI visibility & SEO, self-hosted",
      logoUrl: "",
      faviconUrl: "",
      primaryColor: "#0f0f0f",
      accentColor: "#16a34a",
      defaultLocale: "en",
      docsUrl: "",
      demoBookingUrl: "",
      supportEmail: "",
      showProductTour: true,
    };
  }
});
